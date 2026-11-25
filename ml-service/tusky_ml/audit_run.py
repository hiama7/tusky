"""Runs every audit check on the real database and saved models (see audit.py for the checks)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from . import audit, db, metrics, pipeline, tune
from .cricket import data as cdata
from .cricket import features as cfeat
from .cricket import model as cmodel
from .features import CONFIGS, TEAM_FEATURES, WIDE_FEATURES, build_features, team_rows, trainable


def _subset(data: cdata.CricketData, fmt: str) -> cdata.CricketData:
    ids = set(data.matches.loc[data.matches["format"] == fmt, "match_id"])
    keep = lambda df: df[df["match_id"].isin(ids)]  # noqa: E731
    return cdata.CricketData(matches=keep(data.matches), innings=keep(data.innings), batting=keep(data.batting),
                             bowling=keep(data.bowling), lineups=keep(data.lineups))


def team_sport(sport: str, conn, artifacts_dir: Path, quick: bool, log) -> dict:
    matches = db.load_matches(conn, sport)
    if sport == "football":
        tune.apply_saved(artifacts_dir, sport)
    cfg = CONFIGS[sport]
    report = json.loads((artifacts_dir / sport / "report.json").read_text(encoding="utf-8"))
    kind = report["kind"]
    rows = trainable(build_features(matches, cfg), cfg)
    home, away = team_rows(rows)
    out: dict = {"selected_model": kind,
                 "settings": "tuned" if sport == "football" and (artifacts_dir / sport / "config.json").exists() else "default",
                 "sample": {"usable_matches": int(len(rows)), "features_per_team_row": len(TEAM_FEATURES),
                            "matches_per_feature": round(len(rows) / len(TEAM_FEATURES), 1)},
                 "missing_values": audit.missing_values({"home_rows": home, "away_rows": away})}
    log(f"  {sport}: causal probe ...")
    out["causal_probe"] = audit.causal_probe(lambda m: build_features(m, cfg), matches, WIDE_FEATURES, n=6 if quick else 12)
    log(f"  {sport}: noise probe ...")
    out["noise_probe"] = audit.noise_probe(sport, matches)
    log(f"  {sport}: in-sample vs out-of-sample ...")
    kinds = ("glm", "hgb", "ensemble") if sport == "football" else ("linear", "hgb", "ensemble")
    out["overfit_gap"] = audit.overfit_gap(sport, rows, kinds)
    log(f"  {sport}: calibration ...")
    oof = pipeline.backtest(sport, rows, kind)
    va = rows.loc[oof.index]
    y = metrics.outcome_index(va["home_score"].to_numpy(), va["away_score"].to_numpy())
    probs = pipeline._probs(oof)
    if sport == "football":
        out["calibration"] = {"home_win": audit.calibration_summary(probs[:, 0], (y == 0).astype(float), probs, y),
                              "draw": audit.calibration_summary(probs[:, 1], (y == 1).astype(float))}
    else:
        out["calibration"] = {"home_win": audit.calibration_summary(probs[:, 0], (y == 0).astype(float))}
    out["backtest"] = tune.score(sport, probs, va)
    out["backtest"]["baseline"] = tune.score(sport, pipeline._baseline_oof(rows, oof), va)
    return out


def cricket(conn, artifacts_dir: Path, quick: bool, log) -> dict:
    data = cdata.load(conn)
    feats = cfeat.build_features(data)
    out: dict = {"formats": {}}
    out["missing_values"] = audit.missing_values({
        "pre_features": cmodel.stage_matrix(feats, "pre"), "post_features": cmodel.stage_matrix(feats, "post"),
        "first_innings_features": feats[cmodel.FI_FEATURES]})
    t20 = _subset(data, "T20")
    log("  cricket: causal probe (T20) ...")
    out["causal_probe"] = audit.cricket_causal_probe(t20, n=3 if quick else 6)
    if not quick:
        log("  cricket: noise probe (T20) ...")
        out["noise_probe"] = audit.cricket_noise_probe(t20)
    for fmt in ("T20", "ODI", "Test"):
        log(f"  cricket {fmt}: overfit gap + calibration ...")
        rows = cmodel.win_rows(feats, fmt)
        report = json.loads((artifacts_dir / "cricket" / fmt / "report.json").read_text(encoding="utf-8"))
        kind = report["post"]["selected"]
        va = cmodel._oof_rows(rows)
        p = cmodel._backtest_win(rows, fmt, "post", kind)
        y = cmodel._labels_idx(va)
        entry = {"selected_model": kind, "usable_matches": int(len(rows)), "overfit_gap": audit.cricket_overfit_gap(feats, fmt),
                 "backtest": cmodel.win_metrics(p, va, fmt)}
        if fmt == "Test":
            entry["calibration"] = {"team1_win": audit.calibration_summary(p[:, 0], (y == 0).astype(float), p, y)}
        else:
            entry["calibration"] = {"team1_win": audit.calibration_summary(p[:, 0] / (p[:, 0] + p[:, 2]), (y == 0).astype(float))}
        out["formats"][fmt] = entry
    return out


def run(conn, artifacts_dir: Path, quick: bool = False, log=print) -> dict:
    res: dict = {"run_at": datetime.now(timezone.utc).isoformat(), "quick": quick}
    log("inventory and data quality ...")
    res["inventory"] = audit.inventory(conn, artifacts_dir)
    res["data_quality"] = audit.data_quality(conn)
    res["football"] = team_sport("football", conn, artifacts_dir, quick, log)
    res["basketball"] = team_sport("basketball", conn, artifacts_dir, quick, log)
    res["cricket"] = cricket(conn, artifacts_dir, quick, log)
    return res
