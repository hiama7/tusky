"""Synthetic leagues with known team strengths, for tests and the offline `demo` command.
Never written to the real database."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from .features import MATCH_COLUMNS


def _round_robin(n_teams: int) -> list[list[tuple[int, int]]]:
    """Double round robin rounds (circle method)."""
    teams = list(range(n_teams))
    rounds = []
    for r in range(n_teams - 1):
        pairs = [(teams[i], teams[n_teams - 1 - i]) for i in range(n_teams // 2)]
        rounds.append(pairs if r % 2 == 0 else [(b, a) for a, b in pairs])
        teams = [teams[0]] + [teams[-1]] + teams[1:-1]
    return rounds + [[(b, a) for a, b in rnd] for rnd in rounds]


def league(
    sport: str = "football",
    n_teams: int = 20,
    seasons: int = 3,
    upcoming_rounds: int = 1,
    seed: int = 0,
    start: datetime = datetime(2021, 8, 1, tzinfo=timezone.utc),
) -> tuple[pd.DataFrame, dict]:
    """Return (matches, truth). The last `upcoming_rounds` rounds are scheduled, without scores.

    Football: goals ~ Poisson(exp(base + home + att_T - def_O)).
    Basketball: points ~ Normal(100 + home + off_T - def_O, 11), overtime breaks ties.
    Strengths drift a little every round and more between seasons, like real squads.
    """
    rng = np.random.default_rng(seed)
    if sport == "football":
        att = rng.normal(0, 0.3, n_teams)
        dfn = rng.normal(0, 0.25, n_teams)
    else:
        att = rng.normal(0, 5, n_teams)
        dfn = rng.normal(0, 4, n_teams)

    rows = []
    expected: dict[int, tuple[float, float]] = {}
    match_id = 1
    walk = 0.02 if sport == "football" else 0.4  # in-season drift per round (injuries, form)
    team_offset = 1000
    when = start
    rounds = _round_robin(n_teams)
    for s in range(seasons):
        if s:
            # Strengths drift between seasons; summer break.
            att = att * 0.85 + rng.normal(0, 0.1 if sport == "football" else 2, n_teams)
            dfn = dfn * 0.85 + rng.normal(0, 0.08 if sport == "football" else 1.5, n_teams)
            when += timedelta(days=90)
        for rnd in rounds:
            att = att + rng.normal(0, walk, n_teams)
            dfn = dfn + rng.normal(0, walk, n_teams)
            for h, a in rnd:
                if sport == "football":
                    eh, ea = np.exp(0.15 + 0.25 + att[h] - dfn[a]), np.exp(0.15 + att[a] - dfn[h])
                    hs, as_ = rng.poisson(eh), rng.poisson(ea)
                else:
                    eh, ea = 100 + 3 + att[h] - dfn[a], 100 + att[a] - dfn[h]
                    hs, as_ = round(rng.normal(eh, 11)), round(rng.normal(ea, 11))
                    while hs == as_:
                        hs += rng.integers(5, 16)
                        as_ += rng.integers(5, 16)
                expected[match_id] = (float(eh), float(ea))
                rows.append([match_id, when, 1, team_offset + h, team_offset + a, float(hs), float(as_), "completed"])
                match_id += 1
            when += timedelta(days=7 if sport == "football" else 3)

    # Upcoming fixtures: reuse the first rounds of the schedule.
    for rnd in rounds[:upcoming_rounds]:
        for h, a in rnd:
            rows.append([match_id, when, 1, team_offset + h, team_offset + a, np.nan, np.nan, "scheduled"])
            match_id += 1
        when += timedelta(days=7 if sport == "football" else 3)

    df = pd.DataFrame(rows, columns=MATCH_COLUMNS)
    # `expected`: the true scoring rates of every played match (for oracle benchmarks).
    truth = {"att": att, "def": dfn, "team_offset": team_offset, "expected": expected}
    return df, truth
