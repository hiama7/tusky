import numpy as np
import pandas as pd
import pytest

pytest.importorskip("optuna")

from tests.test_compare import _incumbent_fn, _synthetic_task  # noqa: E402
from tusky_ml import ablate, features2  # noqa: E402


def _extra_for(data, sport="football"):
    from tusky_ml.synthetic import league

    matches, _ = league("football", n_teams=14, seasons=3, seed=4, upcoming_rounds=0)
    feats = features2.build(matches, sport).set_index("match_id")
    return feats.loc[data.rows["match_id"].to_numpy(), features2.FEATURES].reset_index(drop=True)


def test_ablation_runs_and_reports_every_group_with_validation_driven_keeping(monkeypatch):
    task, data = _synthetic_task()
    res = ablate.ablate_task(task, data, _extra_for(data), features2.GROUPS, _incumbent_fn(task, data),
                             families=("logreg", "hgb"), trials=2, seed=0, log=lambda *_: None)
    assert set(res["groups"]) == set(features2.GROUPS) and set(res["families"]) == {"logreg", "hgb"}
    for g in res["groups"].values():
        lo, hi = g["test_gain"]["ci95"]
        assert lo <= g["test_gain"]["mean"] <= hi
        assert g["kept_by_validation"] == (g["validation_gain"] > 0)
    kept = [n for n, g in res["groups"].items() if g["kept_by_validation"]]
    assert res["kept_groups"]["groups"] == kept
    assert res["windows"][2] == len(data.y) - res["windows"][0] - res["windows"][1]


def test_test_labels_never_change_which_groups_are_kept():
    """Scramble the test window's labels: the validation-based keep/drop decisions must not move."""
    task, data = _synthetic_task()
    extra = _extra_for(data)
    a = ablate.ablate_task(task, data, extra, features2.GROUPS, _incumbent_fn(task, data), families=("logreg",), trials=2, log=lambda *_: None)
    from tusky_ml import compare

    shuffled = data.y.copy()
    te = compare.windows(task, data.dates)[2]
    shuffled[te] = np.random.default_rng(3).permutation(shuffled[te])
    b = ablate.ablate_task(task, compare.TaskData(data.X, shuffled, data.dates, data.rows), extra, features2.GROUPS,
                           _incumbent_fn(task, data), families=("logreg",), trials=2, log=lambda *_: None)
    assert a["kept_groups"]["groups"] == b["kept_groups"]["groups"]
    assert {n: g["validation_gain"] for n, g in a["groups"].items()} == {n: g["validation_gain"] for n, g in b["groups"].items()}
    assert a["families"]["logreg"]["test"]["new"]["log_loss"] != b["families"]["logreg"]["test"]["new"]["log_loss"]


# ---- calibrated comparison -------------------------------------------------------------------------------------


def _binary_task(n=1800, seed=0):
    from tusky_ml import compare

    rng = np.random.default_rng(seed)
    X = pd.DataFrame(rng.normal(size=(n, 3)), columns=["a", "b", "c"])
    club = rng.random(n) < 0.5
    p1 = 1 / (1 + np.exp(-(1.2 * X["a"] + 0.5 * X["b"]).to_numpy()))
    y = np.where(rng.random(n) < p1, 0, 1)  # 0 = team 1 wins
    dates = pd.Series(pd.date_range("2022-01-01", periods=n, freq="D", tz="UTC"))
    rows = pd.DataFrame({"is_club": club.astype(float), "is_female": np.zeros(n)})
    task = compare.Task("bin", "basketball", None, 2, str(dates.iloc[int(n * 0.5)].date()), str(dates.iloc[int(n * 0.75)].date()))
    return task, compare.TaskData(X, y, dates, rows)


def test_segment_temperature_shrinks_an_overconfident_segment_and_leaves_a_calibrated_one():
    rng = np.random.default_rng(1)
    n = 4000
    seg = np.where(np.arange(n) % 2 == 0, "club", "intl")
    true_p = rng.uniform(0.2, 0.8, n)
    y = np.where(rng.random(n) < true_p, 0, 1)
    z = np.log(true_p / (1 - true_p))
    claimed = 1 / (1 + np.exp(-np.where(seg == "club", 3 * z, z)))  # club claims 3x too much confidence
    P = np.column_stack([claimed, 1 - claimed])
    temps = ablate._segment_temperatures(P, y, seg)
    assert temps["club"] == pytest.approx(1 / 3, abs=0.1) and temps["intl"] == pytest.approx(1.0, abs=0.15)
    out = ablate._apply_segment_temperatures(P, seg, temps)
    assert np.allclose(out.sum(axis=1), 1.0)
    assert np.abs(out[seg == "club", 0] - 0.5).max() < np.abs(P[seg == "club", 0] - 0.5).max()
    # a segment with too few rows gets no temperature and is returned unchanged
    tiny = ablate._segment_temperatures(P[:20], y[:20], seg[:20])
    assert tiny == {} and np.array_equal(ablate._apply_segment_temperatures(P[:20], seg[:20], tiny), P[:20])


def test_calibrated_comparison_scores_every_candidate_with_the_same_calibration_and_never_reads_test_labels_for_it():
    from tusky_ml import compare

    task, data = _binary_task()
    tr, va, te = compare.windows(task, data.dates)

    def incumbent(rest):
        rng = np.random.default_rng(0)
        p = np.clip(1 / (1 + np.exp(-(1.2 * data.X["a"].to_numpy()[rest]))) + rng.normal(0, 0.02, len(rest)), 0.02, 0.98)
        return np.column_stack([p, 1 - p]), "stub"

    extra = pd.DataFrame({"b": data.X["b"].to_numpy()})
    X_old = data.X[["a", "c"]]
    a = ablate.calibrated_comparison(task, compare.TaskData(X_old, data.y, data.dates, data.rows), extra, ["b"], incumbent,
                                     families=("logreg",), trials=2, seed=0, log=lambda *_: None)
    assert set(a["candidates"]) == {"existing (stub)", "new logreg", "new ensemble"}
    assert set(a["vs_existing_calibrated"]) == {"new logreg", "new ensemble"}
    for c in a["candidates"].values():
        assert set(c["temperatures"]) <= {"club", "intl"} and c["calibrated_test"]["n"] == len(te)
    lo, hi = a["vs_existing_calibrated"]["new logreg"]["ci95"]
    assert lo <= a["vs_existing_calibrated"]["new logreg"]["mean"] <= hi
    # the extra feature really helps here, so the new model should come out ahead of the stub even after calibration
    assert a["vs_existing_calibrated"]["new logreg"]["mean"] > 0

    # temperatures come from validation only: scrambling the TEST labels must leave them unchanged
    shuffled = data.y.copy()
    shuffled[te] = np.random.default_rng(5).permutation(shuffled[te])
    b = ablate.calibrated_comparison(task, compare.TaskData(X_old, shuffled, data.dates, data.rows), extra, ["b"], incumbent,
                                     families=("logreg",), trials=2, seed=0, log=lambda *_: None)
    for k in a["candidates"]:
        assert a["candidates"][k]["temperatures"] == b["candidates"][k]["temperatures"]
