"""Games that are real fixtures in the provider feed but not competitive matches:
preseason and All-Star style exhibitions. They are dropped before the feature replay, so
they neither train the model nor move team ratings.

API-Basketball does not mark NBA preseason games, so the regular-season opening dates are
listed here (add a line each season). Exhibition sides (East/West, Team X, touring clubs)
are detected by how rarely they appear.
"""

from __future__ import annotations

import pandas as pd

# (sport, provider league id) -> regular-season opening dates (UTC). Games in the 45 days
# before an opener are preseason.
SEASON_OPENERS: dict[tuple[str, str], list[str]] = {
    ("basketball", "12"): ["2022-10-18", "2023-10-24", "2024-10-22", "2025-10-21", "2026-10-20"],
}
PRESEASON_WINDOW_DAYS = 45
# A side with fewer games than this across the whole history is an exhibition team.
MIN_TEAM_GAMES = 10


def exhibition_mask(sport: str, matches: pd.DataFrame, league_ids: pd.Series) -> pd.Series:
    """True for rows that are preseason or exhibition games. `league_ids` holds each
    match's provider competition id (as text), aligned with `matches`."""
    start = pd.to_datetime(matches["start_time"], utc=True)
    mask = pd.Series(False, index=matches.index)
    for (sp, league), openers in SEASON_OPENERS.items():
        if sp != sport:
            continue
        in_league = league_ids.astype(str) == league
        for d in openers:
            opener = pd.Timestamp(d, tz="UTC")
            mask |= in_league & (start < opener) & (start >= opener - pd.Timedelta(days=PRESEASON_WINDOW_DAYS))
    if sport == "basketball":
        counts = pd.concat([matches["home_team_id"], matches["away_team_id"]]).value_counts()
        rare = set(counts[counts < MIN_TEAM_GAMES].index)
        mask |= matches["home_team_id"].isin(rare) | matches["away_team_id"].isin(rare)
    return mask
