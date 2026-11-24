"""Leak-free pre-match features.

All matches of one sport are replayed in kick-off order. For every match the features
are taken from the state *before* it, and only then is the state updated with its result
(if it has one). Upcoming matches therefore get features built from the full history,
using exactly the same code path the model was trained on.

Per team the state holds an Elo rating, exponentially weighted averages of points/goals
scored and conceded (overall and at the same venue), the number of games seen and the
date of the last game. Per competition it holds the average home and away score, so one
model can serve leagues that score differently.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

MATCH_COLUMNS = [
    "match_id",
    "start_time",
    "competition_id",
    "home_team_id",
    "away_team_id",
    "home_score",
    "away_score",
    "status",
]


@dataclass(frozen=True)
class SportConfig:
    sport: str
    elo_k: float
    elo_hfa: float
    """Elo points added to the home side when computing the expected result."""
    form_alpha: float
    """EWMA weight of the newest game once a team has enough history."""
    offseason_days: int
    offseason_regress: float
    """Share of the gap to the mean (Elo and form) closed after a long break."""
    min_games: int
    """Training ignores matches where either team has fewer prior games than this."""
    prior_home: float
    prior_away: float
    rest_cap_days: float
    max_score: int
    """Football only: size of the scoreline grid."""
    rating_lr: float
    """Step size of the opponent-adjusted attack/defence ratings (late-season floor)."""
    rating_warmup: float
    """Early games use a larger step, c / (games + c), so new teams converge quickly."""
    sample_half_life_days: float | None = None
    """When set, training down-weights older matches: weight halves every N days."""
    ensemble_weight: float = 0.5
    """Share of the first (linear/GLM) model in the ensemble; the gradient-boosted model gets the rest."""


FOOTBALL = SportConfig(
    sport="football",
    elo_k=20.0,
    elo_hfa=60.0,
    form_alpha=0.12,
    offseason_days=45,
    offseason_regress=1 / 3,
    min_games=3,
    prior_home=1.5,
    prior_away=1.15,
    rest_cap_days=14.0,
    max_score=10,
    rating_lr=0.04,
    rating_warmup=4.0,
    sample_half_life_days=365.0,
)

BASKETBALL = SportConfig(
    sport="basketball",
    elo_k=20.0,
    elo_hfa=100.0,
    form_alpha=0.08,
    offseason_days=60,
    offseason_regress=1 / 4,
    min_games=3,
    prior_home=112.0,
    prior_away=109.0,
    rest_cap_days=7.0,
    max_score=0,
    rating_lr=0.08,
    rating_warmup=4.0,
)

CONFIGS = {"football": FOOTBALL, "basketball": BASKETBALL}

ELO_START = 1500.0

WIDE_FEATURES = [
    "h_elo",
    "a_elo",
    "elo_p_home",
    "h_att",
    "h_def",
    "a_att",
    "a_def",
    "h_vatt",
    "h_vdef",
    "a_vatt",
    "a_vdef",
    "comp_h",
    "comp_a",
    "h_rest",
    "a_rest",
    "h_n",
    "a_n",
    "h_off",
    "h_dfn",
    "a_off",
    "a_dfn",
    "h_rate",
    "a_rate",
]


def normalize_matches(df: pd.DataFrame) -> pd.DataFrame:
    """Coerce a raw match frame (from the DB or tests) to the dtypes the pipeline expects."""
    out = df[MATCH_COLUMNS].copy()
    out["start_time"] = pd.to_datetime(out["start_time"], utc=True)
    out["home_score"] = pd.to_numeric(out["home_score"], errors="coerce").astype("float64")
    out["away_score"] = pd.to_numeric(out["away_score"], errors="coerce").astype("float64")
    out["competition_id"] = pd.to_numeric(out["competition_id"], errors="coerce").astype("float64")
    out["status"] = out["status"].astype(str)
    return out.sort_values(["start_time", "match_id"], kind="stable").reset_index(drop=True)


def _elo_expected(diff: float) -> float:
    return 1.0 / (1.0 + 10.0 ** (-diff / 400.0))


def _elo_multiplier(cfg: SportConfig, margin: float, winner_elo_edge: float) -> float:
    if cfg.sport == "football":
        # World Football Elo goal-difference multiplier.
        gd = abs(margin)
        if gd <= 1:
            return 1.0
        if gd == 2:
            return 1.5
        return (11.0 + gd) / 8.0
    # Margin-of-victory multiplier with autocorrelation damping (as used for NBA Elo).
    mov = abs(margin)
    return ((mov + 3.0) ** 0.8) / (7.5 + 0.006 * max(winner_elo_edge, -400.0))


class _Team:
    __slots__ = ("elo", "att", "deff", "home_att", "home_def", "away_att", "away_def", "off", "dfn", "n", "last", "regressed_for")

    def __init__(self, mean_h: float, mean_a: float):
        mid = (mean_h + mean_a) / 2
        self.elo = ELO_START
        self.att = mid
        self.deff = mid
        self.home_att = mean_h
        self.home_def = mean_a
        self.away_att = mean_a
        self.away_def = mean_h
        # Opponent-adjusted ratings: log-scale multipliers (football) or points (basketball).
        self.off = 0.0
        self.dfn = 0.0
        self.n = 0
        self.last: pd.Timestamp | None = None
        # The `last` value for which the long-break shrink was already applied (once per break).
        self.regressed_for: pd.Timestamp | None = None


def _rating_rates(cfg: SportConfig, comp: list[float], h: _Team, a: _Team) -> tuple[float, float]:
    """Expected home/away score implied by the ratings and the competition's averages."""
    if cfg.sport == "football":
        return comp[0] * math.exp(h.off - a.dfn), comp[1] * math.exp(a.off - h.dfn)
    return comp[0] + h.off - a.dfn, comp[1] + a.off - h.dfn


def build_features(matches: pd.DataFrame, cfg: SportConfig) -> pd.DataFrame:
    """Return `matches` (normalized, time-ordered) plus pre-match feature columns and `played`."""
    df = normalize_matches(matches)
    n = len(df)
    feats = {c: np.empty(n, dtype="float64") for c in WIDE_FEATURES}
    played = np.zeros(n, dtype=bool)

    teams: dict[int, _Team] = {}
    comps: dict[float, list[float]] = {}  # comp id -> [avg_home, avg_away, n]
    glob = [cfg.prior_home, cfg.prior_away, 0]

    starts = df["start_time"].to_numpy()
    home_ids = df["home_team_id"].to_numpy()
    away_ids = df["away_team_id"].to_numpy()
    comp_ids = df["competition_id"].to_numpy()
    hs_arr = df["home_score"].to_numpy()
    as_arr = df["away_score"].to_numpy()
    status_arr = df["status"].to_numpy()

    for i in range(n):
        t = pd.Timestamp(starts[i])
        h = teams.get(home_ids[i])
        if h is None:
            h = teams[home_ids[i]] = _Team(glob[0], glob[1])
        a = teams.get(away_ids[i])
        if a is None:
            a = teams[away_ids[i]] = _Team(glob[0], glob[1])
        ckey = -1.0 if math.isnan(comp_ids[i]) else float(comp_ids[i])
        comp = comps.get(ckey)
        if comp is None:
            comp = comps[ckey] = [glob[0], glob[1], 0]

        rests = []
        for team in (h, a):
            if team.last is None:
                rests.append(cfg.rest_cap_days)
                continue
            gap_days = (t - team.last).total_seconds() / 86400.0
            # Shrink toward the mean once per long break. Without the guard every further
            # unplayed (upcoming) match of the same team would shrink the ratings again.
            if gap_days > cfg.offseason_days and team.regressed_for != team.last:
                team.regressed_for = team.last
                r = cfg.offseason_regress
                team.elo += (ELO_START - team.elo) * r
                mid = (comp[0] + comp[1]) / 2
                team.att += (mid - team.att) * r
                team.deff += (mid - team.deff) * r
                team.off *= 1 - r
                team.dfn *= 1 - r
            rests.append(min(max(gap_days, 0.0), cfg.rest_cap_days))

        feats["h_elo"][i] = h.elo
        feats["a_elo"][i] = a.elo
        feats["elo_p_home"][i] = _elo_expected(h.elo + cfg.elo_hfa - a.elo)
        feats["h_att"][i] = h.att
        feats["h_def"][i] = h.deff
        feats["a_att"][i] = a.att
        feats["a_def"][i] = a.deff
        feats["h_vatt"][i] = h.home_att
        feats["h_vdef"][i] = h.home_def
        feats["a_vatt"][i] = a.away_att
        feats["a_vdef"][i] = a.away_def
        feats["comp_h"][i] = comp[0]
        feats["comp_a"][i] = comp[1]
        feats["h_rest"][i] = rests[0]
        feats["a_rest"][i] = rests[1]
        feats["h_n"][i] = h.n
        feats["a_n"][i] = a.n
        feats["h_off"][i] = h.off
        feats["h_dfn"][i] = h.dfn
        feats["a_off"][i] = a.off
        feats["a_dfn"][i] = a.dfn
        rate_h, rate_a = _rating_rates(cfg, comp, h, a)
        feats["h_rate"][i] = rate_h
        feats["a_rate"][i] = rate_a

        hs, as_ = hs_arr[i], as_arr[i]
        if math.isnan(hs) or math.isnan(as_):
            if status_arr[i] == "completed":
                # Played, but the source has no result: the clock advances (rest days, break
                # detection), ratings and form stay untouched because the outcome is unknown.
                h.last = t
                a.last = t
            continue
        played[i] = True

        # Elo
        diff = h.elo + cfg.elo_hfa - a.elo
        expected = _elo_expected(diff)
        result = 1.0 if hs > as_ else 0.5 if hs == as_ else 0.0
        edge = diff if hs > as_ else -diff if as_ > hs else 0.0
        delta = cfg.elo_k * _elo_multiplier(cfg, hs - as_, edge) * (result - expected)
        h.elo += delta
        a.elo -= delta

        # Opponent-adjusted ratings: one gradient step of the Poisson (football) or
        # squared-error (basketball) likelihood of this result.
        err_h = hs - rate_h
        err_a = as_ - rate_a
        if cfg.sport == "football":
            err_h, err_a = float(np.clip(err_h, -3, 3)), float(np.clip(err_a, -3, 3))
        else:
            err_h, err_a = float(np.clip(err_h, -30, 30)), float(np.clip(err_a, -30, 30))
        lr_h = max(cfg.rating_lr, cfg.rating_lr * cfg.rating_warmup / (h.n + 1))
        lr_a = max(cfg.rating_lr, cfg.rating_lr * cfg.rating_warmup / (a.n + 1))
        h.off += lr_h * err_h
        a.dfn -= lr_a * err_h
        a.off += lr_a * err_a
        h.dfn -= lr_h * err_a

        # Form (EWMA; early games weigh more so the prior fades quickly).
        ah = max(cfg.form_alpha, 1.0 / (h.n + 2))
        aa = max(cfg.form_alpha, 1.0 / (a.n + 2))
        h.att += ah * (hs - h.att)
        h.deff += ah * (as_ - h.deff)
        h.home_att += ah * (hs - h.home_att)
        h.home_def += ah * (as_ - h.home_def)
        a.att += aa * (as_ - a.att)
        a.deff += aa * (hs - a.deff)
        a.away_att += aa * (as_ - a.away_att)
        a.away_def += aa * (hs - a.away_def)
        h.n += 1
        a.n += 1
        h.last = t
        a.last = t

        ac = max(0.01, 1.0 / (comp[2] + 2))
        comp[0] += ac * (hs - comp[0])
        comp[1] += ac * (as_ - comp[1])
        comp[2] += 1
        glob[2] += 1
        glob[0] += (hs - glob[0]) / (glob[2] + 1)
        glob[1] += (as_ - glob[1]) / (glob[2] + 1)

    for c, values in feats.items():
        df[c] = values
    df["played"] = played
    return df


TEAM_FEATURES = [
    "is_home",
    "rate",
    "elo_diff",
    "att",
    "opp_def",
    "vatt",
    "opp_vdef",
    "comp_avg",
    "rest",
    "opp_rest",
    "n",
    "opp_n",
]


def team_rows(wide: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split each match into a home-perspective and an away-perspective row.

    One model then predicts "score of team T against opponent O", which doubles the
    training data and keeps home and away predictions consistent.
    """

    def side(me: str, opp: str, is_home: int) -> pd.DataFrame:
        venue_comp = "comp_h" if is_home else "comp_a"
        return pd.DataFrame(
            {
                "is_home": float(is_home),
                "rate": wide[f"{me}_rate"],
                "elo_diff": (wide[f"{me}_elo"] - wide[f"{opp}_elo"]) / 100.0,
                "att": wide[f"{me}_att"],
                "opp_def": wide[f"{opp}_def"],
                "vatt": wide[f"{me}_vatt"],
                "opp_vdef": wide[f"{opp}_vdef"],
                "comp_avg": wide[venue_comp],
                "rest": wide[f"{me}_rest"],
                "opp_rest": wide[f"{opp}_rest"],
                "n": np.log1p(np.minimum(wide[f"{me}_n"], 60.0)),
                "opp_n": np.log1p(np.minimum(wide[f"{opp}_n"], 60.0)),
            },
            index=wide.index,
        )

    return side("h", "a", 1), side("a", "h", 0)


def log_scale(rows: pd.DataFrame) -> pd.DataFrame:
    """Football GLM variant: rates enter a log-link model on the log scale."""
    out = rows.copy()
    for c in ("rate", "att", "opp_def", "vatt", "opp_vdef", "comp_avg"):
        out[c] = np.log(np.clip(out[c], 0.05, None))
    return out


def trainable(wide: pd.DataFrame, cfg: SportConfig) -> pd.DataFrame:
    """Played matches where both teams have enough history for the features to mean something."""
    mask = wide["played"] & (wide["h_n"] >= cfg.min_games) & (wide["a_n"] >= cfg.min_games)
    return wide.loc[mask]
