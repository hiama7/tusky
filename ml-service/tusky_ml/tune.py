"""Tuning of the per-sport settings ("weights") and a one-shot holdout evaluation.

Protocol (so the reported numbers are honest):
1. Search: random search over `SportConfig` settings. Every trial is scored by the usual
   rolling-origin backtest, using ONLY matches before `cutoff`.
2. Ensemble weight: with the best settings, the GLM and gradient-boosting out-of-fold
   probabilities are mixed at weights 0..1 (a linear mix of outcome probabilities is exactly
   what mixing the scoreline grids gives) and the best mix is kept. Still before `cutoff`.
3. Holdout: the default and the tuned settings are each fitted ONCE on matches before `cutoff`
   and scored on every match from `cutoff` on, which the search never saw. Features keep
   updating through the holdout (each match only sees earlier results), but the regression
   weights stay frozen. A "frozen ratings" run hides all results after `cutoff` from the
   features to show how much the newer data itself is worth.
4. The tuned settings are adopted only if they beat the defaults on that holdout.
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from dataclasses import asdict, replace
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from . import metrics
from .features import CONFIGS, SportConfig, build_features, normalize_matches, trainable
from .metrics import calibration, outcome_index
from .pipeline import _baseline_probs, backtest, _probs
from .models import make_predictor

SPACE: dict[str, dict[str, tuple]] = {
    "football": {
        "rating_lr": ("log", 0.01, 0.12),
        "rating_warmup": ("float", 2.0, 8.0),
        "form_alpha": ("float", 0.04, 0.25),
        "elo_k": ("float", 10.0, 40.0),
        "elo_hfa": ("float", 30.0, 100.0),
        "offseason_regress": ("float", 0.1, 0.6),
        "sample_half_life_days": ("choice", [None, 180.0, 365.0, 730.0]),
    },
}
FAST_KIND = {"football": "glm", "basketball": "linear"}
WEIGHTS = [round(w, 2) for w in np.linspace(0, 1, 11)]


@contextmanager
def use_config(sport: str, cfg: SportConfig):
    """Temporarily make `cfg` the active settings for `sport` (models read CONFIGS at creation)."""
    old = CONFIGS[sport]
    CONFIGS[sport] = cfg
    try:
        yield cfg
    finally:
        CONFIGS[sport] = old


def sample(space: dict[str, tuple], rng: np.random.Generator) -> dict:
    out: dict = {}
    for k, spec in space.items():
        if spec[0] == "log":
            out[k] = round(float(np.exp(rng.uniform(np.log(spec[1]), np.log(spec[2])))), 5)
        elif spec[0] == "float":
            out[k] = round(float(rng.uniform(spec[1], spec[2])), 4)
        else:
            out[k] = spec[1][int(rng.integers(len(spec[1])))]
    return out


def _key(sport: str) -> str:
    return "rps" if sport == "football" else "log_loss"


def score(sport: str, probs: np.ndarray, rows: pd.DataFrame) -> dict:
    return metrics.summarize(probs, rows["home_score"].to_numpy(), rows["away_score"].to_numpy(), sport == "football")


def rps_per_match(probs: np.ndarray, rows: pd.DataFrame) -> np.ndarray:
    y = outcome_index(rows["home_score"].to_numpy(), rows["away_score"].to_numpy())
    onehot = np.zeros_like(probs)
    onehot[np.arange(len(y)), y] = 1.0
    return np.sum((np.cumsum(probs, axis=1)[:, :-1] - np.cumsum(onehot, axis=1)[:, :-1]) ** 2, axis=1) / 2.0


def _rows(sport: str, matches: pd.DataFrame, cfg: SportConfig) -> pd.DataFrame:
    return trainable(build_features(matches, cfg), cfg)


def objective(sport: str, matches_pre: pd.DataFrame, cfg: SportConfig, kind: str | None = None) -> tuple[float, pd.DataFrame, pd.DataFrame]:
    """Rolling-backtest score (lower is better) of `cfg` on pre-cutoff matches with the fast model."""
    with use_config(sport, cfg):
        rows = _rows(sport, matches_pre, cfg)
        oof = backtest(sport, rows, kind or FAST_KIND[sport], folds=4)
    va = rows.loc[oof.index]
    return score(sport, _probs(oof), va)[_key(sport)], oof, va


def search(sport: str, matches_pre: pd.DataFrame, trials: int, seed: int, log=print) -> dict:
    base = CONFIGS[sport]
    key = _key(sport)
    rng = np.random.default_rng(seed)
    default_score, _, _ = objective(sport, matches_pre, base)
    log(f"  default settings: {key} {default_score:.5f}")
    history = [{"params": {}, "score": default_score}]
    best_params, best = {}, default_score
    for i in range(trials):
        params = sample(SPACE[sport], rng)
        s, _, _ = objective(sport, matches_pre, replace(base, **params))
        history.append({"params": params, "score": s})
        if s < best:
            best, best_params = s, params
            log(f"  trial {i + 1}/{trials}: new best {key} {s:.5f}")
    return {"default_score": default_score, "best_score": best, "best_params": best_params, "history": history}


def tune_weight(sport: str, matches_pre: pd.DataFrame, cfg: SportConfig) -> dict:
    """Best linear mix of the first two models' out-of-fold probabilities."""
    first = FAST_KIND[sport]
    _, oof_a, va = objective(sport, matches_pre, cfg, kind=first)
    _, oof_b, _ = objective(sport, matches_pre, cfg, kind="hgb")
    pa, pb = _probs(oof_a), _probs(oof_b.loc[oof_a.index])
    key = _key(sport)
    table = {w: score(sport, w * pa + (1 - w) * pb, va)[key] for w in WEIGHTS}
    best = min(table, key=table.get)
    return {"best_weight": best, "table": {str(k): round(v, 5) for k, v in table.items()}, "n": int(len(va))}


def _fit_predict(sport: str, cfg: SportConfig, pre: pd.DataFrame, post_features: pd.DataFrame) -> np.ndarray:
    with use_config(sport, cfg):
        model = make_predictor(sport, "ensemble").fit(pre)
        return _probs(model.predict(post_features))


def holdout(sport: str, matches: pd.DataFrame, cutoff: pd.Timestamp, default: SportConfig, tuned: SportConfig,
            comp_names: dict[int, str] | None = None, seed: int = 0) -> dict:
    """Fit on pre-cutoff matches once, score everything from the cutoff on."""
    out: dict = {"cutoff": cutoff.isoformat()}
    probs: dict[str, np.ndarray] = {}
    frozen_matches = matches.copy()
    late = frozen_matches["start_time"] >= cutoff
    frozen_matches.loc[late, ["home_score", "away_score"]] = np.nan
    frozen_matches.loc[late, "status"] = "scheduled"

    for name, cfg in (("default", default), ("tuned", tuned)):
        rows = _rows(sport, matches, cfg)
        pre, post = rows[rows["start_time"] < cutoff], rows[rows["start_time"] >= cutoff]
        probs[name] = _fit_predict(sport, cfg, pre, post)
        if name == "default":
            ref_post, ref_pre = post, pre
        elif not post["match_id"].equals(ref_post["match_id"]):
            raise RuntimeError("holdout match sets differ between configs; compare like with like")
        # Same fitted model, but ratings that stopped learning at the cutoff.
        with use_config(sport, cfg):
            frozen = build_features(frozen_matches, cfg).set_index("match_id").loc[post["match_id"]].reset_index()
            frozen.index = post.index
        probs[f"{name}_frozen"] = _fit_predict(sport, cfg, pre, frozen)

    post = ref_post
    probs["base_rates"] = _baseline_probs(ref_pre, len(post))
    key = _key(sport)
    out["n_pre"], out["n_holdout"] = int(len(ref_pre)), int(len(post))
    out["holdout_from"], out["holdout_to"] = post["start_time"].min().isoformat(), post["start_time"].max().isoformat()
    out["scores"] = {k: score(sport, p, post) for k, p in probs.items()}

    if sport == "football":
        per = {k: rps_per_match(p, post) for k, p in probs.items()}
        rng = np.random.default_rng(seed)

        def paired(a: str, b: str) -> dict:
            d = per[a] - per[b]  # positive = b is better
            boots = [d[rng.integers(0, len(d), len(d))].mean() for _ in range(2000)]
            return {"mean_rps_gain": round(float(d.mean()), 5), "ci95": [round(float(np.percentile(boots, 2.5)), 5), round(float(np.percentile(boots, 97.5)), 5)]}

        out["paired_gain"] = {
            "tuned_vs_default": paired("default", "tuned"),
            "new_data_vs_frozen_default": paired("default_frozen", "default"),
            "new_data_vs_frozen_tuned": paired("tuned_frozen", "tuned"),
            "default_vs_base_rates": paired("base_rates", "default"),
            "tuned_vs_base_rates": paired("base_rates", "tuned"),
        }
    out["calibration_home_tuned"] = calibration(probs["tuned"][:, 0], (post["home_score"] > post["away_score"]).to_numpy().astype(float))
    out["calibration_draw_tuned"] = calibration(probs["tuned"][:, 1], (post["home_score"] == post["away_score"]).to_numpy().astype(float))

    # Breakdowns: per competition and per season.
    seg: dict[str, dict] = {}
    groups = {
        **{(comp_names or {}).get(int(c), str(c)): m for c, m in post.groupby("competition_id").groups.items()},
        "2025-26": post.index[(post["start_time"] < datetime(2026, 7, 1, tzinfo=timezone.utc))],
        "2026-27 so far": post.index[(post["start_time"] >= datetime(2026, 7, 1, tzinfo=timezone.utc))],
    }
    pos = {idx: i for i, idx in enumerate(post.index)}
    for label, idx in groups.items():
        sel = np.array([pos[i] for i in idx])
        if len(sel) < 30:
            continue
        sub = post.loc[idx]
        seg[label] = {
            "n": int(len(sel)),
            **{k: round(score(sport, probs[k][sel], sub)[key], 5) for k in ("base_rates", "default", "tuned", "default_frozen", "tuned_frozen")},
        }
    out["segments"] = seg
    out["metric"] = key
    return out


def save_config(artifacts_dir: Path, sport: str, cfg: SportConfig, meta: dict) -> Path:
    path = artifacts_dir / sport / "config.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    keys = [k for k in (*SPACE.get(sport, {}), "ensemble_weight") if k in asdict(cfg)]
    path.write_text(json.dumps({"params": {k: asdict(cfg)[k] for k in keys}, **meta}, indent=2, default=str), encoding="utf-8")
    return path


def apply_saved(artifacts_dir: Path, sport: str) -> dict:
    """Make the saved tuned settings (if any) the active ones. Returns what was applied."""
    path = artifacts_dir / sport / "config.json"
    if not path.exists():
        return {}
    params = json.loads(path.read_text(encoding="utf-8"))["params"]
    CONFIGS[sport] = replace(CONFIGS[sport], **params)
    return params


def run(sport: str, matches: pd.DataFrame, cutoff: str, trials: int, seed: int, comp_names: dict[int, str] | None = None, log=print) -> dict:
    if sport not in SPACE:
        raise ValueError(f"no tuning space defined for '{sport}' yet")
    matches = normalize_matches(matches)
    cut = pd.Timestamp(cutoff, tz="UTC")
    pre = matches[matches["start_time"] < cut]
    base = CONFIGS[sport]
    log(f"tuning {sport}: {len(pre)} matches before {cutoff}, {trials} trials, seed {seed}")
    found = search(sport, pre, trials, seed, log)
    tuned = replace(base, **found["best_params"])
    log("  tuning the ensemble weight ...")
    w = tune_weight(sport, pre, tuned)
    tuned = replace(tuned, ensemble_weight=w["best_weight"])
    log("  scoring the holdout once ...")
    ho = holdout(sport, matches, cut, base, tuned, comp_names, seed)
    key = _key(sport)
    adopt = ho["scores"]["tuned"][key] < ho["scores"]["default"][key]
    return {
        "sport": sport, "seed": seed, "trials": trials, "cutoff": cutoff,
        "run_at": datetime.now(timezone.utc).isoformat(),
        "default_params": {k: asdict(base)[k] for k in (*SPACE[sport], "ensemble_weight")},
        "search": {k: found[k] for k in ("default_score", "best_score", "best_params")},
        "top_trials": sorted(found["history"], key=lambda h: h["score"])[:8],
        "ensemble_weight": w,
        "holdout": ho,
        "adopted": bool(adopt),
        "tuned_config": tuned,
    }
