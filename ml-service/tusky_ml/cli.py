"""Command line: `python -m tusky_ml <command>` (or `npm run ml:<command>` from the repo root).

  train     fit on completed matches in the DB, save the model + report to artifacts/
  evaluate  same time-ordered backtest as `train`, print the report, save nothing
  predict   score upcoming scheduled matches and upsert them into `predictions`
  run       loop: predict every ML_PREDICT_INTERVAL_MINUTES, retrain when the model is
            older than ML_RETRAIN_DAYS (or missing)
  demo      train + predict on a synthetic league (no DB needed)
  bench     backtest every model kind on synthetic leagues against an oracle that
            knows the true team strengths (use it to judge modelling changes)
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timedelta, timezone

import pandas as pd

from . import db, pipeline, synthetic
from .config import SPORTS, load_settings

log = logging.getLogger("tusky_ml")


def _fmt_pct(x: float) -> str:
    return f"{100 * x:5.1f}%"


def print_report(report: dict) -> None:
    v = report["validation"][report["kind"]]
    b = report["baseline_validation"]
    metric = report["selection_metric"]
    print(f"\n{report['sport']} model {report['version']}")
    print(f"  trained on {report['n_train_rows']} matches (data through {report['data_through'][:10]})")
    print(f"  backtest: {report['n_validation']} matches from {report['validation_from'][:10]}, {report['n_folds']} rolling folds")
    print(f"  {'candidate':<10} {'log_loss':>9} {'brier':>8} {'rps':>8} {'acc':>7} {'mae_margin':>11}")
    for kind, m in report["validation"].items():
        mark = " *" if kind == report["kind"] else ""
        print(
            f"  {kind:<10} {m['log_loss']:>9.4f} {m['brier']:>8.4f} {m.get('rps', float('nan')):>8.4f}"
            f" {m['accuracy']:>7.3f} {m['mae_margin']:>11.3f}{mark}"
        )
    print(
        f"  {'baseline':<10} {b['log_loss']:>9.4f} {b['brier']:>8.4f} {b.get('rps', float('nan')):>8.4f}"
        f" {b['accuracy']:>7.3f}"
    )
    gain = (b[metric] - v[metric]) / b[metric] * 100
    print(f"  selected '{report['kind']}' by {metric}: {gain:+.1f}% vs. always predicting the base rates")
    print("  calibration (home win): " + ", ".join(f"{c['predicted']:.2f}->{c['observed']:.2f} (n={c['n']})" for c in report["calibration_home"]))


def print_predictions(preds: pd.DataFrame, names: dict[int, str], sport: str) -> None:
    if preds.empty:
        print("  no matches to predict")
        return
    for r in preds.itertuples(index=False):
        home = names.get(r.home_team_id, str(r.home_team_id))
        away = names.get(r.away_team_id, str(r.away_team_id))
        when = pd.Timestamp(r.start_time).strftime("%Y-%m-%d %H:%M")
        line = f"  [{r.match_id}] {when}  {home} vs {away}:  H {_fmt_pct(r.p_home)}"
        if sport == "football":
            line += f"  D {_fmt_pct(r.p_draw)}"
        line += f"  A {_fmt_pct(r.p_away)}   exp {r.exp_home:.2f}-{r.exp_away:.2f}"
        if sport == "football":
            top = r.details["top_scores"][0]
            line += f"   likeliest {top['home']}-{top['away']} ({_fmt_pct(top['p']).strip()})"
        else:
            line += f"   spread {r.details['spread']:+.1f}  total {r.details['total']:.1f}"
        print(line)


def _sports(arg: str | None, settings) -> list[str]:
    if arg == "all" or arg is None:
        return list(settings.sports)
    return [arg]


def cmd_train(args, settings, save: bool = True) -> int:
    status = 0
    with db.connect(settings.database_url) as conn:
        for sport in _sports(args.sport, settings):
            matches = db.load_matches(conn, sport)
            try:
                model = pipeline.train(sport, matches, kind=args.kind, min_matches=args.min_matches or settings.min_train_matches)
            except pipeline.NotEnoughData as e:
                print(f"! {e}", file=sys.stderr)
                status = 2
                continue
            print_report(model.report)
            if save:
                path = pipeline.save(model, settings.artifacts_dir)
                print(f"  saved {path}")
    return status


def cmd_predict(args, settings) -> int:
    status = 0
    with db.connect(settings.database_url) as conn:
        for sport in _sports(args.sport, settings):
            model = pipeline.load(settings.artifacts_dir, sport)
            if model is None:
                print(f"! no trained {sport} model in {settings.artifacts_dir} (run `npm run ml:train`)", file=sys.stderr)
                status = 2
                continue
            matches = db.load_matches(conn, sport)
            preds = pipeline.predict(model, matches, days_ahead=args.days or settings.predict_days_ahead, match_ids=args.match_id)
            names = db.team_names(conn, sorted(set(preds.get("home_team_id", [])) | set(preds.get("away_team_id", []))))
            print(f"\n{sport}: {len(preds)} predictions with {model.version}")
            print_predictions(preds, names, sport)
            if not args.dry_run:
                n = db.upsert_predictions(conn, sport, model.version, preds)
                print(f"  stored {n} rows in `predictions`")
    return status


def cmd_run(args, settings) -> int:
    log.info("ml loop started: sports=%s, predict every %sm, retrain after %sd", settings.sports, settings.predict_interval_minutes, settings.retrain_days)
    while True:
        for sport in settings.sports:
            try:
                model = pipeline.load(settings.artifacts_dir, sport)
                stale = model is None or datetime.now(timezone.utc) - datetime.fromisoformat(model.report["trained_at"]) > timedelta(days=settings.retrain_days)
                with db.connect(settings.database_url) as conn:
                    matches = db.load_matches(conn, sport)
                    if stale:
                        try:
                            model = pipeline.train(sport, matches, min_matches=settings.min_train_matches)
                            pipeline.save(model, settings.artifacts_dir)
                            log.info("%s: retrained %s (%s)", sport, model.version, model.report["validation"][model.kind])
                        except pipeline.NotEnoughData as e:
                            log.warning("%s", e)
                    if model is not None:
                        preds = pipeline.predict(model, matches, days_ahead=settings.predict_days_ahead)
                        n = db.upsert_predictions(conn, sport, model.version, preds)
                        log.info("%s: stored %d predictions with %s", sport, n, model.version)
            except Exception:  # keep the loop alive; the next tick retries
                log.exception("%s: ml tick failed", sport)
        if args.once:
            return 0
        time.sleep(settings.predict_interval_minutes * 60)


def cmd_demo(args, _settings) -> int:
    sports = SPORTS if args.sport in (None, "all") else (args.sport,)
    for sport in sports:
        matches, _ = synthetic.league(sport=sport, seasons=3, upcoming_rounds=1, seed=7)
        model = pipeline.train(sport, matches, min_matches=200)
        print_report(model.report)
        preds = pipeline.predict(model, matches, match_ids=matches.loc[matches["status"] == "scheduled", "match_id"].head(5).tolist())
        names = {t: f"Team {t - 1000:02d}" for t in set(matches["home_team_id"])}
        print("  sample predictions (synthetic teams):")
        print_predictions(preds, names, sport)
    return 0


def cmd_bench(args, _settings) -> int:
    from . import benchmark

    sports = SPORTS if args.sport in (None, "all") else (args.sport,)
    benchmark.print_bench(benchmark.run(sports=sports, seeds=args.seeds))
    return 0


def cmd_cricsheet(args, settings) -> int:
    from pathlib import Path

    from .config import REPO_ROOT
    from .ingest import cricsheet

    path = cricsheet.download(args.dataset, REPO_ROOT / "data" / "cricsheet") if args.dataset else Path(args.path)
    if not path.exists():
        print(f"! {path} not found", file=sys.stderr)
        return 2
    started = time.time()
    with db.connect(settings.database_url) as conn:
        counts = cricsheet.import_path(conn, path, force=args.force, limit=args.limit)
    print(f"cricsheet {path.name}: {counts} in {time.time() - started:.0f}s")
    print("Data: Cricsheet (cricsheet.org), Open Data Commons Attribution License.")
    return 1 if counts["failed"] and not counts["imported"] else 0


def print_cricket_report(r: dict) -> None:
    two_way = r["format"] != "Test"
    print(f"\ncricket {r['format']} model {r['version']}")
    print(f"  {r['n_rows']} decided matches through {r['data_through'][:10]}; backtest on the newest {r['n_backtest']} (from {r['backtest_from'][:10]}), 4 rolling folds")
    head = f"  {'model':<16} {'log_loss':>9} {'brier':>8} {'acc':>7}" + (f" {'roc_auc':>8}" if two_way else "")
    print(head)

    def line(name, m):
        print(f"  {name:<16} {m['log_loss']:>9.4f} {m['brier']:>8.4f} {m['accuracy']:>7.3f}" + (f" {m['roc_auc']:>8.4f}" if two_way else ""))

    line("coin flip" if two_way else "base rates", r["baseline"])
    line("elo only", r["elo_only"])
    for stage in ("pre", "post"):
        for kind, m in r[stage]["candidates"].items():
            line(f"{stage}-toss {kind}{' *' if kind == r[stage]['selected'] else ''}", m)
    print("  post-toss by segment (uncalibrated):")
    for seg, m in r["post"].get("segments", {}).items():
        line(f"  {seg}", m)
    for seg, t in r["post"].get("segment_calibration", {}).items():
        verdict = f"adopted (x{t['adopted']})" if t["adopted"] else "rejected"
        print(f"    calibration {seg:<6} (n={t['n']}): out-of-sample log-loss {t['raw_log_loss']:.4f} -> {t['calibrated_log_loss']:.4f}, {verdict}")
    cal = r["post"]["calibration_team1"]
    print("  calibration (post-toss, team 1 win): " + ", ".join(f"{c['predicted']:.2f}->{c['observed']:.2f}" for c in cal))
    fi = r.get("first_innings")
    if fi:
        print(f"  first innings (n={fi['n']}): median off by {fi['mae_median']} runs on average "
              f"(venue average: {fi['mae_venue_average']}, team average: {fi['mae_team_average']}); "
              f"10-90% range held the real score {100 * fi['coverage_10_90']:.0f}% of the time (target 80%)")


def _cricket_feats(settings):
    from .cricket import data as cdata
    from .cricket import features as cfeat

    with db.connect(settings.database_url) as conn:
        d = cdata.load(conn)
    return cfeat.build_features(d)


def cmd_cricket_train(args, settings, save: bool = True) -> int:
    from .cricket import pipeline as cp

    feats = _cricket_feats(settings)
    formats = cp.FORMATS if args.format in (None, "all") else (args.format,)
    status = 0
    for fmt, res in cp.train_all(feats, formats, min_matches=args.min_matches or settings.min_train_matches).items():
        if isinstance(res, str):
            print(f"! {res}", file=sys.stderr)
            status = 2
            continue
        print_cricket_report(res.report)
        if save:
            print(f"  saved {cp.save(res, settings.artifacts_dir)}")
    return status


def cmd_cricket_predict(args, settings) -> int:
    from .cricket import pipeline as cp

    models = {f: m for f in cp.FORMATS if (m := cp.load(settings.artifacts_dir, f)) is not None}
    if not models:
        print("! no cricket models; run `npm run cricket:train`", file=sys.stderr)
        return 2
    feats = _cricket_feats(settings)
    preds = cp.predict(models, feats, days_ahead=args.days or settings.predict_days_ahead, match_ids=args.match_id)
    with db.connect(settings.database_url) as conn:
        names = db.team_names(conn, sorted(set(preds.get("home_team_id", [])) | set(preds.get("away_team_id", []))))
        print(f"\ncricket: {len(preds)} predictions")
        for r in preds.itertuples(index=False):
            d = r.details
            line = (f"  [{r.match_id}] {pd.Timestamp(r.start_time):%Y-%m-%d} {d['format']} {d['stage']}: "
                    f"{names.get(r.home_team_id)} {_fmt_pct(r.p_home).strip()}")
            if r.p_draw > 0:
                line += f", draw {_fmt_pct(r.p_draw).strip()}"
            line += f", {names.get(r.away_team_id)} {_fmt_pct(r.p_away).strip()}"
            for k, v in d.get("first_innings", {}).items():
                who = names.get(r.home_team_id if k.startswith("team1") else r.away_team_id)
                line += f" | {who} batting first: {v['p50']} ({v['p10']}-{v['p90']})"
            print(line)
        if not args.dry_run and not preds.empty:
            print(f"  stored {db.upsert_predictions(conn, 'cricket', None, preds)} rows in `predictions`")
    return 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(prog="tusky_ml", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    sport_help = "football | basketball | all (default: ML_SPORTS or ENABLED_SPORTS)"
    for name in ("train", "evaluate"):
        sp = sub.add_parser(name)
        sp.add_argument("--sport", choices=[*SPORTS, "all"], help=sport_help)
        sp.add_argument("--kind", default="auto", help="auto | glm | hgb (football) | linear | hgb (basketball)")
        sp.add_argument("--min-matches", type=int, default=None)

    sp = sub.add_parser("predict")
    sp.add_argument("--sport", choices=[*SPORTS, "all"], help=sport_help)
    sp.add_argument("--days", type=int, default=None, help="horizon for scheduled matches (default ML_PREDICT_DAYS_AHEAD=14)")
    sp.add_argument("--match-id", type=int, action="append", help="predict these match ids (repeatable)")
    sp.add_argument("--dry-run", action="store_true", help="print only, do not write to the DB")

    sp = sub.add_parser("run")
    sp.add_argument("--once", action="store_true", help="one tick, then exit")

    sp = sub.add_parser("demo")
    sp.add_argument("--sport", choices=[*SPORTS, "all"], default="all")

    sp = sub.add_parser("bench")
    sp.add_argument("--sport", choices=[*SPORTS, "all"], default="all")
    sp.add_argument("--seeds", type=int, default=5)

    sp = sub.add_parser("cricsheet", help="import Cricsheet ball-by-ball JSON (download a dataset or read local files)")
    src = sp.add_mutually_exclusive_group(required=True)
    src.add_argument("--dataset", help="download and import: ipl | t20s | odis | tests | it20s | recent | all")
    src.add_argument("--path", help="local .zip, folder of .json, or single .json")
    sp.add_argument("--force", action="store_true", help="re-import files even if unchanged")
    sp.add_argument("--limit", type=int, default=None, help="only the first N files (smoke test)")

    for name in ("cricket-train", "cricket-evaluate"):
        sp = sub.add_parser(name, help="cricket win + first-innings models per format (backtest report)")
        sp.add_argument("--format", choices=["T20", "ODI", "Test", "all"], default="all")
        sp.add_argument("--min-matches", type=int, default=None)
    sp = sub.add_parser("cricket-predict", help="score upcoming cricket matches -> predictions")
    sp.add_argument("--days", type=int, default=None)
    sp.add_argument("--match-id", type=int, action="append")
    sp.add_argument("--dry-run", action="store_true")

    args = p.parse_args(argv)
    if args.cmd == "cricsheet":
        return cmd_cricsheet(args, load_settings())
    if args.cmd == "cricket-train":
        return cmd_cricket_train(args, load_settings())
    if args.cmd == "cricket-evaluate":
        return cmd_cricket_train(args, load_settings(), save=False)
    if args.cmd == "cricket-predict":
        return cmd_cricket_predict(args, load_settings())
    settings = load_settings()
    if args.cmd == "train":
        return cmd_train(args, settings)
    if args.cmd == "evaluate":
        return cmd_train(args, settings, save=False)
    if args.cmd == "predict":
        return cmd_predict(args, settings)
    if args.cmd == "run":
        return cmd_run(args, settings)
    if args.cmd == "demo":
        return cmd_demo(args, settings)
    if args.cmd == "bench":
        return cmd_bench(args, settings)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
