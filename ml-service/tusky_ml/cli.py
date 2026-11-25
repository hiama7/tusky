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

from . import db, pipeline, synthetic, tune
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
            applied = tune.apply_saved(settings.artifacts_dir, sport)
            if applied:
                print(f"  using tuned settings from artifacts/{sport}/config.json")
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
                        tune.apply_saved(settings.artifacts_dir, sport)
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


def print_tuning(res: dict) -> None:
    key = res["holdout"]["metric"]
    ho = res["holdout"]
    s = res["search"]
    print()
    print(f"{res['sport']} tuning ({res['trials']} random trials, seed {res['seed']}), searched only on matches before {res['cutoff']}")
    print(f"  rolling backtest {key}: default {s['default_score']:.5f} -> best {s['best_score']:.5f}")
    print("  settings changed: " + (", ".join(f"{k} {res['default_params'][k]} -> {v}" for k, v in s["best_params"].items()) or "none (defaults were best)"))
    w = res["ensemble_weight"]
    print(f"  ensemble weight on the GLM (rest on gradient boosting): {w['best_weight']}  "
          + " ".join(f"{k}:{v:.4f}" for k, v in w["table"].items() if k in ("0.0", "0.5", "1.0")))
    print()
    print(f"  HOLDOUT (never seen by the search): {ho['n_holdout']} matches, {ho['holdout_from'][:10]} to {ho['holdout_to'][:10]}, fitted once on {ho['n_pre']} earlier matches")
    print(f"  {'model':<34} {'rps':>8} {'log_loss':>9} {'brier':>8} {'acc':>7}")
    labels = {"base_rates": "base rates (no skill)", "default_frozen": "default, ratings frozen at cutoff",
              "tuned_frozen": "tuned, ratings frozen at cutoff", "default": "default settings", "tuned": "tuned settings"}
    for k in ("base_rates", "default_frozen", "tuned_frozen", "default", "tuned"):
        m = ho["scores"][k]
        print(f"  {labels[k]:<34} {m['rps']:>8.4f} {m['log_loss']:>9.4f} {m['brier']:>8.4f} {m['accuracy']:>7.3f}")
    names = {"tuned_vs_default": "tuned vs default", "new_data_vs_frozen_default": "new results vs frozen (default)",
             "new_data_vs_frozen_tuned": "new results vs frozen (tuned)", "default_vs_base_rates": "default vs base rates",
             "tuned_vs_base_rates": "tuned vs base rates"}
    print("  paired RPS improvement (positive = better), bootstrap 95% interval:")
    for k, v in ho["paired_gain"].items():
        print(f"    {names[k]:<34} {v['mean_rps_gain']:+.5f}  [{v['ci95'][0]:+.5f}, {v['ci95'][1]:+.5f}]")
    print("  by segment (rps):  " + f"{'n':>5} {'base':>8} {'default':>8} {'tuned':>8} {'frozen':>8}")
    for label, m in ho["segments"].items():
        print(f"    {label:<28}{m['n']:>5} {m['base_rates']:>8.4f} {m['default']:>8.4f} {m['tuned']:>8.4f} {m['tuned_frozen']:>8.4f}")
    print("  calibration, home win (tuned): " + ", ".join(f"{c['predicted']:.2f}->{c['observed']:.2f}" for c in ho["calibration_home_tuned"]))
    print("  calibration, draw (tuned):     " + ", ".join(f"{c['predicted']:.2f}->{c['observed']:.2f}" for c in ho["calibration_draw_tuned"]))
    print()
    print(f"  decision: tuned settings {'ADOPTED' if res['adopted'] else 'NOT adopted (did not beat the defaults on the holdout)'}")


def cmd_tune(args, settings) -> int:
    from dataclasses import asdict

    sport = args.sport
    with db.connect(settings.database_url) as conn:
        matches = db.load_matches(conn, sport)
        names = {int(i): n for i, n in conn.execute("select id, name from competitions").fetchall()}
    res = tune.run(sport, matches, args.cutoff, args.trials, args.seed, names, log=print)
    print_tuning(res)
    if not args.no_save:
        out = settings.artifacts_dir / sport
        out.mkdir(parents=True, exist_ok=True)
        (out / "tuning.json").write_text(json.dumps({**res, "tuned_config": asdict(res["tuned_config"])}, indent=2, default=str), encoding="utf-8")
        print(f"  saved {out / 'tuning.json'}")
        if res["adopted"]:
            print(f"  saved {tune.save_config(settings.artifacts_dir, sport, res['tuned_config'], {'tuned_before': args.cutoff, 'seed': args.seed, 'trials': args.trials})}")
    return 0


def print_comparison(res: dict) -> None:
    cmp = res["comparison"]
    t = res["test"]
    w = res["windows"]
    print(f"\n{res['task']}: train {w['train'][2]} / validation {w['validation'][2]} / TEST {w['test'][2]} matches ({w['test'][0]} to {w['test'][1]}), {res['features']} features, {res['trials']} Optuna trials per family")
    k3 = res["k"] == 3
    head = f"  {'model':<22}{'log_loss':>9}{'brier':>8}{'acc':>7}{'prec':>7}{'rec':>7}{'f1':>7}{'auc':>7}{'ece':>8}" + (f"{'rps':>8}" if k3 else "")
    print(head)

    def line(label, m):
        auc = f"{m['roc_auc']:.3f}" if m.get("roc_auc") is not None else "  n/a"
        print(f"  {label:<22}{m['log_loss']:>9.4f}{m.get('brier_binary', m['brier']):>8.4f}{m['accuracy']:>7.3f}{m['precision']:>7.3f}{m['recall']:>7.3f}{m['f1']:>7.3f}{auc:>7}{m['ece']:>8.4f}"
              + (f"{m['rps']:>8.4f}" if k3 else ""))

    line("base rates", t["base_rates"])
    for name in ("existing", *res["families"], "ensemble", "blend"):
        tag = {"existing": f"existing ({res['existing_model']})"}.get(name, name)
        line(f"{tag[:15]} raw", t[name]["raw"])
        line(f"{tag[:9]} +{t[name]['calibrator']}", t[name]["calibrated"])
    g = cmp["paired_log_loss_gain_vs_existing"]
    print(f"  selected on validation: {cmp['new_model']}{' (ensemble adopted)' if res['ensemble_adopted'] else ''}; "
          f"test log-loss {cmp['log_loss_existing']:.4f} -> {cmp['log_loss_new']:.4f} = {cmp['improvement_pct_vs_existing']:+.2f}% "
          f"(paired gain {g['mean']:+.4f}, 95% interval {g['ci95'][0]:+.4f} to {g['ci95'][1]:+.4f})")
    print("  (brier column: conventional binary Brier for 2-outcome tasks, sum-over-classes for football/Test)")


def cmd_compare(args, settings) -> int:
    from . import compare

    names = [x.strip() for x in args.tasks.split(",") if x.strip()] or list(compare.TASKS)
    out_dir = settings.artifacts_dir / "compare"
    out_dir.mkdir(parents=True, exist_ok=True)
    from .config import REPO_ROOT

    with db.connect(settings.database_url) as conn:
        for name in names:
            res = compare.run_task(conn, settings.artifacts_dir, compare.TASKS[name], trials=args.trials, seed=args.seed,
                                   figures_dir=REPO_ROOT / "docs" / "reports" / "figures")
            (out_dir / f"{name}.json").write_text(json.dumps(res, indent=2, default=str), encoding="utf-8")
            print_comparison(res)
    return 0


def cmd_weather(args, settings) -> int:
    from . import weather
    from .config import REPO_ROOT

    with db.connect(settings.database_url) as conn:
        if not args.skip_geocode:
            weather.geocode_venues(conn, cache_dir=REPO_ROOT / "data" / "openmeteo")
        res = weather.fetch_and_store(conn, REPO_ROOT / "data" / "openmeteo")
    print(f"weather: {res['matches_with_weather']} cricket matches now have match-day weather")
    print("Data: Open-Meteo (open-meteo.com), free non-commercial API; ERA5 reanalysis. Replace or license before a commercial release.")
    return 0


def cmd_ablate(args, settings) -> int:
    from . import ablate

    names = [x.strip() for x in args.tasks.split(",") if x.strip()]
    out_dir = settings.artifacts_dir / "ablate"
    out_dir.mkdir(parents=True, exist_ok=True)
    with db.connect(settings.database_url) as conn:
        for name in names:
            if args.calibrated:
                groups = [g.strip() for g in args.groups.split(",") if g.strip()]
                res = ablate.run_cricket_calibrated(conn, settings.artifacts_dir, name, groups, trials=args.trials, seed=args.seed, with_weather=args.weather)
                (out_dir / f"{name}-calibrated.json").write_text(json.dumps(res, indent=2, default=str), encoding="utf-8")
                continue
            if name in ("football", "basketball"):
                res = ablate.run_team_sport(conn, settings.artifacts_dir, name, trials=args.trials, seed=args.seed)
            else:
                res = ablate.run_cricket(conn, settings.artifacts_dir, name, trials=args.trials, seed=args.seed, with_weather=args.weather)
            (out_dir / f"{name}.json").write_text(json.dumps(res, indent=2, default=str), encoding="utf-8")
            kg = res["kept_groups"]
            print(f"  kept by validation: {kg['groups'] or 'none'}")
            ex = res["new_ensemble_vs_existing"]
            print(f"  new-feature ensemble vs existing model on test: paired gain {ex['mean']:+.4f} ({ex['ci95'][0]:+.4f} to {ex['ci95'][1]:+.4f})")
    return 0


def cmd_audit(args, settings) -> int:
    from . import audit_run

    with db.connect(settings.database_url) as conn:
        res = audit_run.run(conn, settings.artifacts_dir, quick=args.quick)
    out = settings.artifacts_dir / "audit.json"
    out.write_text(json.dumps(res, indent=2, default=str), encoding="utf-8")
    print(f"audit saved to {out}")
    for sport in ("football", "basketball"):
        r = res[sport]
        cp, npb = r["causal_probe"], r["noise_probe"]
        print(f"{sport}: causal probe {'PASSED' if cp['passed'] else 'FAILED'} ({cp['matches_probed']} matches, max difference {cp['max_abs_difference']:.2e}); "
              f"noise probe skill {npb['skill_vs_base_pct']:+.2f}% vs base rates")
    c = res["cricket"]
    cp = c["causal_probe"]
    print(f"cricket: causal probe {'PASSED' if cp['passed'] else 'FAILED'} ({cp['matches_probed']} matches, max difference {cp['max_abs_difference']:.2e})")
    if "noise_probe" in c:
        print(f"cricket: noise probe AUC {c['noise_probe']['roc_auc']} (0.5 = no signal)")
    return 0


def cmd_thesportsdb(args, settings) -> int:
    from .config import REPO_ROOT
    from .ingest import thesportsdb as tsdb

    only = [x.strip() for x in args.leagues.split(",") if x.strip()] or None
    with db.connect(settings.database_url) as conn:
        try:
            rep = tsdb.fill(conn, REPO_ROOT / "data" / "thesportsdb", refresh=args.refresh, only=only)
        except tsdb.RateLimited:
            print("! thesportsdb rate-limited the shared free key; everything fetched so far is cached. Re-run in a few minutes.", file=sys.stderr)
            return 2
    print(f"thesportsdb: {rep.events} events read, {rep.filled} missing results filled")
    for lg, c in sorted(rep.per_league.items()):
        print(f"  {lg}: " + ", ".join(f"{k} {v}" for k, v in sorted(c.items())))
    if rep.compared:
        print(f"  validation against scores already stored: {rep.compared} compared, {100 * rep.same_score / rep.compared:.2f}% identical")
    for m in rep.mismatches[:10]:
        print(f"    differs: {m}")
    if rep.unmatched_teams:
        print("  team names not matched (add to TSDB_OVERRIDES): " + "; ".join(sorted(rep.unmatched_teams)))
    if rep.no_fixture:
        print(f"  {len(rep.no_fixture)} finished events had no stored fixture, e.g. " + "; ".join(rep.no_fixture[:5]))
    print("Data: TheSportsDB (thesportsdb.com), free development key.")
    return 0


def cmd_openfootball(args, settings) -> int:
    from .config import REPO_ROOT
    from .ingest import openfootball as of

    seasons = [x.strip() for x in args.seasons.split(",") if x.strip()]
    leagues = [x.strip() for x in args.leagues.split(",") if x.strip()] if args.leagues else list(of.LEAGUES)
    root = REPO_ROOT / "data" / "openfootball"
    files, failed = [], []
    for season in seasons:
        for league in leagues:
            path = root / season / f"{league}.json"
            try:
                if args.refresh or not path.exists():
                    path = of.download(season, league, root)
                files.append((season, league, path))
            except Exception as e:  # noqa: BLE001
                failed.append(f"{season}/{league}: {e}")
    for f in failed:
        print(f"! {f}", file=sys.stderr)
    with db.connect(settings.database_url) as conn:
        res = of.import_files(conn, files)
    print(f"openfootball: {len(files)} files imported, {len(failed)} could not be downloaded")
    for key, c in sorted(res.seasons.items()):
        print(f"  {key}: " + ", ".join(f"{k} {v}" for k, v in sorted(c.items())))
    print("  team decisions: " + ", ".join(f"{k} {v}" for k, v in res.team_decisions.items()))
    if res.new_teams:
        print(f"  new teams created ({len(res.new_teams)}): " + "; ".join(res.new_teams))
    if res.possible_duplicates:
        print("  CHECK possible duplicates of existing teams (add an OVERRIDES line if they are the same club): "
              + "; ".join(res.possible_duplicates))
    if res.unresolved_ambiguous:
        print("  ambiguous names: " + "; ".join(res.unresolved_ambiguous))
    if res.overlap_pairs:
        print(f"  overlap check vs API-Sports: {res.overlap_pairs} matches compared, "
              f"{100 * res.overlap_same_score / res.overlap_pairs:.2f}% same score, "
              f"{res.overlap_missing_in_db} in this source but not in the DB")
        for m in res.mismatches[:10]:
            print(f"    score mismatch: {m}")
    print("Data: openfootball (github.com/openfootball), CC0 1.0 public domain.")
    return 2 if failed and not files else 0


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

    sp = sub.add_parser("tune", help="tune a sport's settings before a cutoff, then score a one-shot holdout after it")
    sp.add_argument("--sport", choices=["football"], default="football")
    sp.add_argument("--trials", type=int, default=40)
    sp.add_argument("--cutoff", default="2025-07-01", help="the search only sees matches before this date (UTC)")
    sp.add_argument("--seed", type=int, default=7)
    sp.add_argument("--no-save", action="store_true")

    sp = sub.add_parser("compare", help="compare model families against the existing model on identical chronological windows")
    sp.add_argument("--tasks", default="", help="football,basketball,cricket-T20,cricket-ODI,cricket-Test (default: all)")
    sp.add_argument("--trials", type=int, default=25, help="Optuna trials per model family")
    sp.add_argument("--seed", type=int, default=0)

    sp = sub.add_parser("weather", help="geocode cricket venues and fetch match-day weather from Open-Meteo (cached, throttled)")
    sp.add_argument("--skip-geocode", action="store_true")

    sp = sub.add_parser("ablate", help="Phase 3: what do the new feature groups add on the untouched test window")
    sp.add_argument("--tasks", default="football,basketball", help="football,basketball,cricket-T20,cricket-ODI,cricket-Test")
    sp.add_argument("--trials", type=int, default=15)
    sp.add_argument("--seed", type=int, default=0)
    sp.add_argument("--calibrated", action="store_true", help="cricket: compare the existing model and new-feature models with per-segment temperature fitted on validation for both")
    sp.add_argument("--groups", default="recent", help="with --calibrated: feature groups to add (comma separated)")
    sp.add_argument("--weather", action="store_true", help="cricket: include the weather group (run `weather` first)")

    sp = sub.add_parser("audit", help="measured audit: data quality, leakage probes, overfitting, calibration, staleness")
    sp.add_argument("--quick", action="store_true", help="fewer probes (faster)")

    sp = sub.add_parser("thesportsdb", help="fill results openfootball lacks (slow, cached, uses a shared free key)")
    sp.add_argument("--leagues", default="", help="en.1,es.1,... (default: every league with missing results)")
    sp.add_argument("--refresh", action="store_true", help="ignore the cache and fetch again")

    sp = sub.add_parser("openfootball", help="import league results/fixtures from openfootball (CC0)")
    sp.add_argument("--seasons", default="2022-23,2023-24,2024-25,2025-26,2026-27", help="comma list, e.g. 2025-26,2026-27")
    sp.add_argument("--leagues", default="", help="en.1,es.1,it.1,de.1,fr.1 (default: all)")
    sp.add_argument("--refresh", action="store_true", help="re-download even if the file exists")

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
    if args.cmd == "tune":
        return cmd_tune(args, load_settings())
    if args.cmd == "weather":
        return cmd_weather(args, load_settings())
    if args.cmd == "ablate":
        return cmd_ablate(args, load_settings())
    if args.cmd == "compare":
        return cmd_compare(args, load_settings())
    if args.cmd == "audit":
        return cmd_audit(args, load_settings())
    if args.cmd == "thesportsdb":
        return cmd_thesportsdb(args, load_settings())
    if args.cmd == "openfootball":
        return cmd_openfootball(args, load_settings())
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
