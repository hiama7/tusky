"""Phase 3 features for team sports (football, basketball), built as a causal replay.

Every value for a match is computed from the matches BEFORE it; the state is updated with the
result only afterwards. The audit's causal probe (`audit.causal_probe`) is run against this
builder in the tests and in the ablation, so a leak cannot hide here.

Groups (used for the ablation, see GROUPS):
  windows      points / margin / goals over the last 5, 10 and 15 matches, venue-split form
  winpct       historical win percentage, shrunk toward 50% for teams with few games
  h2h          head to head over the last 5 meetings, from the home team's side
  consistency  spread of recent margins (a steady team vs a streaky one)
  congestion   matches in the last 7 and 14 days, back-to-back flag
  importance   European cup (football) or playoff (basketball) flag
  missing      "built from fewer than 5 games" and "never met" flags, so an unknown is not read as average
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .features import normalize_matches

WINDOWS = (5, 10, 15)
H2H_N = 5
SHRINK = 2.0  # pseudo-matches of the league average added to every window mean
WINPCT_PRIOR = 10.0

# Domain constants (not estimated from the data, so they cannot leak): average points per match,
# goals/points for, and the usual spread of a single match margin.
PRIORS = {
    "football": {"ppg": 1.35, "gf": 1.38, "gd_std": 1.7, "win": 3.0, "draw": 1.0},
    "basketball": {"ppg": 0.5, "gf": 112.0, "gd_std": 13.0, "win": 1.0, "draw": 0.5},
}
EUROPEAN_CUP_IDS = {"football": {"2"}, "basketball": set()}

GROUPS = {
    "windows": ["h_ppg5", "h_ppg10", "h_ppg15", "a_ppg5", "a_ppg10", "a_ppg15", "h_gd5", "h_gd10", "h_gd15",
                "a_gd5", "a_gd10", "a_gd15", "h_gf10", "h_ga10", "a_gf10", "a_ga10", "h_home_ppg5", "a_away_ppg5",
                "ppg5_diff", "ppg10_diff", "ppg15_diff", "gd10_diff"],
    "winpct": ["h_win_pct", "a_win_pct", "winpct_diff"],
    "h2h": ["h2h_ppg", "h2h_gd", "h2h_n"],
    "consistency": ["h_gd_std10", "a_gd_std10", "cons_diff"],
    "congestion": ["h_games7", "a_games7", "h_games14", "a_games14", "games14_diff", "h_b2b", "a_b2b"],
    "importance": ["is_cup", "is_playoff"],
    "missing": ["h_short", "a_short", "h2h_none"],
}
FEATURES = [c for cols in GROUPS.values() for c in cols]


@dataclass
class _Team:
    results: deque = field(default_factory=lambda: deque(maxlen=max(WINDOWS)))  # (points, margin, gf, ga, is_home)
    dates: deque = field(default_factory=lambda: deque(maxlen=40))  # recent match days, results unknown or not
    wins: int = 0
    games: int = 0


def _shrunk_mean(values: list[float], prior: float) -> float:
    return (sum(values) + prior * SHRINK) / (len(values) + SHRINK)


def _team_block(t: _Team, now_day: float, prior: dict, home_side: bool) -> dict:
    """Window features of one team as of `now_day`, from its own past only."""
    res = list(t.results)
    out: dict[str, float] = {}
    for k in WINDOWS:
        last = res[-k:]
        out[f"ppg{k}"] = _shrunk_mean([r[0] for r in last], prior["ppg"])
        out[f"gd{k}"] = _shrunk_mean([r[1] for r in last], 0.0)
    last10 = res[-10:]
    out["gf10"] = _shrunk_mean([r[2] for r in last10], prior["gf"])
    out["ga10"] = _shrunk_mean([r[3] for r in last10], prior["gf"])
    margins = [r[1] for r in last10]
    out["gd_std10"] = float(np.std(margins, ddof=1)) if len(margins) >= 3 else prior["gd_std"]
    venue = [r[0] for r in res if r[4] == home_side][-5:]
    out["venue_ppg5"] = _shrunk_mean(venue, prior["ppg"])
    out["win_pct"] = (t.wins + WINPCT_PRIOR / 2) / (t.games + WINPCT_PRIOR)
    days = list(t.dates)
    out["games7"] = float(sum(1 for d in days if now_day - d <= 7))
    out["games14"] = float(sum(1 for d in days if now_day - d <= 14))
    out["b2b"] = 1.0 if days and now_day - days[-1] <= 1.5 else 0.0
    out["short"] = 1.0 if len(res) < 5 else 0.0
    return out


def build(matches: pd.DataFrame, sport: str, extras: pd.DataFrame | None = None) -> pd.DataFrame:
    """`match_id` + one column per name in FEATURES, in kick-off order.

    `extras` has one row per match: `match_id`, `comp_external_id`, `stage` (basketball: the
    playoff round label, null in the regular season)."""
    prior = PRIORS[sport]
    cups = EUROPEAN_CUP_IDS[sport]
    m = normalize_matches(matches)
    ex = extras.set_index("match_id") if extras is not None else pd.DataFrame(index=m["match_id"])
    teams: dict[int, _Team] = {}
    h2h: dict[tuple[int, int], deque] = {}
    rows = []
    for r in m.itertuples(index=False):
        t = pd.Timestamp(r.start_time)
        day = t.timestamp() / 86400.0
        h = teams.setdefault(int(r.home_team_id), _Team())
        a = teams.setdefault(int(r.away_team_id), _Team())
        hb, ab = _team_block(h, day, prior, True), _team_block(a, day, prior, False)

        pair = (min(r.home_team_id, r.away_team_id), max(r.home_team_id, r.away_team_id))
        past = list(h2h.get(pair, ()))  # (home_id, home_points, home_margin) of earlier meetings
        # From the CURRENT home team's side: its own points/margin in each earlier meeting, wherever it was played.
        pts = [hp if hid == r.home_team_id else _flip(hp, prior) for hid, hp, _ in past]
        mar = [mg if hid == r.home_team_id else -mg for hid, _, mg in past]

        row = {"match_id": int(r.match_id)}
        for k in WINDOWS:
            row[f"h_ppg{k}"], row[f"a_ppg{k}"] = hb[f"ppg{k}"], ab[f"ppg{k}"]
            row[f"h_gd{k}"], row[f"a_gd{k}"] = hb[f"gd{k}"], ab[f"gd{k}"]
        row.update(
            h_gf10=hb["gf10"], h_ga10=hb["ga10"], a_gf10=ab["gf10"], a_ga10=ab["ga10"],
            h_home_ppg5=hb["venue_ppg5"], a_away_ppg5=ab["venue_ppg5"],
            ppg5_diff=hb["ppg5"] - ab["ppg5"], ppg10_diff=hb["ppg10"] - ab["ppg10"], ppg15_diff=hb["ppg15"] - ab["ppg15"],
            gd10_diff=hb["gd10"] - ab["gd10"],
            h_win_pct=hb["win_pct"], a_win_pct=ab["win_pct"], winpct_diff=hb["win_pct"] - ab["win_pct"],
            h2h_ppg=_shrunk_mean(pts, prior["ppg"]), h2h_gd=_shrunk_mean(mar, 0.0), h2h_n=float(len(past)),
            h_gd_std10=hb["gd_std10"], a_gd_std10=ab["gd_std10"], cons_diff=ab["gd_std10"] - hb["gd_std10"],
            h_games7=hb["games7"], a_games7=ab["games7"], h_games14=hb["games14"], a_games14=ab["games14"],
            games14_diff=hb["games14"] - ab["games14"], h_b2b=hb["b2b"], a_b2b=ab["b2b"],
            is_cup=1.0 if str(_get(ex, r.match_id, "comp_external_id")) in cups else 0.0,
            is_playoff=1.0 if _get(ex, r.match_id, "stage") not in (None, "", "None") and sport == "basketball" else 0.0,
            h_short=hb["short"], a_short=ab["short"], h2h_none=1.0 if not past else 0.0,
        )
        rows.append(row)

        # ---- update with this match (after its features were taken) ----
        status = str(r.status)
        if status == "completed" or not (math.isnan(r.home_score) or math.isnan(r.away_score)):
            h.dates.append(day)
            a.dates.append(day)
        if math.isnan(r.home_score) or math.isnan(r.away_score):
            continue
        hs, as_ = float(r.home_score), float(r.away_score)
        hp = prior["win"] if hs > as_ else prior["draw"] if hs == as_ else 0.0
        ap = prior["win"] if as_ > hs else prior["draw"] if hs == as_ else 0.0
        h.results.append((hp, hs - as_, hs, as_, True))
        a.results.append((ap, as_ - hs, as_, hs, False))
        h.games += 1
        a.games += 1
        h.wins += int(hs > as_)
        a.wins += int(as_ > hs)
        h2h.setdefault(pair, deque(maxlen=H2H_N)).append((int(r.home_team_id), hp, hs - as_))
    out = pd.DataFrame(rows)
    return out[["match_id", *FEATURES]]


def _flip(points_for_home: float, prior: dict) -> float:
    """Points of the OTHER side given the first side's points in one match (win <-> loss, draw stays)."""
    if points_for_home == prior["win"]:
        return 0.0
    if points_for_home == 0.0:
        return prior["win"]
    return points_for_home


def _get(ex: pd.DataFrame, match_id, col: str):
    if col not in ex.columns or match_id not in ex.index:
        return None
    v = ex.at[match_id, col]
    return None if pd.isna(v) else v
