"""Cricket pre-match models: win probability (pre-toss and post-toss) and first-innings
score (10/50/90% quantiles), per format, chosen by a rolling-origin backtest."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from ..metrics import brier, calibration, log_loss
from .features import ANTISYMMETRIC, POST_FEATURES, PRE_FEATURES

KINDS = ("logistic", "hgb", "ensemble")
MIN_GAMES = 3
FI_FEATURES = [
    "fi_bat_rr",
    "fi_bowl_rr",
    "fi_bat_first",
    "fi_elo",
    "fi_xi_bat_avg",
    "fi_xi_bat_sr",
    "fi_xi_bowl_econ",
    "fi_xi_bowl_sr",
    "venue_first_inns",
    "venue_n",
    "is_female",
    "is_club",
]
QUANTILES = (0.1, 0.5, 0.9)


def stage_matrix(df: pd.DataFrame, stage: str) -> pd.DataFrame:
    """Feature matrix for 'pre' (usual XIs, no toss) or 'post' (announced XIs + toss)."""
    cols = PRE_FEATURES if stage == "pre" else POST_FEATURES
    out = df.copy()
    for c in [c for c in df.columns if c.startswith(f"{stage}_xi_")]:
        out[c.removeprefix(f"{stage}_")] = df[c]
    return out[cols].astype("float64")


def swap(x: pd.DataFrame) -> pd.DataFrame:
    s = x.copy()
    for c in s.columns:
        if c in ANTISYMMETRIC:
            s[c] = -s[c]
    return s


def classes_for(fmt: str) -> list[float]:
    return [0.0, 0.5, 1.0] if fmt == "Test" else [0.0, 1.0]


def _logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def fit_temperature(p_team1: np.ndarray, won: np.ndarray) -> float:
    """Scale s for logit(p) that minimizes log-loss (s > 1 sharpens, s < 1 softens)."""
    from scipy.optimize import minimize_scalar

    z = _logit(p_team1)

    def nll(s):
        q = np.clip(1 / (1 + np.exp(-s * z)), 1e-9, 1 - 1e-9)
        return -np.mean(won * np.log(q) + (1 - won) * np.log(1 - q))

    # Lower bound near 0: a segment with no real signal can shrink all the way to 50/50.
    return float(minimize_scalar(nll, bounds=(0.05, 2.5), method="bounded").x)


def segment_of(rows: pd.DataFrame) -> np.ndarray:
    """Calibration segment per row: club (franchise leagues), women, intl (men's internationals)."""
    return np.where(rows["is_club"].to_numpy() == 1, "club", np.where(rows["is_female"].to_numpy() == 1, "women", "intl"))


def apply_temperature(p: np.ndarray, s: float) -> np.ndarray:
    """Rescale a two-way (team1, 0, team2) prediction on the logit scale."""
    if s == 1.0:
        return p
    t1 = 1 / (1 + np.exp(-s * _logit(p[:, 0] / (p[:, 0] + p[:, 2]))))
    return np.column_stack([t1, np.zeros_like(t1), 1 - t1])


class WinModel:
    """Classifier on team-1-perspective rows, trained on both orientations and symmetrized.
    `predict` returns (n, 3) probabilities: team1 win, draw, team2 win."""

    def __init__(self, fmt: str, stage: str, kind: str, temperature: dict[str, float] | None = None):
        self.fmt, self.stage, self.kind = fmt, stage, kind
        self.members: list = []
        # Per-segment logit scale (see segment_of); missing segments are left as-is.
        self.temperature = temperature or {}

    def _est(self, kind: str):
        if kind == "logistic":
            return make_pipeline(StandardScaler(), LogisticRegression(C=0.5, max_iter=2000))
        return HistGradientBoostingClassifier(
            learning_rate=0.04, max_iter=300, max_leaf_nodes=15, min_samples_leaf=40, l2_regularization=1.0,
            early_stopping=True, validation_fraction=0.15, random_state=0,
        )

    def fit(self, rows: pd.DataFrame) -> "WinModel":
        x = stage_matrix(rows, self.stage)
        y = rows["label"].to_numpy()
        xs = pd.concat([x, swap(x)], ignore_index=True)
        ys = np.concatenate([y, 1.0 - y])
        yc = (ys * 2).round().astype(int) if self.fmt == "Test" else ys.round().astype(int)
        kinds = ("logistic", "hgb") if self.kind == "ensemble" else (self.kind,)
        self.members = [self._est(k).fit(xs.to_numpy(), yc) for k in kinds]
        return self

    def _raw(self, x: pd.DataFrame) -> np.ndarray:
        """Average member probabilities in a fixed (team2, [draw], team1) class order."""
        probs = []
        for est in self.members:
            p = est.predict_proba(x.to_numpy())
            cls = list(est.classes_) if not hasattr(est, "steps") else list(est.steps[-1][1].classes_)
            full = np.zeros((len(x), 3))
            for j, c in enumerate(cls):
                full[:, {0: 0, 1: 1 if self.fmt == "Test" else 2, 2: 2}[int(c)]] += p[:, j]
            probs.append(full)
        return np.mean(probs, axis=0)  # columns: team2, draw, team1

    def predict(self, rows: pd.DataFrame) -> np.ndarray:
        x = stage_matrix(rows, self.stage)
        p = self._raw(x)
        q = self._raw(swap(x))  # team1/team2 swapped: q[:, 2] is P(team2 wins)
        p_team1 = (p[:, 2] + q[:, 0]) / 2
        p_team2 = (p[:, 0] + q[:, 2]) / 2
        p_draw = (p[:, 1] + q[:, 1]) / 2
        out = np.column_stack([p_team1, p_draw, p_team2])
        out = out / out.sum(axis=1, keepdims=True)
        if self.fmt == "Test" or not self.temperature:
            return out
        seg = segment_of(rows)
        for name, s in self.temperature.items():
            m = seg == name
            if m.any():
                out[m] = apply_temperature(out[m], s)
        return out

    def coefficients(self) -> dict[str, float] | None:
        """Standardized logistic coefficients (team-1 win direction), for reports."""
        for est in self.members:
            if hasattr(est, "steps") and self.fmt != "Test":
                lr = est.steps[-1][1]
                cols = PRE_FEATURES if self.stage == "pre" else POST_FEATURES
                return {c: round(float(w), 4) for c, w in zip(cols, lr.coef_[0])}
        return None


class EloOnly(WinModel):
    """Reference model: logistic regression on the Elo difference alone."""

    def fit(self, rows):
        x = rows[["elo_diff"]].to_numpy()
        y = rows["label"].to_numpy()
        xs, ys = np.vstack([x, -x]), np.concatenate([y, 1 - y])
        yc = (ys * 2).round().astype(int) if self.fmt == "Test" else ys.round().astype(int)
        self.members = [LogisticRegression(max_iter=1000).fit(xs, yc)]
        return self

    def predict(self, rows):
        x = rows[["elo_diff"]]
        p = self._raw(x)
        q = self._raw(-x)
        out = np.column_stack([(p[:, 2] + q[:, 0]) / 2, (p[:, 1] + q[:, 1]) / 2, (p[:, 0] + q[:, 2]) / 2])
        return out / out.sum(axis=1, keepdims=True)


def _labels_idx(rows: pd.DataFrame) -> np.ndarray:
    """0 = team1 win, 1 = draw, 2 = team2 win."""
    y = rows["label"].to_numpy()
    return np.where(y == 1.0, 0, np.where(y == 0.5, 1, 2))


def win_metrics(p: np.ndarray, rows: pd.DataFrame, fmt: str) -> dict:
    y = _labels_idx(rows)
    if fmt != "Test":
        p2 = np.column_stack([p[:, 0], p[:, 2]])
        p2 = p2 / p2.sum(axis=1, keepdims=True)
        y2 = np.where(y == 0, 0, 1)
        return {
            "n": int(len(y)),
            "log_loss": round(log_loss(p2, y2), 5),
            "brier": round(brier(p2, y2), 5),
            "accuracy": round(float(np.mean(np.argmax(p2, axis=1) == y2)), 4),
            "roc_auc": round(float(roc_auc_score(y2 == 0, p2[:, 0])), 4) if len(set(y2)) > 1 else None,
        }
    return {
        "n": int(len(y)),
        "log_loss": round(log_loss(p, y), 5),
        "brier": round(brier(p, y), 5),
        "accuracy": round(float(np.mean(np.argmax(p, axis=1) == y)), 4),
    }


def rolling_folds(n: int, folds: int = 4, first_frac: float = 0.5):
    edges = np.linspace(int(n * first_frac), n, folds + 1).astype(int)
    return [(lo, hi) for lo, hi in zip(edges[:-1], edges[1:]) if hi > lo]


# ---- first innings -------------------------------------------------------------------------


class FirstInningsModel:
    """Quantile gradient boosting for the 10/50/90% first-innings total. The 10-90 band is
    widened by conformalized quantile regression: the newest 20% of the training rows
    measure how often the raw band misses, and the band is stretched until it would have
    covered 80% of them (quantile models alone are usually too narrow)."""

    def __init__(self):
        self.models: dict[float, HistGradientBoostingRegressor] = {}
        self.widen = 0.0

    @staticmethod
    def _fit_quantiles(x, y):
        return {
            q: HistGradientBoostingRegressor(
                loss="quantile", quantile=q, learning_rate=0.05, max_iter=300, max_leaf_nodes=15,
                min_samples_leaf=40, l2_regularization=1.0, random_state=0,
            ).fit(x, y)
            for q in QUANTILES
        }

    def fit(self, rows: pd.DataFrame) -> "FirstInningsModel":
        x, y = rows[FI_FEATURES].to_numpy(dtype="float64"), rows["first_inns_runs"].to_numpy()
        cut = int(len(rows) * 0.8)
        if len(rows) - cut >= 50:
            probe = self._fit_quantiles(x[:cut], y[:cut])
            lo, hi = probe[QUANTILES[0]].predict(x[cut:]), probe[QUANTILES[-1]].predict(x[cut:])
            scores = np.maximum(lo - y[cut:], y[cut:] - hi)
            level = min(1.0, (QUANTILES[-1] - QUANTILES[0]) * (1 + 1 / len(scores)))
            self.widen = max(0.0, float(np.quantile(scores, level)))
        self.models = self._fit_quantiles(x, y)
        return self

    def predict(self, rows: pd.DataFrame) -> np.ndarray:
        x = rows[FI_FEATURES].to_numpy(dtype="float64")
        out = np.sort(np.column_stack([self.models[q].predict(x) for q in QUANTILES]), axis=1)
        out[:, 0] -= self.widen
        out[:, -1] += self.widen
        return out


def pinball(y, q_pred, q):
    d = y - q_pred
    return float(np.mean(np.maximum(q * d, (q - 1) * d)))


# ---- training ---------------------------------------------------------------------------------


@dataclass
class CricketModel:
    fmt: str
    version: str
    pre: WinModel
    post: WinModel
    first_innings: FirstInningsModel | None
    report: dict = field(default_factory=dict)


def win_rows(feats: pd.DataFrame, fmt: str) -> pd.DataFrame:
    r = feats[(feats["format"] == fmt) & feats["label"].notna() & (feats["n_a"] >= MIN_GAMES) & (feats["n_b"] >= MIN_GAMES)]
    if fmt != "Test":
        r = r[r["label"] != 0.5]
    return r.sort_values(["start_time", "match_id"])


def fi_rows(feats: pd.DataFrame, fmt: str) -> pd.DataFrame:
    r = feats[(feats["format"] == fmt) & feats["first_inns_runs"].notna() & feats["fi_bat_rr"].notna()]
    r = r[(r["n_a"] >= MIN_GAMES) & (r["n_b"] >= MIN_GAMES)]
    return r.sort_values(["start_time", "match_id"])


def _backtest_win(rows: pd.DataFrame, fmt: str, stage: str, kind: str) -> np.ndarray:
    preds = []
    for lo, hi in rolling_folds(len(rows)):
        model = (EloOnly(fmt, stage, "elo") if kind == "elo" else WinModel(fmt, stage, kind)).fit(rows.iloc[:lo])
        preds.append(model.predict(rows.iloc[lo:hi]))
    return np.vstack(preds)


def _nested_temperature(p: np.ndarray, va: pd.DataFrame, n_rows: int) -> tuple[dict[str, float], dict]:
    """Per segment: fit a temperature on earlier backtest folds, score it on later ones,
    and adopt it only if the later folds improve. Returns {segment: scale} and evidence."""
    won = (va["label"].to_numpy() == 1.0).astype(float)
    seg = segment_of(va)
    folds = rolling_folds(n_rows)
    start = folds[0][0]
    pos = np.arange(len(va))

    def ll(q, y):
        return float(-np.sum(y * np.log(np.clip(q[:, 0], 1e-9, 1)) + (1 - y) * np.log(np.clip(q[:, 2], 1e-9, 1))))

    temps: dict[str, float] = {}
    evidence: dict[str, dict] = {}
    for name in np.unique(seg):
        m = seg == name
        raw, cal, n, ts = 0.0, 0.0, 0, []
        for k in range(1, len(folds)):
            tr = m & (pos < folds[k][0] - start)
            te = m & (pos >= folds[k][0] - start) & (pos < folds[k][1] - start)
            if tr.sum() < 30 or te.sum() < 10:
                continue
            s = fit_temperature(p[tr, 0], won[tr])
            ts.append(round(s, 3))
            raw += ll(p[te], won[te])
            cal += ll(apply_temperature(p[te], s), won[te])
            n += int(te.sum())
        if not n:
            continue
        ev = {"n": n, "raw_log_loss": round(raw / n, 5), "calibrated_log_loss": round(cal / n, 5), "fold_temperatures": ts, "adopted": None}
        if cal < raw:
            temps[name] = fit_temperature(p[m, 0], won[m])
            ev["adopted"] = round(temps[name], 3)
        evidence[str(name)] = ev
    return temps, evidence


def _oof_rows(rows: pd.DataFrame) -> pd.DataFrame:
    lo = rolling_folds(len(rows))[0][0]
    return rows.iloc[lo:]


def train(feats: pd.DataFrame, fmt: str, min_matches: int = 300, now: datetime | None = None) -> CricketModel:
    rows = win_rows(feats, fmt)
    if len(rows) < min_matches:
        raise ValueError(f"cricket {fmt}: only {len(rows)} usable decided matches (need {min_matches})")
    va = _oof_rows(rows)
    report: dict = {"format": fmt, "n_rows": int(len(rows)), "backtest_from": va["start_time"].min().isoformat(),
                    "n_backtest": int(len(va)), "data_through": rows["start_time"].max().isoformat()}

    # Coin-flip (two-way) or base-rate (Test) reference.
    y = _labels_idx(va)
    if fmt == "Test":
        tr = rows.iloc[: rolling_folds(len(rows))[0][0]]
        d = float((tr["label"] == 0.5).mean())
        base = np.tile([(1 - d) / 2, d, (1 - d) / 2], (len(va), 1))
    else:
        base = np.tile([0.5, 0.0, 0.5], (len(va), 1))
    report["baseline"] = win_metrics(base, va, fmt)
    report["elo_only"] = win_metrics(_backtest_win(rows, fmt, "pre", "elo"), va, fmt)

    chosen: dict[str, str] = {}
    temps: dict[str, dict[str, float]] = {}
    for stage in ("pre", "post"):
        results = {}
        best_p = None
        for kind in KINDS:
            p = _backtest_win(rows, fmt, stage, kind)
            results[kind] = win_metrics(p, va, fmt)
            if best_p is None or results[kind]["log_loss"] < results[chosen.get(stage, kind)]["log_loss"]:
                chosen[stage], best_p = kind, p
        report[stage] = {"candidates": results, "selected": chosen[stage]}
        temps[stage] = {}
        if fmt != "Test":
            # Evidence is out-of-sample (fitted on earlier folds, scored on later ones); the
            # tables below stay uncalibrated so they never benefit from that fit.
            temps[stage], report[stage]["segment_calibration"] = _nested_temperature(best_p, va, len(rows))
        report[stage]["calibration_team1"] = calibration(best_p[:, 0], (y == 0).astype(float))
        # Accuracy differs a lot by segment (e.g. mismatched associate T20Is are easy, IPL is
        # not), so the headline number is broken down rather than quoted alone.
        segs = {}
        for name, mask in (
            ("men_international", (va["is_female"] == 0) & (va["is_club"] == 0)),
            ("men_club", (va["is_female"] == 0) & (va["is_club"] == 1)),
            ("women", va["is_female"] == 1),
            ("close_elo", va["elo_diff"].abs() < 1.0),
        ):
            m = mask.to_numpy()
            if m.sum() >= 50:
                segs[name] = win_metrics(best_p[m], va[m], fmt)
        report[stage]["segments"] = segs

    pre = WinModel(fmt, "pre", chosen["pre"], temps["pre"]).fit(rows)
    post = WinModel(fmt, "post", chosen["post"], temps["post"]).fit(rows)
    report["coefficients_post"] = WinModel(fmt, "post", "logistic").fit(rows).coefficients()

    fi_model = None
    fr = fi_rows(feats, fmt)
    if fmt != "Test" and len(fr) >= min_matches:
        preds, ys = [], []
        for lo, hi in rolling_folds(len(fr)):
            preds.append(FirstInningsModel().fit(fr.iloc[:lo]).predict(fr.iloc[lo:hi]))
            ys.append(fr.iloc[lo:hi]["first_inns_runs"].to_numpy())
        p, yv = np.vstack(preds), np.concatenate(ys)
        fva = fr.iloc[rolling_folds(len(fr))[0][0]:]
        report["first_innings"] = {
            "n": int(len(yv)),
            "mae_median": round(float(np.mean(np.abs(p[:, 1] - yv))), 2),
            "mae_venue_average": round(float(np.mean(np.abs(fva["venue_first_inns"].to_numpy() - yv))), 2),
            "mae_team_average": round(float(np.mean(np.abs(fva["fi_bat_first"].to_numpy() - yv))), 2),
            "coverage_10_90": round(float(np.mean((yv >= p[:, 0]) & (yv <= p[:, 2]))), 4),
            "pinball": {str(q): round(pinball(yv, p[:, i], q), 3) for i, q in enumerate(QUANTILES)},
        }
        fi_model = FirstInningsModel().fit(fr)

    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M")
    version = f"cricket-{fmt.lower()}-{chosen['post']}-{stamp}"
    report["version"] = version
    report["trained_at"] = (now or datetime.now(timezone.utc)).isoformat()
    return CricketModel(fmt=fmt, version=version, pre=pre, post=post, first_innings=fi_model, report=report)
