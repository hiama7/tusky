"""Leak-free pre-match features for cricket.

Matches are replayed in start order; every feature is read from the state *before* the
match and the state is updated with the result afterwards. State is kept per format
(T20, ODI, Test), because a side's T20 and Test strength are different things.

Per match two feature sets are produced, from team 1's point of view:
- pre-toss: what is knowable before the toss; line-ups are each side's most recent XI.
- post-toss: adds the toss, the batting order, and the actual announced XI (in Cricsheet
  history the XI is the one that played, which is what is announced at the toss).
Most features are A-minus-B differences, so swapping the teams flips their sign; the
models are trained on both orientations and their outputs symmetrized.
"""

from __future__ import annotations

import math
from collections import defaultdict, deque
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .data import CricketData


@dataclass(frozen=True)
class FormatConfig:
    elo_k: float
    rr_prior: float  # runs per over
    first_inns_prior: float
    full_balls: int | None  # balls in a full innings (None for multi-day)
    alpha: float  # EWMA weight for team rates
    player_decay: float  # per-match decay of player accumulators


FORMATS = {
    "T20": FormatConfig(elo_k=24, rr_prior=7.8, first_inns_prior=160, full_balls=120, alpha=0.1, player_decay=0.97),
    "ODI": FormatConfig(elo_k=24, rr_prior=5.3, first_inns_prior=260, full_balls=300, alpha=0.1, player_decay=0.97),
    "Test": FormatConfig(elo_k=24, rr_prior=3.2, first_inns_prior=330, full_balls=None, alpha=0.12, player_decay=0.95),
}

# Shrinkage strengths (pseudo-counts) for rates estimated from few observations.
H2H_PRIOR = 4.0
VENUE_PRIOR = 8.0
BAT_AVG_PRIOR_OUTS = 3.0
BALL_PRIOR = 60.0

PRE_FEATURES = [
    "elo_diff",
    "form5_diff",
    "form10_diff",
    "form20_diff",
    "rr_bat_diff",
    "rr_bowl_diff",
    "wk_lost_diff",
    "wk_taken_diff",
    "first_inns_diff",
    "h2h",
    "h2h_n",
    "familiarity_diff",
    "xi_bat_avg_diff",
    "xi_bat_sr_diff",
    "xi_bowl_econ_diff",
    "xi_bowl_sr_diff",
    "xi_exp_diff",
    "rest_diff",
    "games_min",
    "venue_first_inns",
    "venue_n",
    "is_female",
    "is_club",
]
TOSS_FEATURES = ["toss_a", "bat_first_a", "bat_first_x_chase", "venue_chase_rate", "avail_diff"]
POST_FEATURES = PRE_FEATURES + TOSS_FEATURES

# Features whose sign flips when team A and team B are swapped.
ANTISYMMETRIC = {
    "elo_diff", "form5_diff", "form10_diff", "form20_diff", "rr_bat_diff", "rr_bowl_diff", "wk_lost_diff",
    "wk_taken_diff", "first_inns_diff", "h2h", "familiarity_diff", "xi_bat_avg_diff", "xi_bat_sr_diff",
    "xi_bowl_econ_diff", "xi_bowl_sr_diff", "xi_exp_diff", "rest_diff", "toss_a", "bat_first_a",
    "bat_first_x_chase", "avail_diff",
}


@dataclass
class _Team:
    cfg: FormatConfig
    elo: float = 1500.0
    n: int = 0
    last: pd.Timestamp | None = None
    results: deque = field(default_factory=lambda: deque(maxlen=20))
    rr_bat: float = 0.0
    rr_bowl: float = 0.0
    wk_lost: float = 6.0
    wk_taken: float = 6.0
    first_inns: float = 0.0
    places: dict = field(default_factory=lambda: defaultdict(int))
    xis: deque = field(default_factory=lambda: deque(maxlen=5))

    def __post_init__(self):
        self.rr_bat = self.rr_bowl = self.cfg.rr_prior
        self.first_inns = self.cfg.first_inns_prior


@dataclass
class _Player:
    runs: float = 0.0
    balls: float = 0.0
    outs: float = 0.0
    bowl_balls: float = 0.0
    bowl_runs: float = 0.0
    wkts: float = 0.0
    matches: int = 0


@dataclass
class _Venue:
    first_inns: float
    n: int = 0
    chase_wins: float = 0.0
    decided: int = 0


def _form(results: deque, k: int) -> float:
    """Shrunk win share over the last k games (draws count half)."""
    last = list(results)[-k:]
    return (sum(last) + 1.0) / (len(last) + 2.0) - 0.5


class _FormatState:
    def __init__(self, cfg: FormatConfig):
        self.cfg = cfg
        self.teams: dict[int, _Team] = {}
        self.players: dict[int, _Player] = defaultdict(_Player)
        self.h2h: dict[tuple[int, int], list[int]] = defaultdict(list)
        self.venues: dict[object, _Venue] = {}
        # Format-wide player priors (running means), so new players start at average.
        self.bat_avg_prior = 25.0 if cfg.full_balls else 32.0
        self.bat_sr_prior = cfg.rr_prior / 6.0
        self.bowl_econ_prior = cfg.rr_prior / 6.0
        self.bowl_sr_prior = 1 / 20 if cfg.full_balls == 120 else 1 / 35 if cfg.full_balls else 1 / 60

    def team(self, tid: int) -> _Team:
        if tid not in self.teams:
            self.teams[tid] = _Team(self.cfg)
        return self.teams[tid]

    def venue(self, key) -> _Venue:
        if key not in self.venues:
            self.venues[key] = _Venue(first_inns=self.cfg.first_inns_prior)
        return self.venues[key]

    # -- player aggregates for an XI --

    def xi_strength(self, xi: list[int]) -> tuple[float, float, float, float, float]:
        """(batting average, strike rate, economy, bowling strike rate, experience) of an XI.
        Batting uses the 7 most-used batters, bowling the 5 most-used bowlers."""
        if not xi:
            return self.bat_avg_prior, self.bat_sr_prior, self.bowl_econ_prior, self.bowl_sr_prior, 0.0
        ps = [self.players.get(p) or _Player() for p in xi]
        bat = sorted(ps, key=lambda p: -p.balls)[:7]
        bowl = sorted(ps, key=lambda p: -p.bowl_balls)[:5]
        k = BAT_AVG_PRIOR_OUTS
        avg = np.mean([(p.runs + k * self.bat_avg_prior) / (p.outs + k) for p in bat])
        sr = np.mean([(p.runs + BALL_PRIOR * self.bat_sr_prior) / (p.balls + BALL_PRIOR) for p in bat])
        econ = np.mean([(p.bowl_runs + BALL_PRIOR * self.bowl_econ_prior) / (p.bowl_balls + BALL_PRIOR) for p in bowl])
        bsr = np.mean([(p.wkts + BALL_PRIOR * self.bowl_sr_prior) / (p.bowl_balls + BALL_PRIOR) for p in bowl])
        exp = float(np.mean([math.log1p(p.matches) for p in ps]))
        return float(avg), float(sr), float(econ), float(bsr), exp


def build_features(data: CricketData) -> pd.DataFrame:
    """One row per match with pre- and post-toss features, labels and bookkeeping columns."""
    m = data.matches.sort_values(["start_time", "match_id"], kind="stable").reset_index(drop=True)
    inns = {k: g.sort_values("innings_no") for k, g in data.innings.groupby("match_id")}
    bat = {k: g for k, g in data.batting.groupby("match_id")}
    bowl = {k: g for k, g in data.bowling.groupby("match_id")}
    xi: dict[tuple[int, int], list[int]] = defaultdict(list)
    for r in data.lineups.itertuples(index=False):
        xi[(r.match_id, r.team_id)].append(r.player_id)

    states = {f: _FormatState(cfg) for f, cfg in FORMATS.items()}
    rows: list[dict] = []
    for r in m.itertuples(index=False):
        st = states.get(r.format)
        if st is None:
            continue
        cfg = st.cfg
        a, b = st.team(r.team1), st.team(r.team2)
        t = r.start_time
        venue_key = r.venue_id if pd.notna(r.venue_id) else f"city:{r.city}"
        v = st.venue(venue_key)
        place = r.city or venue_key

        pair = (min(r.team1, r.team2), max(r.team1, r.team2))
        meetings = st.h2h[pair][-10:]
        a_wins = sum(1.0 if w == r.team1 else 0.5 if w == 0 else 0.0 for w in meetings)
        h2h = (a_wins + H2H_PRIOR / 2) / (len(meetings) + H2H_PRIOR) - 0.5

        def familiarity(team: _Team) -> float:
            return (team.places.get(place, 0) + 0.5) / (team.n + 2.0)

        def rest(team: _Team) -> float:
            return min((t - team.last).total_seconds() / 86400.0, 30.0) if team.last is not None else 30.0

        usual_a = list(a.xis[-1]) if a.xis else []
        usual_b = list(b.xis[-1]) if b.xis else []
        pre_a, pre_b = st.xi_strength(usual_a), st.xi_strength(usual_b)
        actual_a, actual_b = xi.get((r.match_id, r.team1), []), xi.get((r.match_id, r.team2), [])
        post_a = st.xi_strength(actual_a) if actual_a else pre_a
        post_b = st.xi_strength(actual_b) if actual_b else pre_b

        def avail(team: _Team, actual: list[int]) -> float:
            """Share of the team's regulars (in 3+ of its last 5 XIs) who play today."""
            if not actual or len(team.xis) < 3:
                return 1.0
            counts: dict[int, int] = defaultdict(int)
            for prev in team.xis:
                for p in prev:
                    counts[p] += 1
            regulars = [p for p, c in counts.items() if c >= 3]
            return sum(p in set(actual) for p in regulars) / len(regulars) if regulars else 1.0

        venue_chase = (v.chase_wins + VENUE_PRIOR / 2) / (v.decided + VENUE_PRIOR)
        first = inns.get(r.match_id)
        bat_first_team = None
        if first is not None and len(first):
            bat_first_team = int(first.iloc[0]["bat_team"])
        elif pd.notna(r.toss_winner) and r.toss_decision in ("bat", "field"):
            other = r.team2 if r.toss_winner == r.team1 else r.team1
            bat_first_team = int(r.toss_winner) if r.toss_decision == "bat" else int(other)
        toss_a = 0.0 if pd.isna(r.toss_winner) else (1.0 if r.toss_winner == r.team1 else -1.0)
        bat_first_a = 0.0 if bat_first_team is None else (1.0 if bat_first_team == r.team1 else -1.0)

        row = {
            "match_id": int(r.match_id),
            "start_time": t,
            "format": r.format,
            "status": r.status,
            "team1": int(r.team1),
            "team2": int(r.team2),
            "elo_diff": (a.elo - b.elo) / 100.0,
            "form5_diff": _form(a.results, 5) - _form(b.results, 5),
            "form10_diff": _form(a.results, 10) - _form(b.results, 10),
            "form20_diff": _form(a.results, 20) - _form(b.results, 20),
            "rr_bat_diff": a.rr_bat - b.rr_bat,
            "rr_bowl_diff": a.rr_bowl - b.rr_bowl,
            "wk_lost_diff": a.wk_lost - b.wk_lost,
            "wk_taken_diff": a.wk_taken - b.wk_taken,
            "first_inns_diff": (a.first_inns - b.first_inns) / 10.0,
            "h2h": h2h,
            "h2h_n": float(len(meetings)),
            "familiarity_diff": familiarity(a) - familiarity(b),
            "rest_diff": rest(a) - rest(b),
            "games_min": math.log1p(min(a.n, b.n)),
            "venue_first_inns": v.first_inns,
            "venue_n": math.log1p(v.n),
            "is_female": 1.0 if r.gender == "f" else 0.0,
            "is_club": 1.0 if r.team_type == "club" else 0.0,
            "toss_a": toss_a,
            "bat_first_a": bat_first_a,
            "venue_chase_rate": venue_chase - 0.5,
            "bat_first_x_chase": bat_first_a * (0.5 - venue_chase),
            "avail_diff": avail(a, actual_a) - avail(b, actual_b),
            "bat_first_team": bat_first_team,
            "n_a": a.n,
            "n_b": b.n,
        }
        for prefix, (sa, sb) in (("pre", (pre_a, pre_b)), ("post", (post_a, post_b))):
            row[f"{prefix}_xi_bat_avg_diff"] = (sa[0] - sb[0]) / 10.0
            row[f"{prefix}_xi_bat_sr_diff"] = (sa[1] - sb[1]) * 100.0
            row[f"{prefix}_xi_bowl_econ_diff"] = (sa[2] - sb[2]) * 100.0
            row[f"{prefix}_xi_bowl_sr_diff"] = (sa[3] - sb[3]) * 100.0
            row[f"{prefix}_xi_exp_diff"] = sa[4] - sb[4]

        # Labels: 1 = team1 wins, 0 = team2 wins, 0.5 = draw (Test); None = no decision.
        label = None
        if r.result_type == "draw":
            label = 0.5
        elif pd.notna(r.winner) and r.result_type != "awarded":
            label = 1.0 if r.winner == r.team1 else 0.0
        row["label"] = label

        # First-innings target row (complete innings only: all out or full allocation).
        fi_runs = None
        if first is not None and len(first) and cfg.full_balls:
            f0 = first.iloc[0]
            if (f0["wickets"] >= 10 or f0["legal_balls"] >= cfg.full_balls) and r.result_type not in ("dls", "no_result"):
                fi_runs = float(f0["runs"])
        row["first_inns_runs"] = fi_runs
        def fi(prefix: str, bt: _Team, bw: _Team, bxi, wxi) -> None:
            row.update(
                {
                    f"{prefix}bat_rr": bt.rr_bat,
                    f"{prefix}bowl_rr": bw.rr_bowl,
                    f"{prefix}bat_first": bt.first_inns,
                    f"{prefix}elo": (bt.elo - bw.elo) / 100.0,
                    f"{prefix}xi_bat_avg": bxi[0],
                    f"{prefix}xi_bat_sr": bxi[1] * 100.0,
                    f"{prefix}xi_bowl_econ": wxi[2] * 100.0,
                    f"{prefix}xi_bowl_sr": wxi[3] * 100.0,
                }
            )

        # Both batting-order scenarios (for projections before the toss), plus the actual one.
        fi("fi1_", a, b, post_a, post_b)
        fi("fi2_", b, a, post_b, post_a)
        if bat_first_team is not None:
            if bat_first_team == r.team1:
                fi("fi_", a, b, post_a, post_b)
            else:
                fi("fi_", b, a, post_b, post_a)
        rows.append(row)

        # ---------------- update state with the result ----------------
        if first is None or not len(first):
            if label is None:
                continue
        _update(st, r, a, b, first, bat.get(r.match_id), bowl.get(r.match_id), actual_a, actual_b, label, place, v, pair)

    df = pd.DataFrame(rows)
    for c in [c for c in df.columns if c.startswith("pre_xi_")]:
        df[c.removeprefix("pre_")] = df[c]
    return df


def _update(st, r, a, b, first, bat_rows, bowl_rows, actual_a, actual_b, label, place, v, pair):
    cfg = st.cfg
    if label is not None:
        exp = 1.0 / (1.0 + 10.0 ** (-(a.elo - b.elo) / 400.0))
        delta = cfg.elo_k * (label - exp)
        a.elo += delta
        b.elo -= delta
        a.results.append(label)
        b.results.append(1.0 - label)
        st.h2h[pair].append(r.team1 if label == 1.0 else r.team2 if label == 0.0 else 0)

    if first is not None and len(first):
        for inn in first.itertuples(index=False):
            batting = a if inn.bat_team == r.team1 else b if inn.bat_team == r.team2 else None
            fielding = b if batting is a else a if batting is b else None
            if batting is None or inn.legal_balls <= 0:
                continue
            rr = inn.runs / inn.legal_balls * 6.0
            batting.rr_bat += cfg.alpha * (rr - batting.rr_bat)
            fielding.rr_bowl += cfg.alpha * (rr - fielding.rr_bowl)
            batting.wk_lost += cfg.alpha * (inn.wickets - batting.wk_lost)
            fielding.wk_taken += cfg.alpha * (inn.wickets - fielding.wk_taken)
        f0 = first.iloc[0]
        complete = cfg.full_balls is None or f0["wickets"] >= 10 or f0["legal_balls"] >= cfg.full_balls
        if complete and r.result_type not in ("dls", "no_result"):
            bf = a if f0["bat_team"] == r.team1 else b
            bf.first_inns += cfg.alpha * (f0["runs"] - bf.first_inns)
            v.first_inns += max(0.05, 1.0 / (v.n + 2)) * (f0["runs"] - v.first_inns)
            v.n += 1
        if label in (0.0, 1.0) and len(first) >= 2:
            chaser = int(first.iloc[1]["bat_team"])
            winner = r.team1 if label == 1.0 else r.team2
            v.chase_wins += 1.0 if winner == chaser else 0.0
            v.decided += 1

    d = cfg.player_decay
    for xi_ids in (actual_a, actual_b):
        for p in xi_ids:
            ps = st.players[p]
            ps.runs *= d
            ps.balls *= d
            ps.outs *= d
            ps.bowl_balls *= d
            ps.bowl_runs *= d
            ps.wkts *= d
            ps.matches += 1
    if bat_rows is not None:
        for row in bat_rows.itertuples(index=False):
            ps = st.players[row.player_id]
            ps.runs += row.runs
            ps.balls += row.balls
            ps.outs += 1.0 if row.out else 0.0
    if bowl_rows is not None:
        for row in bowl_rows.itertuples(index=False):
            ps = st.players[row.player_id]
            ps.bowl_balls += row.balls
            ps.bowl_runs += row.runs
            ps.wkts += row.wickets

    for team, xi_ids in ((a, actual_a), (b, actual_b)):
        team.n += 1
        team.last = r.start_time
        team.places[place] += 1
        if xi_ids:
            team.xis.append(tuple(xi_ids))
