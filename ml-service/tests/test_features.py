import numpy as np
import pandas as pd

from tusky_ml.features import FOOTBALL, build_features, team_rows, trainable
from tusky_ml.synthetic import league

COLS = ["match_id", "start_time", "competition_id", "home_team_id", "away_team_id", "home_score", "away_score", "status"]


def _matches(rows):
    return pd.DataFrame(rows, columns=COLS)


def test_features_use_only_prior_matches():
    t0 = pd.Timestamp("2024-01-01", tz="UTC")
    df = _matches(
        [
            [1, t0, 1, 10, 20, 3, 0, "completed"],
            [2, t0 + pd.Timedelta(days=7), 1, 10, 20, 0, 0, "completed"],
            [3, t0 + pd.Timedelta(days=14), 1, 10, 20, None, None, "scheduled"],
        ]
    )
    wide = build_features(df, FOOTBALL)
    # First meeting: nothing known yet, both teams at the starting Elo.
    assert wide.loc[0, "h_elo"] == wide.loc[0, "a_elo"] == 1500
    assert wide.loc[0, "h_n"] == 0
    # Second meeting sees the 3-0 win, and only that.
    assert wide.loc[1, "h_elo"] > 1500 > wide.loc[1, "a_elo"]
    assert wide.loc[1, "h_n"] == 1
    # Upcoming match sees both results; it is not marked played.
    assert wide.loc[2, "h_n"] == 2
    assert list(wide["played"]) == [True, True, False]


def test_features_do_not_change_when_future_results_change():
    df, _ = league("football", n_teams=8, seasons=1, seed=3)
    a = build_features(df, FOOTBALL)
    altered = df.copy()
    last = altered["home_score"].last_valid_index()
    altered.loc[last, "home_score"] = 9
    b = build_features(altered, FOOTBALL)
    cols = ["h_elo", "a_elo", "h_att", "a_def"]
    # Features up to and including the altered match are computed before its result.
    pos = b.index[b["match_id"] == altered.loc[last, "match_id"]][0]
    pd.testing.assert_frame_equal(a.loc[:pos, cols], b.loc[:pos, cols])
    # ...and later matches do see it.
    after = ["h_elo", "a_elo", "h_att", "a_att", "h_def", "a_def"]
    assert not np.allclose(a.loc[pos + 1 :, after].to_numpy(), b.loc[pos + 1 :, after].to_numpy())


def test_offseason_regresses_elo_toward_mean():
    t0 = pd.Timestamp("2024-01-01", tz="UTC")
    rows = [[i + 1, t0 + pd.Timedelta(days=7 * i), 1, 10, 20, 4, 0, "completed"] for i in range(5)]
    rows.append([6, t0 + pd.Timedelta(days=7 * 4 + 1), 1, 10, 20, None, None, "scheduled"])
    rows.append([7, t0 + pd.Timedelta(days=7 * 4 + 120), 1, 10, 20, None, None, "scheduled"])
    wide = build_features(_matches(rows), FOOTBALL)
    # Same state before both, but the second comes after a long break.
    assert 1500 < wide.loc[6, "h_elo"] < wide.loc[5, "h_elo"]


def test_team_rows_mirror_each_other():
    df, _ = league("football", n_teams=6, seasons=1, seed=1)
    wide = build_features(df, FOOTBALL)
    home, away = team_rows(wide)
    assert (home["is_home"] == 1).all() and (away["is_home"] == 0).all()
    np.testing.assert_allclose(home["elo_diff"], -away["elo_diff"])
    np.testing.assert_allclose(home["att"], wide["h_att"])
    np.testing.assert_allclose(away["opp_def"], wide["h_def"])


def test_trainable_requires_history():
    df, _ = league("football", n_teams=6, seasons=1, seed=1)
    wide = build_features(df, FOOTBALL)
    rows = trainable(wide, FOOTBALL)
    assert len(rows) > 0
    assert (rows["h_n"] >= 3).all() and (rows["a_n"] >= 3).all() and rows["played"].all()
