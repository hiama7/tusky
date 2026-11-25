"""Phase 3 features for cricket, as a causal replay (state is read before a match and updated after).

Groups (for the ablation, see GROUPS):
  form        win share over the last 15 matches and the all-time win percentage
  consistency how steady a team's innings totals are over its last 10 matches
  venue       each side's record at THIS venue, shrunk toward 50%
  importance  tournament context: knockout stage, major world/continental event, bilateral tour
  recent      the playing XI's batting average/strike rate and bowling economy/wicket rate over
              each player's last 5 innings or spells (the core features use a slow decay)

Features named in ANTISYMMETRIC2 are "team A minus team B": swapping the teams negates them, and
they are registered with the core replay's orientation augmentation below.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict, deque

import numpy as np
import pandas as pd

from . import features as cfeat
from .data import CricketData

GROUPS = {
    "form": ["form15_diff", "winpct_all_diff"],
    "consistency": ["runs_consistency_diff"],
    "venue": ["venue_win_diff", "venue_games_min"],
    "importance": ["is_knockout", "is_major_event", "is_bilateral"],
    "recent": ["xi_recent_bat_avg_diff", "xi_recent_bat_sr_diff", "xi_recent_econ_diff", "xi_recent_wkt_rate_diff"],
}
FEATURES = [c for cols in GROUPS.values() for c in cols]
# Tournament flags are symmetric (the same for both teams), so with the orientation augmentation a
# linear model gives them exactly zero weight. They matter through "does the stronger side win more
# reliably here": the flag times the strength difference, which is antisymmetric like the strength itself.
INTERACTIONS = ["knockout_x_elo", "major_x_elo", "bilateral_x_elo"]
GROUPS["importance"] = GROUPS["importance"] + INTERACTIONS
ANTISYMMETRIC2 = {"knockout_x_elo", "major_x_elo", "bilateral_x_elo", "form15_diff", "winpct_all_diff", "runs_consistency_diff", "venue_win_diff", "xi_recent_bat_avg_diff",
                  "xi_recent_bat_sr_diff", "xi_recent_econ_diff", "xi_recent_wkt_rate_diff"}
cfeat.ANTISYMMETRIC |= ANTISYMMETRIC2  # so the core orientation augmentation negates them on a team swap

_KNOCKOUT = re.compile(r"final|semi|quarter|eliminator|qualifier|play-?off|knockout|super (four|six|8|eight)", re.I)
_MAJOR = re.compile(r"world cup|world twenty20|world t20|champions trophy|asia cup|olympic|commonwealth|continental cup|nations cup|"
                    r"african games|asian games|pacific games|south asian games", re.I)
_BILATERAL = re.compile(r"\btour of\b|\bin [A-Z][a-z]+ \d{4}|\bseries\b|\btrophy\b(?!.*world)", re.I)

WIN_PRIOR = 10.0
VENUE_PRIOR = 4.0
FORM_N = 15
CONS_N = 10
RECENT_N = 5


def _prior_rates(fmt: str) -> tuple[float, float, float, float]:
    """(batting average, strike rate per ball, economy per ball, wicket rate per ball) priors for a format."""
    cfg = cfeat.FORMATS[fmt]
    sr = cfg.rr_prior / 6.0
    wr = 1 / 20 if cfg.full_balls == 120 else 1 / 35 if cfg.full_balls else 1 / 60
    return (25.0 if cfg.full_balls else 32.0), sr, sr, wr


def add_interactions(extra: pd.DataFrame, elo_diff) -> pd.DataFrame:
    """Add flag x Elo-difference columns. `elo_diff` is the core replay's (A minus B) Elo difference, aligned to `extra`."""
    out = extra.copy()
    e = np.asarray(elo_diff, dtype=float)
    out["knockout_x_elo"] = out["is_knockout"].to_numpy() * e
    out["major_x_elo"] = out["is_major_event"].to_numpy() * e
    out["bilateral_x_elo"] = out["is_bilateral"].to_numpy() * e
    return out


def importance_flags(event_name, event_stage) -> tuple[float, float, float]:
    name = "" if event_name is None or (isinstance(event_name, float) and math.isnan(event_name)) else str(event_name)
    stage = "" if event_stage is None or (isinstance(event_stage, float) and math.isnan(event_stage)) else str(event_stage)
    return (1.0 if _KNOCKOUT.search(stage) else 0.0, 1.0 if _MAJOR.search(name) else 0.0,
            1.0 if (_BILATERAL.search(name) and not _MAJOR.search(name)) else 0.0)


class _Team:
    __slots__ = ("results", "totals", "wins", "games", "venue")

    def __init__(self):
        self.results = deque(maxlen=FORM_N)
        self.totals = deque(maxlen=CONS_N)
        self.wins = 0
        self.games = 0
        self.venue: dict = defaultdict(lambda: [0, 0])


def _form(results: deque) -> float:
    return (sum(results) + 1.0) / (len(results) + 2.0) - 0.5


def _consistency(t: _Team, prior_std: float) -> float:
    return -(float(np.std(t.totals, ddof=1)) if len(t.totals) >= 4 else prior_std) / 10.0


def _xi_recent(xi, batting: dict, bowling: dict, priors) -> tuple[float, float, float, float]:
    avg_p, sr_p, econ_p, wr_p = priors
    bats = []
    for p in xi:
        h = batting.get(p)
        if h:
            runs, balls, outs = sum(x[0] for x in h), sum(x[1] for x in h), sum(x[2] for x in h)
            bats.append((balls, (runs + 2 * avg_p) / (outs + 2), (runs + 30 * sr_p) / (balls + 30)))
    bats = sorted(bats, key=lambda b: -b[0])[:7]
    bowls = []
    for p in xi:
        h = bowling.get(p)
        if h:
            balls, runs, wk = sum(x[0] for x in h), sum(x[1] for x in h), sum(x[2] for x in h)
            bowls.append((balls, (runs + 30 * econ_p) / (balls + 30), (wk + 30 * wr_p) / (balls + 30)))
    bowls = sorted(bowls, key=lambda b: -b[0])[:5]
    return (float(np.mean([b[1] for b in bats])) if bats else avg_p, float(np.mean([b[2] for b in bats])) if bats else sr_p,
            float(np.mean([b[1] for b in bowls])) if bowls else econ_p, float(np.mean([b[2] for b in bowls])) if bowls else wr_p)


def build(data: CricketData) -> pd.DataFrame:
    """`match_id` + FEATURES for every match, in kick-off order."""
    m = data.matches.sort_values(["start_time", "match_id"], kind="stable").reset_index(drop=True)
    inn_runs: dict[tuple[int, int], float] = defaultdict(float)  # (match, batting team) -> total runs
    for r in data.innings.itertuples(index=False):
        inn_runs[(r.match_id, r.bat_team)] += float(r.runs)
    bat_by_match = {k: g for k, g in data.batting.groupby("match_id")}
    bowl_by_match = {k: g for k, g in data.bowling.groupby("match_id")}
    xi: dict[tuple[int, int], list[int]] = defaultdict(list)
    for r in data.lineups.itertuples(index=False):
        xi[(r.match_id, r.team_id)].append(r.player_id)

    teams: dict[tuple[str, int], _Team] = {}
    batting: dict[str, dict[int, deque]] = defaultdict(dict)
    bowling: dict[str, dict[int, deque]] = defaultdict(dict)
    rows = []
    for r in m.itertuples(index=False):
        fmt = r.format
        if fmt not in cfeat.FORMATS:
            continue
        a = teams.setdefault((fmt, r.team1), _Team())
        b = teams.setdefault((fmt, r.team2), _Team())
        priors = _prior_rates(fmt)
        prior_std = 30.0 if fmt == "T20" else 55.0 if fmt == "ODI" else 150.0
        vkey = r.venue_id if pd.notna(r.venue_id) else f"city:{r.city}"
        va, vb = a.venue[vkey], b.venue[vkey]
        recent_a = _xi_recent(xi.get((r.match_id, r.team1), []), batting[fmt], bowling[fmt], priors)
        recent_b = _xi_recent(xi.get((r.match_id, r.team2), []), batting[fmt], bowling[fmt], priors)
        knock, major, bilateral = importance_flags(getattr(r, "event_name", None), getattr(r, "event_stage", None))
        rows.append({
            "match_id": int(r.match_id),
            "form15_diff": _form(a.results) - _form(b.results),
            "winpct_all_diff": (a.wins + WIN_PRIOR / 2) / (a.games + WIN_PRIOR) - (b.wins + WIN_PRIOR / 2) / (b.games + WIN_PRIOR),
            "runs_consistency_diff": _consistency(a, prior_std) - _consistency(b, prior_std),
            "venue_win_diff": (va[0] + VENUE_PRIOR / 2) / (va[1] + VENUE_PRIOR) - (vb[0] + VENUE_PRIOR / 2) / (vb[1] + VENUE_PRIOR),
            "venue_games_min": math.log1p(min(va[1], vb[1])),
            "is_knockout": knock, "is_major_event": major, "is_bilateral": bilateral,
            "xi_recent_bat_avg_diff": (recent_a[0] - recent_b[0]) / 10.0,
            "xi_recent_bat_sr_diff": (recent_a[1] - recent_b[1]) * 100.0,
            "xi_recent_econ_diff": (recent_a[2] - recent_b[2]) * 100.0,
            "xi_recent_wkt_rate_diff": (recent_a[3] - recent_b[3]) * 100.0,
        })

        # ---- update with this match (after its features were taken) ----
        decided = pd.notna(r.winner) and r.result_type in ("normal", "dls", "super_over")
        for team, other_id in ((a, r.team1), (b, r.team2)):
            total = inn_runs.get((r.match_id, other_id))
            if total is not None:
                team.totals.append(total)
        if decided:
            for team, tid in ((a, r.team1), (b, r.team2)):
                won = 1.0 if r.winner == tid else 0.0
                team.results.append(won)
                team.wins += int(won)
                team.games += 1
            for team, tid, v in ((a, r.team1, va), (b, r.team2, vb)):
                v[1] += 1
                v[0] += int(r.winner == tid)
        for row in bat_by_match.get(r.match_id, pd.DataFrame(columns=["player_id", "runs", "balls", "out"])).itertuples(index=False):
            batting[fmt].setdefault(row.player_id, deque(maxlen=RECENT_N)).append((float(row.runs), float(row.balls), 1.0 if row.out else 0.0))
        for row in bowl_by_match.get(r.match_id, pd.DataFrame(columns=["player_id", "balls", "runs", "wickets"])).itertuples(index=False):
            bowling[fmt].setdefault(row.player_id, deque(maxlen=RECENT_N)).append((float(row.balls), float(row.runs), float(row.wickets)))
    out = pd.DataFrame(rows)
    return out[["match_id", *[c for c in FEATURES if c not in INTERACTIONS]]]
