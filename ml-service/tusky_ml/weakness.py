"""Where the football model is weak, measured on matches it was not fitted on.

One model is fitted on matches before the cutoff and scored on everything after it
(features stay causal). Segments are compared by "skill": how much lower the RPS is
than always quoting the training set's base rates, with a bootstrap 95% interval.

It also tests one calibration fix (sharpening or flattening every probability by a
single exponent). The exponent is chosen from rolling out-of-fold predictions made
before the cutoff, never from the matches it is judged on.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from . import tune
from .features import CONFIGS
from .models import make_predictor
from .pipeline import _baseline_probs, _probs, backtest

CUTOFF = datetime(2025, 7, 1, tzinfo=timezone.utc)
EARLY_MATCHES = 5
MIN_SEGMENT = 50
# the site labels favourites at or above this; keep in step with strongPickService.js
STRONG_PICK = 0.7


def season_of(ts: pd.Series) -> pd.Series:
    """Football seasons run July to June; returns the starting year."""
    return ts.dt.year - (ts.dt.month < 7).astype(int)


def context(matches: pd.DataFrame) -> pd.DataFrame:
    """Per match: how many games the less-played side has had this season, and whether
    either side was absent from this competition the season before. Uses only
    earlier fixtures, so both are known before kick-off."""
    m = matches.sort_values(["start_time", "match_id"]).copy()
    m["season"] = season_of(m["start_time"])
    present = set()
    for r in m.itertuples():
        present.add((r.competition_id, r.season, r.home_team_id))
        present.add((r.competition_id, r.season, r.away_team_id))
    first_season = m.groupby("competition_id")["season"].min().to_dict()
    played: dict[tuple, int] = {}
    rows = []
    for r in m.itertuples():
        keys = [(r.competition_id, r.season, t) for t in (r.home_team_id, r.away_team_id)]
        newcomer = r.season > first_season[r.competition_id] and any((c, s - 1, t) not in present for c, s, t in keys)
        rows.append((r.match_id, min(played.get(k, 0) for k in keys), newcomer))
        for k in keys:
            played[k] = played.get(k, 0) + 1
    return pd.DataFrame(rows, columns=["match_id", "games_before", "newcomer"]).set_index("match_id")


def outcomes(rows: pd.DataFrame) -> np.ndarray:
    """0 home win, 1 draw, 2 away win."""
    h, a = rows["home_score"].to_numpy(), rows["away_score"].to_numpy()
    return np.where(h > a, 0, np.where(h == a, 1, 2))


def log_loss_per_match(probs: np.ndarray, y: np.ndarray) -> np.ndarray:
    return -np.log(np.clip(probs[np.arange(len(y)), y], 1e-12, None))


def sharpen(probs: np.ndarray, gamma: float) -> np.ndarray:
    p = np.clip(probs, 1e-12, None) ** gamma
    return p / p.sum(axis=1, keepdims=True)


def choose_gamma(probs: np.ndarray, y: np.ndarray) -> float:
    grid = np.round(np.arange(0.70, 1.601, 0.01), 2)
    return float(min(grid, key=lambda g: log_loss_per_match(sharpen(probs, g), y).mean()))


def bootstrap_ci(values: np.ndarray, seed: int = 0, n: int = 2000) -> list[float]:
    rng = np.random.default_rng(seed)
    means = values[rng.integers(0, len(values), (n, len(values)))].mean(axis=1)
    return [round(float(np.percentile(means, 2.5)), 5), round(float(np.percentile(means, 97.5)), 5)]


def segment(probs: np.ndarray, base: np.ndarray, rows: pd.DataFrame, mask: np.ndarray, seed: int = 0) -> dict | None:
    n = int(mask.sum())
    if n < MIN_SEGMENT:
        return None
    p, b, r = probs[mask], base[mask], rows[mask]
    y = outcomes(r)
    rps, base_rps = tune.rps_per_match(p, r), tune.rps_per_match(b, r)
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n, (2000, n))
    skill = 1 - rps[idx].mean(axis=1) / base_rps[idx].mean(axis=1)
    return {
        "matches": n,
        "accuracy": round(float((p.argmax(axis=1) == y).mean()), 4),
        "home_baseline": round(float((y == 0).mean()), 4),
        "log_loss": round(float(log_loss_per_match(p, y).mean()), 4),
        "rps": round(float(rps.mean()), 4),
        "skill": round(float(1 - rps.mean() / base_rps.mean()), 4),
        "skill_ci95": [round(float(np.percentile(skill, 2.5)), 4), round(float(np.percentile(skill, 97.5)), 4)],
    }


def bands(prob: np.ndarray, hit: np.ndarray, edges: list[float]) -> list[dict]:
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (prob >= lo) & (prob < hi)
        if m.sum() >= 20:
            out.append({"from": lo, "to": hi, "matches": int(m.sum()), "predicted": round(float(prob[m].mean()), 3), "observed": round(float(hit[m].mean()), 3)})
    return out


def strong_picks(probs: np.ndarray, y: np.ndarray, threshold: float = STRONG_PICK) -> dict | None:
    """How often the favourite won when it was given at least `threshold`."""
    mask = probs.max(axis=1) >= threshold
    n = int(mask.sum())
    if n < MIN_SEGMENT:
        return None
    hit = (probs.argmax(axis=1) == y)[mask].astype(float)
    return {"threshold": threshold, "matches": n, "share": round(float(mask.mean()), 4), "observed": round(float(hit.mean()), 4), "ci95": bootstrap_ci(hit)}


def analyse(matches: pd.DataFrame, comp_names: dict[int, str], kind: str = "glm", cutoff: datetime = CUTOFF) -> dict:
    """`kind` should be the production model's kind, so that this describes what is live."""
    cfg = CONFIGS["football"]
    rows = tune._rows("football", matches, cfg)
    pre, post = rows[rows["start_time"] < cutoff], rows[rows["start_time"] >= cutoff]
    if len(post) < MIN_SEGMENT:
        raise ValueError(f"only {len(post)} matches after {cutoff.date()}: too few to analyse")

    with tune.use_config("football", cfg):
        probs = _probs(make_predictor("football", kind).fit(pre).predict(post))
    base = _baseline_probs(pre, len(post))
    y = outcomes(post)
    ctx = context(matches).loc[post["match_id"]]
    everything = np.ones(len(post), dtype=bool)

    segments = {
        "All matches": everything,
        f"Early season (a side has played under {EARLY_MATCHES})": (ctx["games_before"] < EARLY_MATCHES).to_numpy(),
        "Rest of season": (ctx["games_before"] >= EARLY_MATCHES).to_numpy(),
        "A side new to the league": ctx["newcomer"].to_numpy(dtype=bool),
        **{comp_names.get(int(c), str(c)): (post["competition_id"] == c).to_numpy() for c in sorted(post["competition_id"].dropna().unique())},
    }

    # the calibration fix: choose on pre-cutoff out-of-fold predictions, judge after it
    with tune.use_config("football", cfg):
        oof = backtest("football", pre, kind, folds=4)
    gamma = choose_gamma(_probs(oof), outcomes(pre.loc[oof.index]))
    fixed = sharpen(probs, gamma)
    ll_gain = log_loss_per_match(probs, y) - log_loss_per_match(fixed, y)  # positive = fix is better
    rps_gain = tune.rps_per_match(probs, post) - tune.rps_per_match(fixed, post)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "cutoff": cutoff.date().isoformat(),
        "model_kind": kind,
        "matches": len(post),
        "to": post["start_time"].max().date().isoformat(),
        "segments": {k: s for k, m in segments.items() if (s := segment(probs, base, post, m))},
        "draws": {
            "observed_rate": round(float((y == 1).mean()), 4),
            "mean_predicted": round(float(probs[:, 1].mean()), 4),
            "times_top_pick": int((probs.argmax(axis=1) == 1).sum()),
            "bands": bands(probs[:, 1], (y == 1).astype(float), [0.0, 0.2, 0.3, 1.01]),
        },
        "home_favourites": bands(probs[:, 0], (y == 0).astype(float), [0.5, 0.6, 0.7, 1.01]),
        "strong_picks": strong_picks(probs, y),
        "calibration_fix": {
            "exponent": gamma,
            "chosen_from_matches": int(len(oof)),
            "log_loss_gain": round(float(ll_gain.mean()), 5),
            "log_loss_gain_ci95": bootstrap_ci(ll_gain),
            "rps_gain": round(float(rps_gain.mean()), 5),
            "rps_gain_ci95": bootstrap_ci(rps_gain),
            "home_favourites": bands(fixed[:, 0], (y == 0).astype(float), [0.5, 0.6, 0.7, 1.01]),
            # a report, not a switch: production changes only through `retrain` (see promote.py)
            "interval_above_zero": bool(bootstrap_ci(ll_gain)[0] > 0 and bootstrap_ci(rps_gain)[0] > 0),
            "relative_log_loss_gain": round(float(ll_gain.mean() / log_loss_per_match(probs, y).mean()), 5),
        },
    }


def write(report: dict, artifacts_dir: Path) -> Path:
    path = artifacts_dir / "football" / "weakness.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return path
