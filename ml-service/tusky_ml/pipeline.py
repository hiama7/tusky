"""Train / evaluate / predict, independent of where the matches come from."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from . import __version__
from .features import CONFIGS, build_features, trainable
from .metrics import calibration, outcome_index, summarize
from .models import kinds_for, make_predictor


class NotEnoughData(RuntimeError):
    pass


@dataclass
class TrainedModel:
    sport: str
    kind: str
    version: str
    predictor: object
    report: dict


def _baseline_probs(train: pd.DataFrame, n: int) -> np.ndarray:
    """Predict the training set's home/draw/away frequencies for every match."""
    y = outcome_index(train["home_score"].to_numpy(), train["away_score"].to_numpy())
    freq = np.bincount(y, minlength=3) / len(y)
    freq = np.clip(freq, 1e-6, None)
    return np.tile(freq / freq.sum(), (n, 1))


def _probs(pred: pd.DataFrame) -> np.ndarray:
    return pred[["p_home", "p_draw", "p_away"]].to_numpy()


def _score_metrics(pred: pd.DataFrame, rows: pd.DataFrame) -> dict:
    hs, as_ = rows["home_score"].to_numpy(), rows["away_score"].to_numpy()
    return {
        "mae_home_score": round(float(np.mean(np.abs(pred["exp_home"] - hs))), 4),
        "mae_away_score": round(float(np.mean(np.abs(pred["exp_away"] - as_))), 4),
        "mae_margin": round(float(np.mean(np.abs((pred["exp_home"] - pred["exp_away"]) - (hs - as_)))), 4),
    }


def backtest(sport: str, rows: pd.DataFrame, kind: str, folds: int = 4, first_frac: float = 0.5) -> pd.DataFrame:
    """Rolling-origin backtest: the newest (1 - first_frac) of `rows` is cut into `folds`
    consecutive blocks; each block is predicted by a model fitted on everything before it.
    Returns out-of-fold predictions for those blocks (with a `fold` column)."""
    n = len(rows)
    start = int(n * first_frac)
    edges = np.linspace(start, n, folds + 1).astype(int)
    parts = []
    for f, (lo, hi) in enumerate(zip(edges[:-1], edges[1:])):
        if hi <= lo:
            continue
        model = make_predictor(sport, kind).fit(rows.iloc[:lo])
        pred = model.predict(rows.iloc[lo:hi])
        pred["fold"] = f
        parts.append(pred)
    return pd.concat(parts)


def _baseline_oof(rows: pd.DataFrame, oof: pd.DataFrame) -> np.ndarray:
    """Base rates as known before each fold (same information the models had)."""
    out = np.empty((len(oof), 3))
    pos = rows.index.get_indexer(oof.index)
    for f in oof["fold"].unique():
        m = (oof["fold"] == f).to_numpy()
        out[m] = _baseline_probs(rows.iloc[: pos[m].min()], int(m.sum()))
    return out


def train(
    sport: str,
    matches: pd.DataFrame,
    kind: str = "auto",
    folds: int = 4,
    min_matches: int = 300,
    now: datetime | None = None,
) -> TrainedModel:
    """Score every candidate with a rolling-origin backtest over the newest half of the
    played matches, pick the best, then refit it on all of them."""
    cfg = CONFIGS[sport]
    wide = build_features(matches, cfg)
    rows = trainable(wide, cfg)
    if len(rows) < min_matches:
        raise NotEnoughData(
            f"{sport}: only {len(rows)} usable completed matches (need {min_matches}). "
            "Backfill history first: npm run history:backfill -- --sport "
            f"{sport} --seasons <...>"
        )

    three_way = sport == "football"
    candidates = kinds_for(sport) if kind == "auto" else (kind,)
    results: dict[str, dict] = {}
    oofs: dict[str, pd.DataFrame] = {}
    for k in candidates:
        oof = backtest(sport, rows, k, folds=folds)
        va = rows.loc[oof.index]
        oofs[k] = oof
        results[k] = {
            **summarize(_probs(oof), va["home_score"].to_numpy(), va["away_score"].to_numpy(), three_way),
            **_score_metrics(oof, va),
        }

    key = "rps" if three_way else "log_loss"
    best = min(results, key=lambda k: results[k][key])
    oof = oofs[best]
    va = rows.loc[oof.index]
    hs_va, as_va = va["home_score"].to_numpy(), va["away_score"].to_numpy()
    baseline = summarize(_baseline_oof(rows, oof), hs_va, as_va, three_way)

    final = make_predictor(sport, best).fit(rows)

    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M")
    version = f"{sport}-{best}-{stamp}"
    report = {
        "sport": sport,
        "version": version,
        "kind": best,
        "package_version": __version__,
        "trained_at": (now or datetime.now(timezone.utc)).isoformat(),
        "n_matches_total": int(len(wide)),
        "n_train_rows": int(len(rows)),
        "n_folds": int(oof["fold"].nunique()),
        "n_validation": int(len(oof)),
        "validation_from": va["start_time"].min().isoformat(),
        "data_through": rows["start_time"].max().isoformat(),
        "selection_metric": key,
        "validation": results,
        "baseline_validation": baseline,
        "calibration_home": calibration(oof["p_home"].to_numpy(), (hs_va > as_va).astype(float)),
    }
    report.update(final.describe())
    if three_way:
        report["calibration_draw"] = calibration(oof["p_draw"].to_numpy(), (hs_va == as_va).astype(float))
    return TrainedModel(sport=sport, kind=best, version=version, predictor=final, report=report)


# ---- artifacts -----------------------------------------------------------------


def artifact_paths(artifacts_dir: Path, sport: str) -> tuple[Path, Path]:
    d = artifacts_dir / sport
    return d / "model.joblib", d / "report.json"


def save(model: TrainedModel, artifacts_dir: Path) -> Path:
    model_path, report_path = artifact_paths(artifacts_dir, model.sport)
    model_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, model_path)
    report_path.write_text(json.dumps(model.report, indent=2), encoding="utf-8")
    return model_path


def load(artifacts_dir: Path, sport: str) -> TrainedModel | None:
    model_path, _ = artifact_paths(artifacts_dir, sport)
    if not model_path.exists():
        return None
    return joblib.load(model_path)


# ---- prediction ------------------------------------------------------------------

FEATURE_SNAPSHOT = ["h_elo", "a_elo", "elo_p_home", "h_att", "h_def", "a_att", "a_def", "h_n", "a_n", "h_rest", "a_rest"]


def predict(
    model: TrainedModel,
    matches: pd.DataFrame,
    days_ahead: int = 14,
    match_ids: list[int] | None = None,
    now: datetime | None = None,
) -> pd.DataFrame:
    """Predict upcoming scheduled matches (or the given ids). Features use all history."""
    cfg = CONFIGS[model.sport]
    wide = build_features(matches, cfg)
    if match_ids:
        target = wide[wide["match_id"].isin(match_ids)]
    else:
        now_ts = pd.Timestamp(now or datetime.now(timezone.utc))
        horizon = now_ts + timedelta(days=days_ahead)
        target = wide[
            (wide["status"] == "scheduled") & (wide["start_time"] > now_ts) & (wide["start_time"] <= horizon)
        ]
    if target.empty:
        return pd.DataFrame(columns=["match_id", "p_home", "p_draw", "p_away", "exp_home", "exp_away", "details", "features"])

    pred = model.predictor.predict(target)
    pred.insert(0, "match_id", target["match_id"].astype(int).to_numpy())
    pred.insert(1, "start_time", target["start_time"].to_numpy())
    pred.insert(2, "home_team_id", target["home_team_id"].astype(int).to_numpy())
    pred.insert(3, "away_team_id", target["away_team_id"].astype(int).to_numpy())
    pred["features"] = [
        {c: round(float(v), 4) for c, v in row.items()} for row in target[FEATURE_SNAPSHOT].to_dict("records")
    ]
    return pred.reset_index(drop=True)
