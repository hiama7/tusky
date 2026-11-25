import math

import numpy as np
import pandas as pd
import pytest

from tests.test_cricket_model import synth
from tusky_ml import audit
from tusky_ml.cricket import features as cfeat
from tusky_ml.cricket import features2 as cf2
from tusky_ml.cricket import model as cmodel
from tusky_ml.cricket.data import CricketData

T0 = pd.Timestamp("2024-01-01", tz="UTC")


@pytest.mark.parametrize(
    "name, stage, expected",
    [
        ("Indian Premier League", "Final", (1.0, 0.0, 0.0)),
        ("ICC Men's T20 World Cup", None, (0.0, 1.0, 0.0)),
        ("Asia Cup", "Semi Final", (1.0, 1.0, 0.0)),
        ("Cambodia tour of Indonesia", None, (0.0, 0.0, 1.0)),
        ("Big Bash League", "Qualifier 1", (1.0, 0.0, 0.0)),
        (None, None, (0.0, 0.0, 0.0)),
        (float("nan"), float("nan"), (0.0, 0.0, 0.0)),
    ],
)
def test_importance_flags(name, stage, expected):
    assert cf2.importance_flags(name, stage) == expected


def _tiny():
    """Team 1 beats team 2 twice at venue 7; then a third match whose features we inspect."""
    m = pd.DataFrame({
        "match_id": [1, 2, 3], "start_time": [T0, T0 + pd.Timedelta(days=5), T0 + pd.Timedelta(days=10)], "format": "T20",
        "status": "completed", "team1": 1, "team2": 2, "gender": "m", "team_type": "club", "venue_id": 7, "city": "X",
        "toss_winner": 1, "toss_decision": "bat", "winner": [1, 1, 1], "result_type": "normal",
    })
    inn = pd.DataFrame([(1, 1, 1, 2, 150, 6, 120, None, None, 50, 70, 30), (1, 2, 2, 1, 140, 8, 120, 151, 20, 40, 70, 30),
                        (2, 1, 1, 2, 170, 5, 120, None, None, 50, 70, 50), (2, 2, 2, 1, 160, 9, 120, 171, 20, 40, 70, 50)],
                       columns=["match_id", "innings_no", "bat_team", "bowl_team", "runs", "wickets", "legal_balls", "target_runs", "target_overs", "pp_runs", "mid_runs", "death_runs"])
    bat = pd.DataFrame([(1, 101, 50, 30, True), (1, 201, 10, 10, True)], columns=["match_id", "player_id", "runs", "balls", "out"])
    bowl = pd.DataFrame([(1, 301, 24, 30, 2)], columns=["match_id", "player_id", "balls", "runs", "wickets"])
    lineups = pd.DataFrame([(i, 1, 101) for i in (1, 2, 3)] + [(i, 2, 201) for i in (1, 2, 3)] + [(3, 1, 301)], columns=["match_id", "team_id", "player_id"])
    return CricketData(matches=m, innings=inn, batting=bat, bowling=bowl, lineups=lineups)


def test_exact_values_on_a_hand_built_history():
    out = cf2.build(_tiny()).set_index("match_id")
    r = out.loc[3]
    assert r["form15_diff"] == pytest.approx((2 + 1) / (2 + 2) - (0 + 1) / (2 + 2))           # 0.5
    assert r["winpct_all_diff"] == pytest.approx((2 + 5) / (2 + 10) - (0 + 5) / (2 + 10))     # 1/6
    assert r["venue_win_diff"] == pytest.approx((2 + 2) / (2 + 4) - (0 + 2) / (2 + 4))        # 1/3
    assert r["venue_games_min"] == pytest.approx(math.log1p(2))
    assert r["runs_consistency_diff"] == 0.0  # fewer than 4 matches each: both sit on the prior, nothing made up
    sr_p = cfeat.FORMATS["T20"].rr_prior / 6.0
    assert r["xi_recent_bat_avg_diff"] == pytest.approx(((50 + 2 * 25) / 3 - (10 + 2 * 25) / 3) / 10.0)
    assert r["xi_recent_bat_sr_diff"] == pytest.approx(((50 + 30 * sr_p) / 60 - (10 + 30 * sr_p) / 40) * 100.0)
    # the first match has no history at all
    first = out.loc[1]
    assert first["form15_diff"] == 0.0 and first["venue_win_diff"] == 0.0 and first["xi_recent_bat_avg_diff"] == 0.0


def test_features_are_antisymmetric_under_a_team_swap_and_registered_for_the_orientation_augmentation():
    assert cf2.ANTISYMMETRIC2 <= cfeat.ANTISYMMETRIC
    f = cf2.build(_tiny()).set_index("match_id").loc[[3]]
    swapped = cmodel.swap(f[cf2.FEATURES])
    built = cf2.ANTISYMMETRIC2 & set(cf2.FEATURES)  # the interaction columns are added later, from the core Elo (tested below)
    for c in built:
        assert swapped[c].iloc[0] == pytest.approx(-f[c].iloc[0])
    for c in set(cf2.FEATURES) - cf2.ANTISYMMETRIC2:
        assert swapped[c].iloc[0] == f[c].iloc[0]


def test_output_is_complete_and_finite_on_a_larger_history():
    data = synth(n_matches=500, seed=1, upcoming=3)
    out = cf2.build(data)
    assert list(out.columns) == ["match_id", *cf2.FEATURES] and len(out) == len(data.matches)
    assert np.isfinite(out.drop(columns="match_id").to_numpy()).all()


def test_cricket_features2_pass_the_causal_leakage_probe():
    res = audit.cricket_causal_probe(synth(n_matches=700, seed=2, upcoming=0), n=4, builder=cf2.build, columns=cf2.FEATURES, min_index=300)
    assert res["passed"] and res["features_compared"] == len(cf2.FEATURES)


def test_the_cricket_probe_catches_a_planted_leak_in_these_features():
    def leaky(data):
        out = cf2.build(data)
        known = data.matches.set_index("match_id")["winner"]
        # a "form" that peeks at the match's own winner (NaN while hidden)
        out["form15_diff"] = out["form15_diff"] + out["match_id"].map(known).fillna(0).to_numpy() * 0.01
        return out

    res = audit.cricket_causal_probe(synth(n_matches=700, seed=2, upcoming=0), n=4, builder=leaky, columns=cf2.FEATURES, min_index=300)
    assert not res["passed"] and res["failures"][0]["feature"] == "form15_diff"


def test_interaction_features_are_antisymmetric_and_let_a_linear_model_use_tournament_context():
    extra = pd.DataFrame({"is_knockout": [1.0, 0.0], "is_major_event": [0.0, 1.0], "is_bilateral": [0.0, 0.0]})
    out = cf2.add_interactions(extra, [2.0, -1.5])
    assert out["knockout_x_elo"].tolist() == [2.0, 0.0] and out["major_x_elo"].tolist() == [0.0, -1.5]
    assert set(cf2.INTERACTIONS) <= cf2.ANTISYMMETRIC2 and set(cf2.INTERACTIONS) <= cfeat.ANTISYMMETRIC
    # a symmetric flag alone cannot be used by an orientation-augmented linear model: its weight is exactly zero
    from sklearn.linear_model import LogisticRegression

    rng = np.random.default_rng(0)
    n = 4000
    elo = rng.normal(size=n)
    flag = (rng.random(n) < 0.4).astype(float)
    y = (rng.random(n) < 1 / (1 + np.exp(-(1 + 2 * flag) * elo))).astype(int)  # the favourite wins more reliably when flagged
    base = pd.DataFrame({"elo": elo, "flag": flag})
    aug_x = pd.concat([base.assign(elo=-base["elo"]), base], ignore_index=True)  # both orientations, flag unchanged
    aug_y = np.concatenate([1 - y, y])
    coef_flag = LogisticRegression(max_iter=1000).fit(aug_x, aug_y).coef_[0][1]
    assert abs(coef_flag) < 0.05  # the symmetric flag is useless to a linear model ...
    aug_x["flag_x_elo"] = aug_x["flag"] * aug_x["elo"]
    m = LogisticRegression(max_iter=1000).fit(aug_x, aug_y)
    assert m.coef_[0][2] > 1.0  # ... but its interaction with strength is learned
