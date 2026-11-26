"""Probability calibration (Phase 4): Platt scaling and isotonic regression.

Binary: one calibrator on P(first team wins). Three outcomes: one-vs-rest calibrators on each
class probability, then the rows are renormalised to sum to 1.

The calibrator is always fitted on VALIDATION predictions of a model trained on earlier data,
and chosen among {none, Platt, isotonic} by blocked cross-validation inside the validation
window (never by looking at the test window).
"""

from __future__ import annotations

import numpy as np
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression

EPS = 1e-6
KINDS = ("none", "platt", "isotonic")


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, EPS, 1 - EPS)
    return np.log(p / (1 - p))


class _One:
    """Calibrator for a single probability column."""

    def __init__(self, kind: str):
        self.kind = kind

    def fit(self, p: np.ndarray, hit: np.ndarray) -> "_One":
        if self.kind == "platt":
            self.m = LogisticRegression(C=1e6, max_iter=1000).fit(_logit(p).reshape(-1, 1), hit)
        elif self.kind == "isotonic":
            self.m = IsotonicRegression(out_of_bounds="clip", y_min=0.005, y_max=0.995).fit(p, hit)
        return self

    def apply(self, p: np.ndarray) -> np.ndarray:
        if self.kind == "none":
            return p
        if self.kind == "platt":
            return self.m.predict_proba(_logit(p).reshape(-1, 1))[:, 1]
        return self.m.predict(p)


class Calibrator:
    def __init__(self, kind: str):
        if kind not in KINDS:
            raise ValueError(f"unknown calibrator '{kind}'")
        self.kind = kind

    def fit(self, probs: np.ndarray, y: np.ndarray) -> "Calibrator":
        self.k = probs.shape[1]
        if self.k == 2:  # one calibrator for the first team's win probability
            self.cals = [_One(self.kind).fit(probs[:, 0], (y == 0).astype(float))]
        else:
            self.cals = [_One(self.kind).fit(probs[:, j], (y == j).astype(float)) for j in range(self.k)]
        return self

    def apply(self, probs: np.ndarray) -> np.ndarray:
        if self.k == 2:
            p = np.clip(self.cals[0].apply(probs[:, 0]), EPS, 1 - EPS)
            return np.column_stack([p, 1 - p])
        cols = np.column_stack([np.clip(c.apply(probs[:, j]), EPS, None) for j, c in enumerate(self.cals)])
        return cols / cols.sum(axis=1, keepdims=True)


def _log_loss(probs: np.ndarray, y: np.ndarray) -> float:
    return float(-np.mean(np.log(np.clip(probs[np.arange(len(y)), y], 1e-12, 1.0))))


def choose(probs_val: np.ndarray, y_val: np.ndarray, folds: int = 5) -> dict:
    """Pick the calibrator with the best blocked cross-validated log-loss on the validation window.

    Blocks are contiguous in time, each is scored by calibrators fitted on the other blocks, so
    the choice uses only validation data. Returns the scores and the winner; the caller then
    fits the winner on the whole validation window."""
    n = len(y_val)
    blocks = np.array_split(np.arange(n), folds)
    scores: dict[str, float] = {}
    for kind in KINDS:
        losses = []
        for b in blocks:
            tr = np.setdiff1d(np.arange(n), b)
            cal = Calibrator(kind).fit(probs_val[tr], y_val[tr])
            losses.append(_log_loss(cal.apply(probs_val[b]), y_val[b]) * len(b))
        scores[kind] = sum(losses) / n
    best = min(scores, key=scores.get)
    return {"scores": {k: round(v, 5) for k, v in scores.items()}, "chosen": best}
