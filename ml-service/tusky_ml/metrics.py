"""Probabilistic scoring rules. Lower is better for all losses."""

from __future__ import annotations

import numpy as np


def outcome_index(home: np.ndarray, away: np.ndarray) -> np.ndarray:
    """0 = home win, 1 = draw, 2 = away win."""
    return np.where(home > away, 0, np.where(home == away, 1, 2))


def log_loss(probs: np.ndarray, y: np.ndarray) -> float:
    p = np.clip(probs[np.arange(len(y)), y], 1e-12, 1.0)
    return float(-np.mean(np.log(p)))


def brier(probs: np.ndarray, y: np.ndarray) -> float:
    onehot = np.zeros_like(probs)
    onehot[np.arange(len(y)), y] = 1.0
    return float(np.mean(np.sum((probs - onehot) ** 2, axis=1)))


def rps(probs: np.ndarray, y: np.ndarray) -> float:
    """Ranked probability score for ordered outcomes (home < draw < away)."""
    onehot = np.zeros_like(probs)
    onehot[np.arange(len(y)), y] = 1.0
    cum_p = np.cumsum(probs, axis=1)[:, :-1]
    cum_o = np.cumsum(onehot, axis=1)[:, :-1]
    return float(np.mean(np.sum((cum_p - cum_o) ** 2, axis=1) / (probs.shape[1] - 1)))


def accuracy(probs: np.ndarray, y: np.ndarray) -> float:
    return float(np.mean(np.argmax(probs, axis=1) == y))


def calibration(p: np.ndarray, hit: np.ndarray, bins: int = 10) -> list[dict]:
    """Reliability table: predicted vs observed frequency per probability bin."""
    edges = np.linspace(0, 1, bins + 1)
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (p >= lo) & (p < hi if hi < 1 else p <= hi)
        if m.sum() == 0:
            continue
        out.append(
            {
                "bin": f"{lo:.1f}-{hi:.1f}",
                "n": int(m.sum()),
                "predicted": round(float(p[m].mean()), 4),
                "observed": round(float(hit[m].mean()), 4),
            }
        )
    return out


def summarize(probs: np.ndarray, home: np.ndarray, away: np.ndarray, three_way: bool) -> dict:
    """Standard metric block for a set of predictions."""
    y = outcome_index(home, away)
    if not three_way:
        # Two-way sports: collapse to home/away (no draws are possible).
        probs = np.column_stack([probs[:, 0], probs[:, 2]])
        y = np.where(y == 0, 0, 1)
    out = {
        "n": int(len(y)),
        "log_loss": round(log_loss(probs, y), 5),
        "brier": round(brier(probs, y), 5),
        "accuracy": round(accuracy(probs, y), 4),
    }
    if three_way:
        out["rps"] = round(rps(probs, y), 5)
    return out


# ---- calibration (Phase 4) ---------------------------------------------------------------------


def brier_binary(p: np.ndarray, hit: np.ndarray) -> float:
    """Conventional two-outcome Brier score, mean((p - hit)^2). `brier()` above sums over classes,
    which for two outcomes is exactly twice this; compare with published numbers using this one."""
    return float(np.mean((np.asarray(p, dtype=float) - np.asarray(hit, dtype=float)) ** 2))


def expected_calibration_error(p: np.ndarray, hit: np.ndarray, bins: int = 10) -> float:
    """Expected calibration error with equal-mass bins: the bin-size-weighted mean of
    |average predicted - observed frequency|. Equal-mass bins keep every bin populated, unlike
    equal-width ones where the extreme bins hold a handful of matches."""
    p, hit = np.asarray(p, dtype=float), np.asarray(hit, dtype=float)
    if len(p) == 0:
        return float("nan")
    err = 0.0
    for chunk in np.array_split(np.argsort(p, kind="stable"), min(bins, len(p))):
        if len(chunk):
            err += len(chunk) / len(p) * abs(p[chunk].mean() - hit[chunk].mean())
    return float(err)


def classwise_ece(probs: np.ndarray, y: np.ndarray, bins: int = 10) -> float:
    """Mean over outcome classes of the one-vs-rest ECE (for three-way football)."""
    return float(np.mean([expected_calibration_error(probs[:, k], (y == k).astype(float), bins) for k in range(probs.shape[1])]))


def ece_noise_floor(p: np.ndarray, bins: int = 10, sims: int = 300, seed: int = 0) -> dict:
    """ECE that a PERFECTLY calibrated model would show on this many matches, purely from the
    luck of finite samples: outcomes are simulated from `p` itself. An observed ECE near this
    floor is indistinguishable from perfect calibration; far above it is real miscalibration."""
    rng = np.random.default_rng(seed)
    p = np.asarray(p, dtype=float)
    vals = np.array([expected_calibration_error(p, (rng.random(len(p)) < p).astype(float), bins) for _ in range(sims)])
    return {"mean": round(float(vals.mean()), 5), "p95": round(float(np.percentile(vals, 95)), 5)}


def reliability_table(p: np.ndarray, hit: np.ndarray, bins: int = 10) -> list[dict]:
    """Equal-mass reliability table: what was predicted vs what happened, with a 95% interval
    for the observed frequency so thin bins are not over-read."""
    p, hit = np.asarray(p, dtype=float), np.asarray(hit, dtype=float)
    rows = []
    for chunk in np.array_split(np.argsort(p, kind="stable"), min(bins, len(p))):
        if not len(chunk):
            continue
        obs, n = float(hit[chunk].mean()), len(chunk)
        half = 1.96 * float(np.sqrt(max(obs * (1 - obs), 1e-9) / n))
        rows.append({"n": int(n), "predicted": round(float(p[chunk].mean()), 4), "observed": round(obs, 4),
                     "lo": round(max(0.0, obs - half), 4), "hi": round(min(1.0, obs + half), 4)})
    return rows
