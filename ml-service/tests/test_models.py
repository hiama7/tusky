import numpy as np
import pandas as pd
import pytest

from tusky_ml import metrics, pipeline
from tusky_ml.models import outcome_probs, score_grid
from tusky_ml.synthetic import league


def test_score_grid_is_a_distribution():
    grid = score_grid(np.array([1.4, 0.3]), np.array([1.1, 2.5]), rho=-0.05, max_goals=10)
    np.testing.assert_allclose(grid.sum(axis=(1, 2)), 1.0)
    probs = outcome_probs(grid)
    np.testing.assert_allclose(probs.sum(axis=1), 1.0)
    assert probs[0, 0] > probs[0, 2]  # stronger home side
    assert probs[1, 2] > probs[1, 0]  # much stronger away side


def test_dixon_coles_negative_rho_adds_draws():
    lh, la = np.array([1.2]), np.array([1.0])
    base = outcome_probs(score_grid(lh, la, 0.0, 10))[0, 1]
    more_draws = outcome_probs(score_grid(lh, la, -0.1, 10))[0, 1]
    assert more_draws > base


def test_metrics_perfect_and_uniform():
    y = np.array([0, 1, 2])
    perfect = np.eye(3)
    uniform = np.full((3, 3), 1 / 3)
    assert metrics.rps(perfect, y) == 0
    assert metrics.brier(perfect, y) == 0
    assert metrics.log_loss(uniform, y) == pytest.approx(np.log(3))


@pytest.mark.parametrize("sport", ["football", "basketball"])
def test_train_beats_baseline_and_predicts_upcoming(sport):
    matches, _ = league(sport, n_teams=20, seasons=3, seed=11)
    model = pipeline.train(sport, matches, min_matches=200)
    r = model.report
    metric = r["selection_metric"]
    assert r["validation"][model.kind][metric] < r["baseline_validation"][metric]

    upcoming = matches.loc[matches.status == "scheduled", "match_id"].tolist()
    preds = pipeline.predict(model, matches, match_ids=upcoming)
    assert len(preds) == 10
    total = preds[["p_home", "p_draw", "p_away"]].sum(axis=1)
    np.testing.assert_allclose(total, 1.0, atol=1e-9)
    assert (preds["exp_home"] > 0).all() and (preds["exp_away"] > 0).all()
    if sport == "basketball":
        assert (preds["p_draw"] == 0).all()
        assert "spread" in preds.loc[0, "details"]
    else:
        assert len(preds.loc[0, "details"]["top_scores"]) == 5


def test_predict_window_selects_only_upcoming_scheduled():
    matches, _ = league("football", n_teams=10, seasons=2, seed=2)
    model = pipeline.train("football", matches, min_matches=100, kind="glm")
    first_upcoming = matches.loc[matches.status == "scheduled", "start_time"].min()
    preds = pipeline.predict(model, matches, days_ahead=3, now=first_upcoming - pd.Timedelta(days=1))
    assert len(preds) == 5
    none = pipeline.predict(model, matches, days_ahead=3, now=first_upcoming + pd.Timedelta(days=30))
    assert none.empty


def test_not_enough_data():
    matches, _ = league("football", n_teams=6, seasons=1, seed=0)
    with pytest.raises(pipeline.NotEnoughData):
        pipeline.train("football", matches, min_matches=10_000)


def test_save_and_load_roundtrip(tmp_path):
    matches, _ = league("basketball", n_teams=10, seasons=2, seed=4)
    model = pipeline.train("basketball", matches, min_matches=100)
    pipeline.save(model, tmp_path)
    loaded = pipeline.load(tmp_path, "basketball")
    assert loaded.version == model.version
    assert (tmp_path / "basketball" / "report.json").exists()
    assert pipeline.load(tmp_path, "football") is None
