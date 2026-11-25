import numpy as np
import pandas as pd
import pytest

from tusky_ml import audit, features2 as f2
from tusky_ml.synthetic import league

COLS = ["match_id", "start_time", "competition_id", "home_team_id", "away_team_id", "home_score", "away_score", "status"]
T0 = pd.Timestamp("2025-01-01", tz="UTC")


def _m(rows):
    return pd.DataFrame(rows, columns=COLS)


def _played(i, day, home, away, hs, as_):
    return [i, T0 + pd.Timedelta(days=day), 1, home, away, hs, as_, "completed"]


def test_window_means_are_shrunk_toward_the_league_average_with_exact_values():
    # Team 1 wins its first three matches 2-0 (9 points, goal difference +6).
    df = _m([_played(i, 7 * i, 1, 10 + i, 2, 0) for i in range(3)] + [_played(10, 30, 1, 99, 0, 0)])
    out = f2.build(df, "football").set_index("match_id")
    row = out.loc[10]
    assert row["h_ppg5"] == pytest.approx((9 + 1.35 * 2) / (3 + 2))
    assert row["h_gd5"] == pytest.approx(6 / (3 + 2))
    assert row["h_gf10"] == pytest.approx((6 + 1.38 * 2) / (3 + 2))
    assert row["h_win_pct"] == pytest.approx((3 + 5) / (3 + 10))
    assert row["h_short"] == 1.0  # only 3 matches behind these numbers
    # a team with no history sits exactly on the league prior
    assert row["a_ppg5"] == pytest.approx(1.35) and row["a_win_pct"] == pytest.approx(0.5)


def test_head_to_head_is_read_from_the_current_home_teams_side_wherever_it_was_played():
    df = _m([_played(1, 0, 1, 2, 2, 0),    # team 1 (home) beats team 2 2-0
             _played(2, 30, 2, 1, 1, 1),   # next meeting: team 2 at home, a 1-1 draw
             _played(3, 60, 2, 1, 0, 0)])  # features for this one: team 2 is home
    out = f2.build(df, "football").set_index("match_id")
    # From team 2's side: lost 0-2 (0 points, margin -2), then drew (1 point, margin 0).
    assert out.loc[3, "h2h_n"] == 2 and out.loc[3, "h2h_none"] == 0.0
    assert out.loc[3, "h2h_ppg"] == pytest.approx((0 + 1 + 1.35 * 2) / (2 + 2))
    assert out.loc[3, "h2h_gd"] == pytest.approx((-2 + 0) / (2 + 2))
    # the first meeting has no history: flagged, and at the prior
    assert out.loc[1, "h2h_none"] == 1.0 and out.loc[1, "h2h_ppg"] == pytest.approx(1.35)


def test_consistency_congestion_and_back_to_back():
    # Team 1 plays five matches on consecutive days: margins +1, -1, +1, -1, +1.
    df = _m([_played(i + 1, i, 1, 50 + i, 1 if i % 2 == 0 else 0, 0 if i % 2 == 0 else 1) for i in range(5)]
            + [_played(99, 5, 1, 77, 0, 0)])
    out = f2.build(df, "basketball").set_index("match_id")
    row = out.loc[99]
    assert row["h_games7"] == 5 and row["h_games14"] == 5
    assert row["h_b2b"] == 1.0 and row["a_b2b"] == 0.0  # played yesterday
    assert row["h_gd_std10"] == pytest.approx(np.std([1, -1, 1, -1, 1], ddof=1))
    assert row["a_gd_std10"] == f2.PRIORS["basketball"]["gd_std"]  # too few matches: the prior, not a made-up number


def test_importance_flags_come_from_the_extras():
    df = _m([_played(1, 0, 1, 2, 1, 0), _played(2, 3, 3, 4, 2, 2)])
    extras = pd.DataFrame({"match_id": [1, 2], "comp_external_id": ["39", "2"], "stage": [None, "NBA - Final"]})
    out = f2.build(df, "football", extras).set_index("match_id")
    assert out["is_cup"].tolist() == [0.0, 1.0] and out["is_playoff"].tolist() == [0.0, 0.0]  # playoffs only count in basketball
    out_b = f2.build(df, "basketball", extras).set_index("match_id")
    assert out_b["is_playoff"].tolist() == [0.0, 1.0] and out_b["is_cup"].tolist() == [0.0, 0.0]


def test_a_played_match_without_a_result_counts_for_congestion_but_not_form():
    df = _m([_played(1, 0, 1, 2, 3, 0), [2, T0 + pd.Timedelta(days=3), 1, 1, 3, np.nan, np.nan, "completed"], _played(3, 5, 1, 4, 1, 1)])
    row = f2.build(df, "football").set_index("match_id").loc[3]
    assert row["h_games14"] == 2  # both earlier matches happened
    assert row["h_ppg5"] == pytest.approx((3 + 1.35 * 2) / (1 + 2))  # but only one result is known


def test_output_shape_has_no_missing_values_and_matches_the_declared_columns():
    matches, _ = league("football", n_teams=10, seasons=2, seed=1)
    out = f2.build(matches, "football")
    assert list(out.columns) == ["match_id", *f2.FEATURES] and len(out) == len(matches)
    assert not out.drop(columns="match_id").isna().any().any() and np.isfinite(out.drop(columns="match_id").to_numpy()).all()
    assert set(sum(f2.GROUPS.values(), [])) == set(f2.FEATURES)


def test_features_pass_the_causal_leakage_probe():
    matches, _ = league("football", n_teams=10, seasons=3, seed=3, upcoming_rounds=0)
    res = audit.causal_probe(lambda m: f2.build(m, "football"), matches, f2.FEATURES, n=8, min_index=100)
    assert res["passed"] and res["max_abs_difference"] < 1e-9


def test_the_probe_catches_a_planted_leak_in_these_features():
    matches, _ = league("football", n_teams=10, seasons=3, seed=3, upcoming_rounds=0)

    def leaky(m):
        out = f2.build(m, "football")
        own = m.set_index("match_id")
        # "form" that includes the match's own margin (NaN while hidden -> treated as 0)
        out["h_gd5"] = out["h_gd5"] + (own.loc[out["match_id"], "home_score"] - own.loc[out["match_id"], "away_score"]).fillna(0.0).to_numpy()
        return out

    res = audit.causal_probe(leaky, matches, f2.FEATURES, n=8, min_index=100)
    assert not res["passed"] and res["failures"][0]["feature"] == "h_gd5"
