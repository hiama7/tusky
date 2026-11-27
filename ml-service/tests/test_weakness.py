from __future__ import annotations

import numpy as np
import pandas as pd

from tusky_ml import weakness as w


def fixtures() -> pd.DataFrame:
    rows = []
    # season 2024: teams 1-2; season 2025: team 3 appears (new to the league)
    for i, (day, home, away) in enumerate([("2024-08-01", 1, 2), ("2024-09-01", 2, 1), ("2025-05-01", 1, 2), ("2025-08-01", 1, 2), ("2025-08-08", 3, 1)], start=1):
        rows.append({"match_id": i, "start_time": pd.Timestamp(day, tz="UTC"), "competition_id": 7, "home_team_id": home, "away_team_id": away})
    return pd.DataFrame(rows)


def test_season_runs_july_to_june():
    ts = pd.Series(pd.to_datetime(["2025-06-30", "2025-07-01"], utc=True))
    assert list(w.season_of(ts)) == [2024, 2025]


def test_context_counts_only_earlier_matches_and_flags_newcomers():
    c = w.context(fixtures())
    assert list(c["games_before"]) == [0, 1, 2, 0, 0]
    assert list(c["newcomer"]) == [False, False, False, False, True]
    # adding later fixtures must not change what was known earlier
    assert w.context(fixtures().iloc[:4]).equals(c.iloc[:4])


def test_sharpen_keeps_probabilities_and_moves_them_the_right_way():
    p = np.array([[0.6, 0.25, 0.15]])
    assert np.allclose(w.sharpen(p, 1.0), p)
    assert w.sharpen(p, 1.4)[0, 0] > 0.6 > w.sharpen(p, 0.7)[0, 0]
    assert np.isclose(w.sharpen(p, 1.4).sum(), 1.0)


def test_chosen_exponent_sharpens_an_underconfident_model():
    rng = np.random.default_rng(1)
    truth = np.tile([0.8, 0.12, 0.08], (4000, 1))
    y = np.array([rng.choice(3, p=row) for row in truth])
    timid = w.sharpen(truth, 0.7)
    assert w.choose_gamma(timid, y) > 1.15


def test_bands_skip_thin_groups():
    prob = np.array([0.55] * 25 + [0.9] * 3)
    out = w.bands(prob, np.ones_like(prob), [0.5, 0.6, 1.01])
    assert [b["matches"] for b in out] == [25]
