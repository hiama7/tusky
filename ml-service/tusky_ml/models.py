"""Score models and the probability layers on top of them.

Football: predict each side's expected goals (Poisson regression), then turn the two
rates into a scoreline grid with the Dixon-Coles low-score correction. Home/draw/away,
over/under, both-teams-to-score and the likeliest scorelines are all read off that grid.

Basketball: predict each side's expected points (regression), then model the margin and
the total as normal distributions whose spread is measured on held-out games. Games are
decided in overtime, so there is no draw.

`ensemble` mixes the two base models of a sport with equal weight.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar
from scipy.stats import norm, poisson
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import PoissonRegressor, Ridge
from sklearn.pipeline import Pipeline, make_pipeline
from sklearn.preprocessing import StandardScaler

from .features import CONFIGS, TEAM_FEATURES, SportConfig, log_scale, team_rows

FOOTBALL_KINDS = ("glm", "hgb", "ensemble")
BASKETBALL_KINDS = ("linear", "hgb", "ensemble")


def _hgb(loss: str) -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(
        loss=loss,
        learning_rate=0.04,
        max_iter=400,
        max_leaf_nodes=15,
        min_samples_leaf=60,
        l2_regularization=1.0,
        early_stopping=True,
        validation_fraction=0.15,
        random_state=0,
    )


def _estimator(sport: str, kind: str):
    if sport == "football":
        if kind == "glm":
            return make_pipeline(StandardScaler(), PoissonRegressor(alpha=1e-3, max_iter=2000))
        if kind == "hgb":
            return _hgb("poisson")
    else:
        if kind == "linear":
            return make_pipeline(StandardScaler(), Ridge(alpha=1.0))
        if kind == "hgb":
            return _hgb("squared_error")
    raise ValueError(f"unknown model kind '{kind}' for {sport}")


def recency_weights(start_times: pd.Series, half_life_days: float | None) -> np.ndarray | None:
    """Exponential time-decay sample weights relative to the newest match (mean 1)."""
    if not half_life_days:
        return None
    t = pd.to_datetime(start_times, utc=True)
    age = (t.max() - t).dt.total_seconds().to_numpy() / 86400.0
    w = 0.5 ** (age / half_life_days)
    return w / w.mean()


class ScoreRegressor:
    """Predicts one team's score from its perspective row; used for both sides."""

    def __init__(self, cfg: SportConfig, kind: str):
        self.cfg = cfg
        self.kind = kind
        self.est = _estimator(cfg.sport, kind)

    def _x(self, rows: pd.DataFrame) -> np.ndarray:
        if self.cfg.sport == "football" and self.kind == "glm":
            rows = log_scale(rows)
        return rows[TEAM_FEATURES].to_numpy(dtype="float64")

    def fit(self, wide: pd.DataFrame) -> "ScoreRegressor":
        home, away = team_rows(wide)
        x = np.vstack([self._x(home), self._x(away)])
        y = np.concatenate([wide["home_score"].to_numpy(), wide["away_score"].to_numpy()])
        w = recency_weights(wide["start_time"], self.cfg.sample_half_life_days)
        if w is None:
            self.est.fit(x, y)
        else:
            w2 = np.concatenate([w, w])
            if isinstance(self.est, Pipeline):
                self.est.fit(x, y, **{f"{self.est.steps[-1][0]}__sample_weight": w2})
            else:
                self.est.fit(x, y, sample_weight=w2)
        return self

    def predict(self, wide: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
        home, away = team_rows(wide)
        mu_h = self.est.predict(self._x(home))
        mu_a = self.est.predict(self._x(away))
        floor = 0.05 if self.cfg.sport == "football" else 1.0
        return np.clip(mu_h, floor, None), np.clip(mu_a, floor, None)


# ---- football ----------------------------------------------------------------


def score_grid(lam_h: np.ndarray, lam_a: np.ndarray, rho: float, max_goals: int) -> np.ndarray:
    """(n, G+1, G+1) scoreline probabilities: [k, i, j] = P(home=i, away=j) for match k."""
    goals = np.arange(max_goals + 1)
    ph = poisson.pmf(goals[None, :], lam_h[:, None])
    pa = poisson.pmf(goals[None, :], lam_a[:, None])
    grid = ph[:, :, None] * pa[:, None, :]
    if rho:
        grid[:, 0, 0] *= np.clip(1 - lam_h * lam_a * rho, 0, None)
        grid[:, 0, 1] *= np.clip(1 + lam_h * rho, 0, None)
        grid[:, 1, 0] *= np.clip(1 + lam_a * rho, 0, None)
        grid[:, 1, 1] *= max(1 - rho, 0.0)
    grid /= grid.sum(axis=(1, 2), keepdims=True)
    return grid


def outcome_probs(grid: np.ndarray) -> np.ndarray:
    """(n, 3) home/draw/away from a score grid."""
    home = np.tril(np.ones(grid.shape[1:]), k=-1)  # i > j
    away = np.triu(np.ones(grid.shape[1:]), k=1)  # j > i
    p_home = (grid * home).sum(axis=(1, 2))
    p_away = (grid * away).sum(axis=(1, 2))
    p_draw = np.trace(grid, axis1=1, axis2=2)
    return np.column_stack([p_home, p_draw, p_away])


def fit_rho(lam_h: np.ndarray, lam_a: np.ndarray, hs: np.ndarray, as_: np.ndarray, max_goals: int) -> float:
    """Maximum-likelihood Dixon-Coles rho given fixed scoring rates."""
    hs_i = np.clip(hs.astype(int), 0, max_goals)
    as_i = np.clip(as_.astype(int), 0, max_goals)
    idx = np.arange(len(hs_i))

    def nll(rho: float) -> float:
        grid = score_grid(lam_h, lam_a, rho, max_goals)
        return -np.log(np.clip(grid[idx, hs_i, as_i], 1e-12, None)).sum()

    res = minimize_scalar(nll, bounds=(-0.25, 0.25), method="bounded")
    return float(res.x)


def football_details(grid: np.ndarray) -> dict:
    size = grid.shape[0]
    i, j = np.indices(grid.shape)
    total = i + j
    flat = np.argsort(grid, axis=None)[::-1][:5]
    top = [{"home": int(k // size), "away": int(k % size), "p": round(float(grid.flat[k]), 4)} for k in flat]
    return {
        "top_scores": top,
        "over_under": {
            str(line): {"over": round(float(grid[total > line].sum()), 4), "under": round(float(grid[total < line].sum()), 4)}
            for line in (1.5, 2.5, 3.5)
        },
        "btts": round(float(grid[1:, 1:].sum()), 4),
        "home_clean_sheet": round(float(grid[:, 0].sum()), 4),
        "away_clean_sheet": round(float(grid[0, :].sum()), 4),
    }


def football_frame(grid: np.ndarray, lh: np.ndarray, la: np.ndarray, index) -> pd.DataFrame:
    probs = outcome_probs(grid)
    return pd.DataFrame(
        {
            "p_home": probs[:, 0],
            "p_draw": probs[:, 1],
            "p_away": probs[:, 2],
            "exp_home": lh,
            "exp_away": la,
            "details": [football_details(g) for g in grid],
        },
        index=index,
    )


@dataclass
class FootballPredictor:
    kind: str
    cfg: SportConfig = field(default_factory=lambda: CONFIGS["football"])
    rho: float = 0.0
    regressor: ScoreRegressor | None = None

    def fit(self, wide: pd.DataFrame) -> "FootballPredictor":
        self.regressor = ScoreRegressor(self.cfg, self.kind).fit(wide)
        lh, la = self.regressor.predict(wide)
        self.rho = fit_rho(lh, la, wide["home_score"].to_numpy(), wide["away_score"].to_numpy(), self.cfg.max_score)
        return self

    def rates(self, wide: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
        assert self.regressor is not None, "model is not fitted"
        return self.regressor.predict(wide)

    def grid(self, wide: pd.DataFrame) -> np.ndarray:
        lh, la = self.rates(wide)
        return score_grid(lh, la, self.rho, self.cfg.max_score)

    def predict(self, wide: pd.DataFrame) -> pd.DataFrame:
        lh, la = self.rates(wide)
        return football_frame(score_grid(lh, la, self.rho, self.cfg.max_score), lh, la, wide.index)

    def describe(self) -> dict:
        return {"rho": round(self.rho, 4)}


# ---- basketball ----------------------------------------------------------------


def _residual_sigmas(reg: ScoreRegressor, wide: pd.DataFrame) -> tuple[float, float]:
    mh, ma = reg.predict(wide)
    hs = wide["home_score"].to_numpy()
    as_ = wide["away_score"].to_numpy()
    sm = float(np.std((hs - as_) - (mh - ma), ddof=1))
    st = float(np.std((hs + as_) - (mh + ma), ddof=1))
    return max(sm, 3.0), max(st, 5.0)


def basketball_details(margin: float, total: float, sigma_margin: float, sigma_total: float) -> dict:
    base = np.floor(total)
    lines = [base - 9.5, base + 0.5, base + 10.5]
    return {
        "spread": round(float(margin), 1),
        "total": round(float(total), 1),
        "sigma_margin": round(sigma_margin, 2),
        "sigma_total": round(sigma_total, 2),
        "over_under": {f"{line:.1f}": {"over": round(float(1 - norm.cdf((line - total) / sigma_total)), 4)} for line in lines},
        "win_by_10_plus": {
            "home": round(float(1 - norm.cdf((9.5 - margin) / sigma_margin)), 4),
            "away": round(float(norm.cdf((-9.5 - margin) / sigma_margin)), 4),
        },
    }


def basketball_frame(p_home, mh, ma, sigma_margin: float, sigma_total: float, index) -> pd.DataFrame:
    margin, total = mh - ma, mh + ma
    return pd.DataFrame(
        {
            "p_home": p_home,
            "p_draw": np.zeros_like(p_home),
            "p_away": 1 - p_home,
            "exp_home": mh,
            "exp_away": ma,
            "details": [basketball_details(m, t, sigma_margin, sigma_total) for m, t in zip(margin, total)],
        },
        index=index,
    )


@dataclass
class BasketballPredictor:
    kind: str
    cfg: SportConfig = field(default_factory=lambda: CONFIGS["basketball"])
    sigma_margin: float = 12.0
    sigma_total: float = 18.0
    regressor: ScoreRegressor | None = None

    def fit(self, wide: pd.DataFrame, holdout: float = 0.2) -> "BasketballPredictor":
        """Fit the points model. The margin/total spread is measured on the newest `holdout`
        share of `wide` with a model that did not see it (in-sample residuals are too narrow
        and make the probabilities overconfident); then the model is refitted on all rows."""
        cut = int(len(wide) * (1 - holdout))
        if len(wide) - cut >= 30 and cut >= 60:
            probe = ScoreRegressor(self.cfg, self.kind).fit(wide.iloc[:cut])
            self.sigma_margin, self.sigma_total = _residual_sigmas(probe, wide.iloc[cut:])
            self.regressor = ScoreRegressor(self.cfg, self.kind).fit(wide)
        else:
            self.regressor = ScoreRegressor(self.cfg, self.kind).fit(wide)
            self.sigma_margin, self.sigma_total = _residual_sigmas(self.regressor, wide)
        return self

    def means(self, wide: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
        assert self.regressor is not None, "model is not fitted"
        return self.regressor.predict(wide)

    def predict(self, wide: pd.DataFrame) -> pd.DataFrame:
        mh, ma = self.means(wide)
        p_home = norm.cdf((mh - ma) / self.sigma_margin)
        return basketball_frame(p_home, mh, ma, self.sigma_margin, self.sigma_total, wide.index)

    def describe(self) -> dict:
        return {"sigma_margin": round(self.sigma_margin, 3), "sigma_total": round(self.sigma_total, 3)}


# ---- ensemble --------------------------------------------------------------------


@dataclass
class EnsemblePredictor:
    """Equal-weight mixture of a sport's two base models. Football averages the scoreline
    grids (a proper mixture, so every derived market stays consistent); basketball averages
    the win probabilities, means and spreads."""

    sport: str
    kind: str = "ensemble"
    members: list = field(default_factory=list)

    def fit(self, wide: pd.DataFrame) -> "EnsemblePredictor":
        base = FOOTBALL_KINDS[:2] if self.sport == "football" else BASKETBALL_KINDS[:2]
        self.members = [make_predictor(self.sport, k).fit(wide) for k in base]
        return self

    def predict(self, wide: pd.DataFrame) -> pd.DataFrame:
        if self.sport == "football":
            rates = [m.rates(wide) for m in self.members]
            grids = [score_grid(lh, la, m.rho, m.cfg.max_score) for m, (lh, la) in zip(self.members, rates)]
            lh = np.mean([r[0] for r in rates], axis=0)
            la = np.mean([r[1] for r in rates], axis=0)
            return football_frame(np.mean(grids, axis=0), lh, la, wide.index)
        preds = [m.predict(wide) for m in self.members]
        p_home = np.mean([p["p_home"].to_numpy() for p in preds], axis=0)
        mh = np.mean([p["exp_home"].to_numpy() for p in preds], axis=0)
        ma = np.mean([p["exp_away"].to_numpy() for p in preds], axis=0)
        sm = float(np.mean([m.sigma_margin for m in self.members]))
        st = float(np.mean([m.sigma_total for m in self.members]))
        return basketball_frame(p_home, mh, ma, sm, st, wide.index)

    def describe(self) -> dict:
        return {"members": [{"kind": m.kind, **m.describe()} for m in self.members]}


def make_predictor(sport: str, kind: str):
    if kind == "ensemble":
        return EnsemblePredictor(sport=sport)
    if sport == "football":
        return FootballPredictor(kind=kind)
    if sport == "basketball":
        return BasketballPredictor(kind=kind)
    raise ValueError(f"unsupported sport '{sport}'")


def kinds_for(sport: str) -> tuple[str, ...]:
    return FOOTBALL_KINDS if sport == "football" else BASKETBALL_KINDS
