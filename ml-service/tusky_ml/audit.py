"""Measured audit of the prediction pipeline (Phase 1).

Everything here is a measurement on the real database and the real saved models, not an
opinion: data inventory and quality, a causal leakage probe, a noise-label probe, in-sample vs
out-of-sample gaps, calibration against its finite-sample noise floor, and staleness.

Leakage probes (the important ones):
- Causal probe. For sampled matches, rebuild the features from ONLY the matches before it with
  the match's own result hidden, and require the same feature values as the full-history build.
  Any difference means the features used the future or the match's own outcome.
- Noise probe. Replace the real results by random ones and run the full pipeline. A pipeline
  without leakage can extract no skill from noise (log-loss and RPS stay at the base-rate level).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd

from . import metrics, pipeline, tune
from .cricket import data as cdata
from .cricket import features as cfeat
from .cricket import model as cmodel
from .features import CONFIGS, WIDE_FEATURES, build_features, normalize_matches, trainable
from .models import make_predictor

PROBE_TOL = 1e-9


# ---- generic probes (take the feature builder as a parameter so tests can inject a leaky one) -------


def causal_probe(
    builder: Callable[[pd.DataFrame], pd.DataFrame],
    matches: pd.DataFrame,
    columns: list[str],
    n: int = 12,
    seed: int = 0,
    min_index: int = 400,
) -> dict:
    """Rebuild features from matches before each sampled match (its own result hidden) and compare
    with the full-history build. `builder(matches)` must return a frame with `match_id` + `columns`."""
    m = normalize_matches(matches)
    full = builder(m).set_index("match_id")
    scored = m.index[(m["home_score"].notna()) & (m.index >= min_index)].to_numpy()
    rng = np.random.default_rng(seed)
    picks = rng.choice(scored, size=min(n, len(scored)), replace=False)
    worst, failures = 0.0, []
    for i in picks:
        cut = m.iloc[: i + 1].copy()
        cut.loc[cut.index[-1], ["home_score", "away_score"]] = np.nan  # hide the match's own result
        cut.loc[cut.index[-1], "status"] = "scheduled"
        mid = m.loc[i, "match_id"]
        rebuilt = builder(cut).set_index("match_id").loc[mid, columns].astype(float)
        diff = (rebuilt - full.loc[mid, columns].astype(float)).abs()
        d = float(diff.max())
        worst = max(worst, d)
        if d > PROBE_TOL:
            failures.append({"match_id": int(mid), "max_abs_diff": d, "feature": str(diff.idxmax())})
    return {"matches_probed": int(len(picks)), "max_abs_difference": worst, "failures": failures, "passed": not failures}


def noise_probe(sport: str, matches: pd.DataFrame, seed: int = 0) -> dict:
    """Shuffle the real score pairs across matches (teams and dates stay) and run the real backtest.
    Without leakage the model finds no signal, so its skill over base rates must be about zero."""
    m = normalize_matches(matches).copy()
    idx = m.index[m["home_score"].notna()].to_numpy()
    rng = np.random.default_rng(seed)
    perm = rng.permutation(idx)
    m.loc[idx, ["home_score", "away_score"]] = m.loc[perm, ["home_score", "away_score"]].to_numpy()
    cfg = CONFIGS[sport]
    rows = trainable(build_features(m, cfg), cfg)
    oof = pipeline.backtest(sport, rows, "glm" if sport == "football" else "linear")
    va = rows.loc[oof.index]
    three = sport == "football"
    got = tune.score(sport, pipeline._probs(oof), va)
    base = tune.score(sport, pipeline._baseline_oof(rows, oof), va)
    key = "rps" if three else "log_loss"
    return {"metric": key, "shuffled_model": got[key], "base_rates": base[key],
            "skill_vs_base_pct": round(100 * (base[key] - got[key]) / base[key], 3), "n": int(len(va))}


# ---- cricket truncation helpers ------------------------------------------------------------------------


def _cricket_cut(data: cdata.CricketData, match_id: int) -> cdata.CricketData:
    ms = data.matches.sort_values(["start_time", "match_id"], kind="stable").reset_index(drop=True)
    pos = int(ms.index[ms["match_id"] == match_id][0])
    keep = ms.iloc[: pos + 1].copy()
    ids = set(keep["match_id"])
    row = keep.index[-1]
    keep.loc[row, ["winner", "result_type"]] = [np.nan, None]  # the match's own result is hidden
    keep.loc[row, "status"] = "scheduled"
    other = lambda df: df[df["match_id"].isin(ids - {match_id})]  # noqa: E731
    return cdata.CricketData(
        matches=keep, innings=other(data.innings), batting=other(data.batting), bowling=other(data.bowling),
        lineups=data.lineups[data.lineups["match_id"].isin(ids)],  # the playing XI is known at the toss
    )


def cricket_causal_probe(data: cdata.CricketData, n: int = 6, seed: int = 0) -> dict:
    full = cfeat.build_features(data).set_index("match_id")
    cols = [c for c in full.columns if c.startswith(("pre_xi_", "post_xi_", "fi_", "fi1_", "fi2_"))
            or c in cfeat.POST_FEATURES]
    cols = [c for c in cols if c not in ("fi_bat_first",) or True]
    eligible = full[(full["toss_a"] != 0) & full["label"].notna()]
    eligible = eligible.iloc[400:]
    rng = np.random.default_rng(seed)
    picks = rng.choice(eligible.index.to_numpy(), size=min(n, len(eligible)), replace=False)
    worst, failures = 0.0, []
    for mid in picks:
        rebuilt = cfeat.build_features(_cricket_cut(data, int(mid))).set_index("match_id").loc[mid]
        a = rebuilt[cols].astype(float).fillna(-9999.0)
        b = full.loc[mid, cols].astype(float).fillna(-9999.0)
        diff = (a - b).abs()
        d = float(diff.max())
        worst = max(worst, d)
        if d > PROBE_TOL:
            failures.append({"match_id": int(mid), "max_abs_diff": d, "feature": str(diff.idxmax())})
    return {"matches_probed": int(len(picks)), "features_compared": len(cols), "max_abs_difference": worst,
            "failures": failures, "passed": not failures}


def cricket_noise_probe(data: cdata.CricketData, fmt: str = "T20", seed: int = 0) -> dict:
    """Replace real winners by coin flips and run the real pipeline: AUC must stay near 0.5."""
    d = cdata.CricketData(matches=data.matches.copy(), innings=data.innings, batting=data.batting,
                          bowling=data.bowling, lineups=data.lineups)
    rng = np.random.default_rng(seed)
    decided = d.matches["winner"].notna() & d.matches["result_type"].isin(["normal", "dls", "super_over"])
    flip = rng.random(int(decided.sum())) < 0.5
    t1, t2 = d.matches.loc[decided, "team1"].to_numpy(), d.matches.loc[decided, "team2"].to_numpy()
    d.matches.loc[decided, "winner"] = np.where(flip, t1, t2)
    feats = cfeat.build_features(d)
    rows = cmodel.win_rows(feats, fmt)
    p = cmodel._backtest_win(rows, fmt, "post", "logistic")
    va = cmodel._oof_rows(rows)
    out = cmodel.win_metrics(p, va, fmt)
    return {"format": fmt, "n": out["n"], "roc_auc": out.get("roc_auc"), "log_loss": out["log_loss"], "coin_flip_log_loss": round(float(np.log(2)), 5)}


# ---- in-sample vs out-of-sample ------------------------------------------------------------------------


def overfit_gap(sport: str, rows: pd.DataFrame, kinds: tuple[str, ...], frac: float = 0.6) -> dict:
    cut = int(len(rows) * frac)
    tr, te = rows.iloc[:cut], rows.iloc[cut:]
    key = "rps" if sport == "football" else "log_loss"
    out = {}
    for kind in kinds:
        model = make_predictor(sport, kind).fit(tr)
        a = tune.score(sport, pipeline._probs(model.predict(tr)), tr)
        b = tune.score(sport, pipeline._probs(model.predict(te)), te)
        out[kind] = {"train": a, "test": b, "gap_" + key: round(b[key] - a[key], 5),
                     "train_vs_test_accuracy_gap": round(a["accuracy"] - b["accuracy"], 4)}
    return {"n_train": int(len(tr)), "n_test": int(len(te)), "by_model": out}


def cricket_overfit_gap(feats: pd.DataFrame, fmt: str, frac: float = 0.6) -> dict:
    rows = cmodel.win_rows(feats, fmt)
    cut = int(len(rows) * frac)
    tr, te = rows.iloc[:cut], rows.iloc[cut:]
    out = {}
    for kind in ("logistic", "hgb"):
        m = cmodel.WinModel(fmt, "post", kind).fit(tr)
        a, b = cmodel.win_metrics(m.predict(tr), tr, fmt), cmodel.win_metrics(m.predict(te), te, fmt)
        out[kind] = {"train": a, "test": b, "gap_log_loss": round(b["log_loss"] - a["log_loss"], 5),
                     "train_vs_test_accuracy_gap": round(a["accuracy"] - b["accuracy"], 4)}
    return {"n_train": int(len(tr)), "n_test": int(len(te)), "by_model": out}


# ---- calibration -----------------------------------------------------------------------------------------


def calibration_summary(p_win: np.ndarray, hit: np.ndarray, probs3: np.ndarray | None = None, y3: np.ndarray | None = None) -> dict:
    out = {
        "n": int(len(p_win)),
        "log_loss": None, "brier_binary": round(metrics.brier_binary(p_win, hit), 5),
        "ece": round(metrics.expected_calibration_error(p_win, hit), 5),
        "ece_noise_floor": metrics.ece_noise_floor(p_win),
        "reliability": metrics.reliability_table(p_win, hit),
    }
    q = np.clip(p_win, 1e-12, 1 - 1e-12)
    out["log_loss"] = round(float(-np.mean(hit * np.log(q) + (1 - hit) * np.log(1 - q))), 5)
    if probs3 is not None:
        out["classwise_ece"] = round(metrics.classwise_ece(probs3, y3), 5)
    out["verdict"] = ("indistinguishable from perfectly calibrated" if out["ece"] <= out["ece_noise_floor"]["p95"]
                      else "miscalibrated beyond sampling noise")
    return out


# ---- data inventory and quality (SQL) -----------------------------------------------------------------


def inventory(conn, artifacts_dir: Path) -> dict:
    now = datetime.now(timezone.utc)
    rows = conn.execute(
        """select s.code, count(*), count(m.home_score), count(*) filter (where m.status = 'scheduled'),
                  min(m.start_time), max(m.start_time) filter (where m.home_score is not null)
           from matches m join sports s on s.id = m.sport_id group by 1 order by 1"""
    ).fetchall()
    out: dict = {}
    for code, n, scored, upcoming, first, last in rows:
        out[code] = {"matches": n, "scored": scored, "upcoming": upcoming, "first": first.date().isoformat(),
                     "last_result": last.date().isoformat(), "days_since_last_result": (now - last).days}
    preds = conn.execute(
        "select s.code, count(*), count(distinct p.model_version) from predictions p join sports s on s.id = p.sport_id group by 1"
    ).fetchall()
    for code, n, versions in preds:
        out[code]["stored_predictions"] = n
        out[code]["prediction_versions"] = versions
    out["models"] = {}
    for label, path in (("football", "football"), ("basketball", "basketball"), ("cricket T20", "cricket/T20"),
                        ("cricket ODI", "cricket/ODI"), ("cricket Test", "cricket/Test")):
        rp = artifacts_dir / path / "report.json"
        if rp.exists():
            r = json.loads(rp.read_text(encoding="utf-8"))
            trained = datetime.fromisoformat(r["trained_at"])
            out["models"][label] = {"version": r["version"], "trained_at": r["trained_at"][:10],
                                    "data_through": r["data_through"][:10], "days_since_training": (now - trained).days,
                                    "data_age_at_training_days": (trained - datetime.fromisoformat(r["data_through"])).days}
    return out


def data_quality(conn) -> dict:
    q = lambda sql, *a: conn.execute(sql, a).fetchone()[0]  # noqa: E731
    out: dict = {}
    for sport in ("football", "basketball"):
        out[sport] = {
            "same_fixture_duplicates_36h": q("""select count(*) from matches a join matches b on a.id < b.id and a.sport_id = b.sport_id
                and a.home_team_id = b.home_team_id and a.away_team_id = b.away_team_id
                and abs(extract(epoch from a.start_time - b.start_time)) < 36 * 3600
                join sports s on s.id = a.sport_id and s.code = %s""", sport),
            "completed_without_score": q("select count(*) from matches m join sports s on s.id = m.sport_id where s.code = %s and m.status = 'completed' and m.home_score is null", sport),
            "scored_but_not_completed": q("select count(*) from matches m join sports s on s.id = m.sport_id where s.code = %s and m.home_score is not null and m.status <> 'completed'", sport),
            "negative_scores": q("select count(*) from matches m join sports s on s.id = m.sport_id where s.code = %s and (m.home_score < 0 or m.away_score < 0)", sport),
            "teams_with_under_10_matches": q("""select count(*) from (select t.id from teams t join sports s on s.id = t.sport_id and s.code = %s
                left join matches m on t.id in (m.home_team_id, m.away_team_id) group by t.id having count(m.id) < 10) x""", sport),
        }
    out["cricket"] = {
        "matches_without_innings": q("select count(*) from matches m join sports s on s.id = m.sport_id and s.code = 'cricket' where not exists (select 1 from cricket_innings i where i.match_id = m.id)"),
        "matches_without_lineups": q("select count(*) from matches m join sports s on s.id = m.sport_id and s.code = 'cricket' where not exists (select 1 from match_lineups l where l.match_id = m.id)"),
        "matches_without_toss": q("select count(*) from matches m join sports s on s.id = m.sport_id and s.code = 'cricket' where m.toss_winner_team_id is null"),
        "matches_without_venue": q("select count(*) from matches m join sports s on s.id = m.sport_id and s.code = 'cricket' where m.venue_id is null"),
        "duplicate_source_files": q("select count(*) from (select file_name from ingest_files where source = 'cricsheet' group by 1 having count(*) > 1) x"),
        "failed_import_files": q("select count(*) from ingest_files where status = 'failed'"),
        "duplicate_exact_start_same_teams": q("""select count(*) from matches a join matches b on a.id < b.id and a.sport_id = b.sport_id
            and a.home_team_id = b.home_team_id and a.away_team_id = b.away_team_id and a.start_time = b.start_time
            join sports s on s.id = a.sport_id and s.code = 'cricket'"""),
    }
    return out


def missing_values(sport_rows: dict[str, pd.DataFrame]) -> dict:
    out = {}
    for name, df in sport_rows.items():
        num = df.select_dtypes("number")
        out[name] = {"rows": int(len(df)), "columns": int(num.shape[1]),
                     "cells_nan": int(num.isna().sum().sum()), "cells_inf": int(np.isinf(num.to_numpy(dtype=float)).sum())}
    return out
