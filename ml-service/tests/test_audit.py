"""The audit's own checks must work: they must pass clean pipelines AND catch planted leaks."""

import numpy as np
import pandas as pd

from tests.test_cricket_model import synth
from tusky_ml import audit, metrics, tune
from tusky_ml.cricket import features as cfeat
from tusky_ml.features import FOOTBALL, WIDE_FEATURES, build_features, normalize_matches
from tusky_ml.synthetic import league


def _matches(seed=3, teams=10, seasons=3):
    return league("football", n_teams=teams, seasons=seasons, seed=seed, upcoming_rounds=0)[0]


# ---- causal probe ------------------------------------------------------------------------------------


def test_causal_probe_passes_the_real_feature_builder():
    res = audit.causal_probe(lambda m: build_features(m, FOOTBALL), _matches(), WIDE_FEATURES, n=6, min_index=100)
    assert res["passed"] and res["max_abs_difference"] < 1e-9 and res["matches_probed"] == 6


def test_causal_probe_catches_a_feature_built_from_the_matchs_own_result():
    def leaky(m):
        f = build_features(m, FOOTBALL)
        # "form" that quietly includes the match's own outcome (NaN when the result is hidden)
        f["h_elo"] = f["h_elo"] + 50.0 * (f["home_score"] - f["away_score"]).fillna(0.0)
        return f

    res = audit.causal_probe(leaky, _matches(), WIDE_FEATURES, n=6, min_index=100)
    assert not res["passed"] and res["failures"] and res["failures"][0]["feature"] == "h_elo"


def test_causal_probe_catches_a_feature_that_peeks_at_future_matches():
    def peeking(m):
        f = build_features(m, FOOTBALL)
        # each team's mean goals over ALL matches in the data it was given (future included)
        goals = pd.concat([m.groupby("home_team_id")["home_score"].mean(), m.groupby("away_team_id")["away_score"].mean()])
        mean = goals.groupby(level=0).mean()
        f["h_att"] = f["home_team_id"].map(mean)
        return f

    res = audit.causal_probe(peeking, _matches(), WIDE_FEATURES, n=6, min_index=100)
    assert not res["passed"]


def test_cricket_causal_probe_passes_on_the_real_replay():
    res = audit.cricket_causal_probe(synth(n_matches=600, seed=2, upcoming=0), n=3)
    assert res["passed"], res["failures"]
    assert res["features_compared"] > 20


# ---- noise probe ---------------------------------------------------------------------------------------


def test_noise_probe_finds_no_skill_in_noise_while_the_real_data_has_skill():
    matches = _matches(seed=5, teams=12, seasons=3)
    noise = audit.noise_probe("football", matches, seed=1)
    assert abs(noise["skill_vs_base_pct"]) < 2.0  # nothing to learn from shuffled results

    from tusky_ml import pipeline
    from tusky_ml.features import trainable

    rows = trainable(build_features(matches, FOOTBALL), FOOTBALL)
    oof = pipeline.backtest("football", rows, "glm")
    va = rows.loc[oof.index]
    real = tune.score("football", pipeline._probs(oof), va)["rps"]
    base = tune.score("football", pipeline._baseline_oof(rows, oof), va)["rps"]
    assert (base - real) / base * 100 > 3.0  # the same pipeline does find skill in the real results


# ---- calibration metrics ---------------------------------------------------------------------------------


def test_ece_is_small_for_calibrated_probabilities_and_large_for_overconfident_ones():
    rng = np.random.default_rng(0)
    p = rng.uniform(0.1, 0.9, 4000)
    hit = (rng.random(4000) < p).astype(float)
    over = 1 / (1 + np.exp(-1.8 * np.log(p / (1 - p))))
    floor = metrics.ece_noise_floor(p)
    assert metrics.expected_calibration_error(p, hit) <= floor["p95"]
    assert metrics.expected_calibration_error(over, hit) > 3 * floor["p95"]


def test_ece_edge_cases_and_reliability_intervals():
    assert np.isnan(metrics.expected_calibration_error(np.array([]), np.array([])))
    rel = metrics.reliability_table(np.linspace(0.05, 0.95, 200), (np.linspace(0.05, 0.95, 200) > 0.5).astype(float))
    assert len(rel) == 10 and sum(r["n"] for r in rel) == 200
    assert all(0.0 <= r["lo"] <= r["observed"] <= r["hi"] <= 1.0 for r in rel)


def test_two_way_sum_brier_is_double_the_conventional_binary_brier():
    p = np.array([0.7, 0.2, 0.9, 0.4])
    hit = np.array([1.0, 0.0, 1.0, 1.0])
    two = np.column_stack([p, 1 - p])
    y = np.where(hit == 1, 0, 1)
    assert abs(metrics.brier(two, y) - 2 * metrics.brier_binary(p, hit)) < 1e-12


def test_overfit_gap_shows_a_flexible_model_fitting_training_data_better_than_new_data():
    matches = _matches(seed=7, teams=12, seasons=3)
    from tusky_ml.features import trainable

    rows = trainable(build_features(normalize_matches(matches), FOOTBALL), FOOTBALL)
    out = audit.overfit_gap("football", rows, ("glm", "hgb"))
    for kind in ("glm", "hgb"):
        assert out["by_model"][kind]["train"]["rps"] <= out["by_model"][kind]["test"]["rps"] + 0.02
    assert out["by_model"]["hgb"]["gap_rps"] >= out["by_model"]["glm"]["gap_rps"] - 0.005
