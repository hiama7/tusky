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
