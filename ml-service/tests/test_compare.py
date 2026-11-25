"""Calibrators, the model zoo wrapper, the evaluation protocol, and proof that test labels cannot leak into selection."""

import numpy as np
import pandas as pd
import pytest

from tusky_ml import calibrate, compare, metrics, zoo
from tusky_ml.features import FOOTBALL, build_features, trainable
from tusky_ml.models import make_predictor
from tusky_ml.synthetic import league


# ---- calibration -----------------------------------------------------------------------------------


def _overconfident(n=3000, seed=0, k=2):
    rng = np.random.default_rng(seed)
    if k == 2:
        p = rng.uniform(0.1, 0.9, n)
        y = np.where(rng.random(n) < p, 0, 1)
        sharp = 1 / (1 + np.exp(-1.7 * np.log(p / (1 - p))))
        return np.column_stack([sharp, 1 - sharp]), y
    true = rng.dirichlet([3, 2, 3], n)
    y = np.array([rng.choice(3, p=r) for r in true])
    sharp = true ** 1.8
    return sharp / sharp.sum(axis=1, keepdims=True), y


@pytest.mark.parametrize("kind", ["platt", "isotonic"])
def test_calibrators_repair_overconfidence_on_unseen_data_binary(kind):
    P, y = _overconfident(6000)
    fit, test = slice(0, 3000), slice(3000, 6000)
    cal = calibrate.Calibrator(kind).fit(P[fit], y[fit])
    after = cal.apply(P[test])
    hit = (y[test] == 0).astype(float)
    assert np.allclose(after.sum(axis=1), 1.0)
    assert metrics.expected_calibration_error(after[:, 0], hit) < 0.5 * metrics.expected_calibration_error(P[test][:, 0], hit)


@pytest.mark.parametrize("kind", ["platt", "isotonic"])
def test_three_outcome_calibration_keeps_rows_summing_to_one_and_improves_log_loss(kind):
    P, y = _overconfident(6000, k=3)
    cal = calibrate.Calibrator(kind).fit(P[:3000], y[:3000])
    after = cal.apply(P[3000:])
    assert np.allclose(after.sum(axis=1), 1.0) and (after > 0).all()
    assert metrics.log_loss(after, y[3000:]) < metrics.log_loss(P[3000:], y[3000:])


def test_choose_uses_only_validation_data_and_rejects_calibrating_a_calibrated_model():
    P, y = _overconfident(2000)
    assert calibrate.choose(P, y)["chosen"] in ("platt", "isotonic")  # distorted: a fix is clearly better than none
    rng = np.random.default_rng(1)
    p = rng.uniform(0.15, 0.85, 4000)
    good = np.column_stack([p, 1 - p])
    yg = np.where(rng.random(4000) < p, 0, 1)
    pick = calibrate.choose(good, yg)
    assert pick["scores"]["none"] <= min(pick["scores"].values()) + 0.003  # no meaningful gain from touching it


# ---- protocol pieces -----------------------------------------------------------------------------------


def test_windows_are_chronological_disjoint_and_complete():
    dates = pd.Series(pd.date_range("2022-01-01", periods=1000, freq="D", tz="UTC"))
    task = compare.Task("t", "football", None, 3, "2023-01-01", "2024-01-01")
    tr, va, te = compare.windows(task, dates)
    assert len(set(tr) | set(va) | set(te)) == 1000 and not (set(tr) & set(va)) and not (set(va) & set(te))
    assert dates.iloc[tr].max() < pd.Timestamp("2023-01-01", tz="UTC") <= dates.iloc[va].min()
    assert dates.iloc[va].max() < pd.Timestamp("2024-01-01", tz="UTC") <= dates.iloc[te].min()


def test_evaluate_reports_every_metric_and_perfect_predictions_score_perfectly():
    y = np.array([0, 1, 0, 1, 0, 0])
    perfect = np.eye(2)[y]
    m = compare.evaluate(perfect, y)
    assert m["log_loss"] < 1e-6 and m["accuracy"] == m["precision"] == m["recall"] == m["f1"] == 1.0 and m["roc_auc"] == 1.0
    three = compare.evaluate(np.full((6, 3), 1 / 3), np.array([0, 1, 2, 0, 1, 2]))
    assert abs(three["log_loss"] - np.log(3)) < 1e-4 and "rps" in three


def test_paired_gain_is_zero_for_identical_models_and_positive_for_a_better_one():
    rng = np.random.default_rng(0)
    old = rng.uniform(0.3, 0.9, 500)
    same = compare.paired_gain(old, old.copy())
    assert same["mean"] == 0 and same["ci95"] == [0.0, 0.0]
    better = compare.paired_gain(old, old - 0.05)
    assert better["mean"] > 0.04 and better["ci95"][0] > 0


def test_symmetric_wrapper_gives_exactly_mirrored_probabilities():
    rng = np.random.default_rng(2)
    d = rng.normal(size=600)
    X = pd.DataFrame({"d": d, "s": rng.normal(size=600)})
    y = np.where(rng.random(600) < 1 / (1 + np.exp(-1.5 * d)), 0, 1)

    def swap(frame):
        out = frame.copy()
        out["d"] = -out["d"]
        return out

    model = zoo.Symmetric(lambda: zoo.Fitted("logreg", {"C": 1.0}, 2), swap, 2).fit(X, y)
    p, q = model.predict_proba(X), model.predict_proba(swap(X))
    np.testing.assert_allclose(p, q[:, ::-1], atol=1e-12)
    assert np.allclose(p.sum(axis=1), 1.0)


@pytest.mark.parametrize("name", zoo.MODELS)
def test_every_model_family_fits_and_returns_probabilities(name):
    if name in ("xgb", "lgbm", "cat"):
        pytest.importorskip({"xgb": "xgboost", "lgbm": "lightgbm", "cat": "catboost"}[name])
    import optuna

    rng = np.random.default_rng(0)
    X = pd.DataFrame(rng.normal(size=(400, 6)))
    y = np.where(X[0] + rng.normal(size=400) > 0, 0, 1)
    study = optuna.create_study(sampler=optuna.samplers.TPESampler(seed=0))
    study.optimize(lambda t: zoo.build(name, zoo.suggest(name, t, 2), 2) is not None and 0.0, n_trials=1)  # the space builds
    p = zoo.Fitted(name, {k: v for k, v in zoo.suggest(name, optuna.trial.FixedTrial(_default(name)), 2).items()}, 2).fit(X, y).predict_proba(X)
    assert p.shape == (400, 2) and np.allclose(p.sum(axis=1), 1.0) and (p >= 0).all()


def _default(name):
    return {
        "logreg": {"C": 1.0},
        "rf": {"n_estimators": 150, "max_depth": 5, "min_samples_leaf": 10, "max_features": "sqrt"},
        "hgb": {"learning_rate": 0.05, "max_iter": 100, "max_leaf_nodes": 8, "min_samples_leaf": 30, "l2_regularization": 1.0},
        "xgb": {"n_estimators": 100, "learning_rate": 0.1, "max_depth": 3, "subsample": 0.8, "colsample_bytree": 0.8, "reg_lambda": 1.0, "min_child_weight": 3},
        "lgbm": {"n_estimators": 100, "learning_rate": 0.1, "num_leaves": 8, "min_child_samples": 30, "subsample": 0.8, "colsample_bytree": 0.8, "reg_lambda": 1.0},
        "cat": {"iterations": 100, "depth": 4, "learning_rate": 0.1, "l2_leaf_reg": 3.0},
    }[name]


# ---- the full protocol, and proof that the test window cannot influence any choice ------------------------


def _synthetic_task():
    matches, _ = league("football", n_teams=14, seasons=3, seed=4, upcoming_rounds=0)
    rows = trainable(build_features(matches, FOOTBALL), FOOTBALL).reset_index(drop=True)
    from tusky_ml.compare import TaskData, match_matrix

    y = metrics.outcome_index(rows["home_score"].to_numpy(), rows["away_score"].to_numpy())
    data = TaskData(match_matrix(rows), y, rows["start_time"], rows)
    dates = pd.to_datetime(rows["start_time"], utc=True)
    train_end, val_end = dates.quantile(0.55).strftime("%Y-%m-%d"), dates.quantile(0.75).strftime("%Y-%m-%d")
    return compare.Task("synthetic", "football", None, 3, train_end, val_end), data


def _incumbent_fn(task, data):
    tr = compare.windows(task, data.dates)[0]

    def fn(rest):
        m = make_predictor("football", "glm").fit(data.rows.iloc[tr])
        return compare.pipeline_probs(m.predict(data.rows.iloc[rest])), "glm"

    return fn


def test_protocol_end_to_end_and_test_labels_never_influence_any_choice(monkeypatch):
    pytest.importorskip("optuna")
    monkeypatch.setattr(zoo, "MODELS", ("logreg", "rf", "hgb"))  # sklearn families: always available
    task, data = _synthetic_task()
    a = compare.evaluate_task(task, data, _incumbent_fn(task, data), trials=3, seed=0, log=lambda *_: None)
    assert sum(a["windows"][w][2] for w in ("train", "validation", "test")) == len(data.y)
    assert set(a["families"]) == {"logreg", "rf", "hgb"} and a["selected_new_model"] in {"logreg", "rf", "hgb", "ensemble", "blend"}
    for name in ("existing", "logreg", "rf", "hgb", "ensemble", "blend"):
        for variant in ("raw", "calibrated"):
            assert np.isfinite(a["test"][name][variant]["log_loss"])
    assert a["test"]["logreg"]["raw"]["log_loss"] < a["test"]["base_rates"]["log_loss"]  # there is real signal to find

    # Scramble the labels of the TEST window only. Every choice made before the test must be unchanged.
    _, _, te = compare.windows(task, data.dates)
    shuffled = data.y.copy()
    shuffled[te] = np.random.default_rng(9).permutation(shuffled[te])
    b = compare.evaluate_task(task, compare.TaskData(data.X, shuffled, data.dates, data.rows), _incumbent_fn(task, data), trials=3, seed=0, log=lambda *_: None)
    assert a["selected_new_model"] == b["selected_new_model"] and a["ensemble_members"] == b["ensemble_members"]
    assert a["families"] == b["families"] and a["calibration_choice"] == b["calibration_choice"]
    assert a["test"]["logreg"]["raw"]["log_loss"] != b["test"]["logreg"]["raw"]["log_loss"]  # only the score moves
