"""Benchmark on synthetic leagues where the true scoring rates are known.

For every model kind it reports the backtest score of the model, of the base-rate
baseline, and of an oracle that knows the true rates, plus the share of the achievable
improvement the model captures: (baseline - model) / (baseline - oracle). 0% means no
better than base rates, 100% means as good as knowing the truth. Averaged over seeds so
a single lucky league can't decide a modelling change.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import norm

from . import metrics
from .features import CONFIGS, build_features, trainable
from .models import kinds_for, outcome_probs, score_grid
from .pipeline import _baseline_oof, backtest
from .synthetic import league


def _oracle_probs(sport: str, rows: pd.DataFrame, expected: dict) -> np.ndarray:
    eh = np.array([expected[m][0] for m in rows["match_id"]])
    ea = np.array([expected[m][1] for m in rows["match_id"]])
    if sport == "football":
        return outcome_probs(score_grid(eh, ea, 0.0, 10))
    p = norm.cdf((eh - ea) / (11 * np.sqrt(2)))
    return np.column_stack([p, np.zeros_like(p), 1 - p])


def _score(sport: str, probs: np.ndarray, rows: pd.DataFrame) -> dict:
    return metrics.summarize(probs, rows["home_score"].to_numpy(), rows["away_score"].to_numpy(), sport == "football")


def run(sports=("football", "basketball"), seeds: int = 5, seasons: int = 4, kinds: tuple[str, ...] | None = None) -> dict:
    out: dict = {}
    for sport in sports:
        cfg = CONFIGS[sport]
        key = "rps" if sport == "football" else "log_loss"
        per_kind: dict[str, list] = {}
        base_scores, oracle_scores = [], []
        for seed in range(seeds):
            matches, truth = league(sport, n_teams=20, seasons=seasons, seed=100 + seed)
            rows = trainable(build_features(matches, cfg), cfg)
            oof_ref = None
            for kind in kinds or kinds_for(sport):
                oof = backtest(sport, rows, kind)
                va = rows.loc[oof.index]
                m = _score(sport, oof[["p_home", "p_draw", "p_away"]].to_numpy(), va)
                m["calibration_error"] = _calibration_error(oof["p_home"].to_numpy(), (va["home_score"] > va["away_score"]).to_numpy())
                per_kind.setdefault(kind, []).append(m)
                oof_ref = oof
            va = rows.loc[oof_ref.index]
            base_scores.append(_score(sport, _baseline_oof(rows, oof_ref), va))
            oracle_scores.append(_score(sport, _oracle_probs(sport, va, truth["expected"]), va))

        def mean(ms: list[dict], k: str) -> float:
            return float(np.mean([m[k] for m in ms]))

        b, o = mean(base_scores, key), mean(oracle_scores, key)
        out[sport] = {
            "metric": key,
            "baseline": round(b, 5),
            "oracle": round(o, 5),
            "models": {
                kind: {
                    key: round(mean(ms, key), 5),
                    "log_loss": round(mean(ms, "log_loss"), 5),
                    "accuracy": round(mean(ms, "accuracy"), 4),
                    "calibration_error": round(mean(ms, "calibration_error"), 4),
                    "skill_captured": round((b - mean(ms, key)) / (b - o), 4),
                }
                for kind, ms in per_kind.items()
            },
        }
    return out


def _calibration_error(p: np.ndarray, hit: np.ndarray, bins: int = 10) -> float:
    """Expected calibration error of P(home win): bin-size-weighted |predicted - observed|."""
    idx = np.minimum((p * bins).astype(int), bins - 1)
    err = 0.0
    for b in range(bins):
        m = idx == b
        if m.any():
            err += m.mean() * abs(p[m].mean() - hit[m].mean())
    return float(err)


def print_bench(res: dict) -> None:
    for sport, r in res.items():
        k = r["metric"]
        print(f"\n{sport}: backtest {k} (lower is better), mean over seeds")
        print(f"  baseline {r['baseline']:.4f}   oracle {r['oracle']:.4f}")
        print(f"  {'model':<10} {k:>9} {'log_loss':>9} {'acc':>7} {'calib_err':>10} {'skill':>7}")
        for kind, m in r["models"].items():
            print(
                f"  {kind:<10} {m[k]:>9.4f} {m['log_loss']:>9.4f} {m['accuracy']:>7.3f}"
                f" {m['calibration_error']:>10.4f} {100 * m['skill_captured']:>6.1f}%"
            )
