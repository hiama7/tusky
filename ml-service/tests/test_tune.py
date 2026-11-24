import json

import numpy as np
import pandas as pd
import pytest

from tusky_ml import pipeline, tune
from tusky_ml.features import CONFIGS
from tusky_ml.synthetic import league


def test_sample_stays_in_the_search_space():
    rng = np.random.default_rng(0)
    space = tune.SPACE["football"]
    for _ in range(200):
        p = tune.sample(space, rng)
        assert set(p) == set(space)
        for k, spec in space.items():
            if spec[0] in ("log", "float"):
                assert spec[1] <= p[k] <= spec[2]
            else:
                assert p[k] in spec[1]


def test_use_config_swaps_and_restores():
    base = CONFIGS["football"]
    from dataclasses import replace

    with tune.use_config("football", replace(base, elo_k=99.0)):
        assert CONFIGS["football"].elo_k == 99.0
    assert CONFIGS["football"] is base
    with pytest.raises(RuntimeError):
        with tune.use_config("football", replace(base, elo_k=77.0)):
            raise RuntimeError("boom")
    assert CONFIGS["football"] is base  # restored even on errors


def test_model_remembers_the_settings_it_was_trained_with():
    from dataclasses import replace

    matches, _ = league("football", n_teams=10, seasons=2, seed=2)
    custom = replace(CONFIGS["football"], elo_k=33.0, ensemble_weight=0.8)
    with tune.use_config("football", custom):
        model = pipeline.train("football", matches, min_matches=100, kind="ensemble")
    assert model.cfg.elo_k == 33.0 and model.predictor.weight == 0.8
    # Predicting outside the context (default settings active) still uses the trained-with settings.
    ids = matches.loc[matches.status == "scheduled", "match_id"].tolist()
    inside = pipeline.predict(model, matches, match_ids=ids)
    assert CONFIGS["football"].elo_k != 33.0
    np.testing.assert_allclose(inside["p_home"] + inside["p_draw"] + inside["p_away"], 1.0)


def test_linear_mix_of_probabilities_equals_the_mixed_scoreline_grid():
    """The ensemble weight search mixes outcome probabilities; that must equal mixing grids."""
    from tusky_ml.models import outcome_probs, score_grid

    lh, la = np.array([1.4, 0.6]), np.array([1.1, 1.9])
    g1, g2 = score_grid(lh, la, -0.05, 10), score_grid(lh * 1.2, la * 0.9, 0.02, 10)
    w = 0.3
    np.testing.assert_allclose(outcome_probs(w * g1 + (1 - w) * g2), w * outcome_probs(g1) + (1 - w) * outcome_probs(g2))


def test_run_end_to_end_on_a_synthetic_league_and_save_roundtrip(tmp_path):
    matches, _ = league("football", n_teams=12, seasons=3, seed=5, upcoming_rounds=0)
    cut = matches["start_time"].sort_values().iloc[int(len(matches) * 0.66)].strftime("%Y-%m-%d")
    res = tune.run("football", matches, cut, trials=3, seed=1, log=lambda *_: None)
    ho = res["holdout"]
    assert ho["n_holdout"] > 100 and ho["n_pre"] > 200
    for k in ("base_rates", "default", "tuned", "default_frozen", "tuned_frozen"):
        assert np.isfinite(ho["scores"][k]["rps"])
    # The search only ever saw matches before the cutoff; the holdout starts at or after it.
    assert pd.Timestamp(ho["holdout_from"]) >= pd.Timestamp(cut, tz="UTC")
    lo, hi = ho["paired_gain"]["tuned_vs_default"]["ci95"]
    assert lo <= ho["paired_gain"]["tuned_vs_default"]["mean_rps_gain"] <= hi
    assert 0.0 <= res["ensemble_weight"]["best_weight"] <= 1.0

    path = tune.save_config(tmp_path, "football", res["tuned_config"], {"seed": 1})
    saved = json.loads(path.read_text())["params"]
    assert saved["ensemble_weight"] == res["tuned_config"].ensemble_weight
    base = CONFIGS["football"]
    try:
        assert tune.apply_saved(tmp_path, "football") == saved
        assert CONFIGS["football"].elo_k == saved["elo_k"]
    finally:
        CONFIGS["football"] = base
    assert tune.apply_saved(tmp_path / "nowhere", "football") == {}
