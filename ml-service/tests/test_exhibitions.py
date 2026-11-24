import pandas as pd

from tusky_ml.exhibitions import exhibition_mask


def _games(rows):
    return pd.DataFrame(rows, columns=["start_time", "home_team_id", "away_team_id"])


def test_nba_preseason_and_all_star_are_dropped():
    # Enough regular-season games that every real team clears MIN_TEAM_GAMES.
    regular = [[f"2023-{m}-{d:02d}", 1 + d % 4, 5 + d % 4] for m in (11, 12) for d in range(1, 29)]
    games = _games(
        [["2023-10-05", 1, 5], ["2023-10-20", 2, 6], ["2023-10-24", 1, 6], *regular, ["2024-02-19", 98, 99]]
    )
    leagues = pd.Series(["12"] * len(games))
    mask = exhibition_mask("basketball", games, leagues)
    assert mask.tolist()[:3] == [True, True, False]  # preseason, preseason, opening night
    assert mask.iloc[-1]  # East vs West
    assert not mask.iloc[3:-1].any()


def test_other_leagues_and_sports_untouched():
    games = _games([["2023-10-05", 1, 2]] * 12)
    assert not exhibition_mask("basketball", games, pd.Series(["120"] * 12)).any()
    assert not exhibition_mask("football", games, pd.Series(["12"] * 12)).any()
