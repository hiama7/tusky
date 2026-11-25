from dataclasses import dataclass

import joblib
import numpy as np
import pandas as pd
import pytest

from tusky_ml import promote
from tusky_ml.registry import MODEL, REPORT, Registry

KEY = "toy"
N, THROUGH = 700, 300


@dataclass
class Fake:
    version: str
    quality: str  # "good" | "same" | "bad"


def _world(seed=0):
    rng = np.random.default_rng(seed)
    z = rng.normal(size=N)
    p_true = 1 / (1 + np.exp(-1.5 * z))
    y = np.where(rng.random(N) < p_true, 0, 1)  # 0 = side A wins
    dates = pd.Series(pd.date_range("2024-01-01", periods=N, freq="D", tz="UTC"))
    return z, p_true, y, dates


def _probs(p):
    p = np.clip(p, 0.02, 0.98)
    return np.column_stack([p, 1 - p])


def _write_production(artifacts, version="v0", payload="old"):
    d = artifacts / KEY
    d.mkdir(parents=True)
    joblib.dump(payload, d / MODEL)
    (d / REPORT).write_text('{"version": "%s"}' % version, encoding="utf-8")


def _subject(artifacts, challenger="good", log_calls=None, champion=True, seed=0):
    z, p_true, y, dates = _world(seed)
    champ_p = 1 / (1 + np.exp(-0.4 * z))  # a weak champion: too timid
    good_p = p_true                       # the challenger that knows the truth
    quality = {"good": good_p, "same": champ_p, "bad": 1 - champ_p}

    def train_before(cutoff):
        if log_calls is not None:
            log_calls.append(cutoff)
        return Fake("toy-new-1", challenger)

    def save(model, d):
        (d / KEY).mkdir(parents=True, exist_ok=True)
        joblib.dump("new", d / KEY / MODEL)
        (d / KEY / REPORT).write_text('{"version": "%s"}' % model.version, encoding="utf-8")

    return promote.Subject(
        KEY, 2, dates, y, dates.iloc[THROUGH] if champion else pd.NaT,
        (lambda w: _probs(champ_p[w])) if champion else None,
        train_before,
        lambda model, w: _probs(quality[model.quality][w]),
        lambda: Fake("toy-new-final", challenger),
        save,
        reference_loss=0.55,
    )


RULES = promote.Rules(min_eval=100, eval_frac=0.5)


def test_decide_promotes_a_clearly_better_model_and_keeps_the_champion_otherwise():
    z, p_true, y, _ = _world()
    champ = _probs(1 / (1 + np.exp(-0.4 * z)))
    assert promote.decide(champ, _probs(p_true), y, RULES)["verdict"] == "promote"
    same = promote.decide(champ, champ.copy(), y, RULES)
    assert same["verdict"] == "reject" and "no significant improvement" in same["reason"]  # ties keep the champion
    assert promote.decide(champ, _probs(1 - champ[:, 0]), y, RULES)["verdict"] == "reject"
    assert promote.decide(champ, _probs(p_true), y, RULES)["paired_gain"]["ci95"][0] > 0


def test_a_better_log_loss_is_not_promoted_when_calibration_is_worse_than_the_noise_floor(monkeypatch):
    z, p_true, y, _ = _world()
    champ, chall = _probs(1 / (1 + np.exp(-0.4 * z))), _probs(p_true)
    real = promote.compare.evaluate

    def rigged(P, yy):
        out = real(P, yy)
        if P is chall:
            out["ece"] = out["ece"] + 1.0
        return out

    monkeypatch.setattr(promote.compare, "evaluate", rigged)
    d = promote.decide(champ, chall, y, RULES)
    assert d["verdict"] == "reject" and "ECE" in d["reason"] and d["paired_gain"]["ci95"][0] > 0
    assert promote.decide(champ, chall, y, promote.Rules(require_calibration=False))["verdict"] == "promote"


def test_drift_flags_a_champion_worse_than_its_recorded_validation_loss():
    losses = np.full(400, 0.70) + np.random.default_rng(0).normal(0, 0.05, 400)
    assert promote.drift(float(losses.mean()), losses, 0.55)["drifting"] is True
    assert promote.drift(float(losses.mean()), losses, 0.70)["drifting"] is False
    assert promote.drift(0.7, losses, None) == {"checked": False}


def test_too_few_new_matches_means_nothing_happens_and_the_skip_is_recorded_once_per_day(tmp_path):
    _write_production(tmp_path)
    s = _subject(tmp_path)
    s.champion_through = s.dates.iloc[N - 50]  # only 49 new matches
    r1 = promote.run_cycle(s, tmp_path, RULES, log=lambda *_: None)
    r2 = promote.run_cycle(s, tmp_path, RULES, log=lambda *_: None)
    assert r1["action"] == "skip" and r2["action"] == "skip"
    hist = Registry(tmp_path, KEY).state()["history"]
    assert [h["action"] for h in hist] == ["bootstrap", "skip"]
    assert joblib.load(tmp_path / KEY / MODEL) == "old"


def test_promotion_registers_a_new_version_keeps_the_old_one_and_can_be_rolled_back(tmp_path):
    _write_production(tmp_path)
    before = (tmp_path / KEY / MODEL).read_bytes()
    calls = []
    s = _subject(tmp_path, "good", calls)
    res = promote.run_cycle(s, tmp_path, RULES, log=lambda *_: None)
    assert res["action"] == "promote"
    reg = Registry(tmp_path, KEY)
    st = reg.state()
    assert st["production"] == "toy-new-final" and st["lineage"] == ["v0", "toy-new-final"]
    assert set(reg.versions()) == {"v0", "toy-new-final"}
    assert joblib.load(tmp_path / KEY / MODEL) == "new"
    entry = st["history"][-1]
    assert entry["action"] == "promote" and entry["paired_gain"]["ci95"][0] > 0 and entry["n_eval"] == res["window"]["n"] == 199
    # the challenger was trained only on matches before the evaluation window, and the window is the NEWEST half of the new matches
    n_new = N - THROUGH - 1
    window_start = s.dates.iloc[N - int(n_new * 0.5)]
    assert calls == [window_start]
    assert res["window"]["to"] == s.dates.iloc[N - 1].isoformat()
    # roll back: the old production file comes back byte for byte
    assert reg.rollback() == "v0"
    assert (tmp_path / KEY / MODEL).read_bytes() == before
    assert Registry(tmp_path, KEY).state()["production"] == "v0"
    assert Registry(tmp_path, KEY).state()["history"][-1]["action"] == "rollback"


def test_a_challenger_that_is_not_better_is_rejected_and_production_is_untouched(tmp_path):
    _write_production(tmp_path)
    before = (tmp_path / KEY / MODEL).read_bytes()
    for quality in ("same", "bad"):
        res = promote.run_cycle(_subject(tmp_path, quality), tmp_path, RULES, log=lambda *_: None)
        assert res["action"] == "reject"
    assert (tmp_path / KEY / MODEL).read_bytes() == before
    reg = Registry(tmp_path, KEY)
    assert reg.state()["production"] == "v0" and reg.versions() == ["v0"]
    assert [h["action"] for h in reg.state()["history"]].count("reject") == 2


def test_dry_run_changes_nothing_but_still_reports_the_decision(tmp_path):
    _write_production(tmp_path)
    res = promote.run_cycle(_subject(tmp_path, "good"), tmp_path, RULES, dry_run=True, log=lambda *_: None)
    assert res["action"] == "dry-run-promote" and res["paired_gain"]["ci95"][0] > 0
    assert joblib.load(tmp_path / KEY / MODEL) == "old"
    assert Registry(tmp_path, KEY).versions() == ["v0"]  # only the bootstrap copy of what was already live


def test_with_no_production_model_the_first_one_is_trained_on_all_data_and_registered(tmp_path):
    res = promote.run_cycle(_subject(tmp_path, "good", champion=False), tmp_path, RULES, log=lambda *_: None)
    assert res["action"] == "initial"
    reg = Registry(tmp_path, KEY)
    assert reg.state()["production"] == "toy-new-final" and (tmp_path / KEY / MODEL).exists()


def test_versions_are_immutable_and_duplicate_names_get_a_suffix(tmp_path):
    _write_production(tmp_path)
    reg = Registry(tmp_path, KEY)
    reg.bootstrap()
    with pytest.raises(FileExistsError):
        reg.add_version("v0", tmp_path / KEY / MODEL, tmp_path / KEY / REPORT)
    assert reg.unique_version("v0") == "v0-2"
    with pytest.raises(RuntimeError):
        reg.rollback()  # only one version so far
    with pytest.raises(FileNotFoundError):
        reg.set_production("nope", "x")


def test_the_real_cricket_glue_runs_a_full_cycle_on_synthetic_matches_without_leaking_the_window(tmp_path):
    """Champion trained on the early matches; the cycle trains a challenger on data before the window and decides."""
    from tests.test_cricket_model import synth
    from tusky_ml import subjects
    from tusky_ml.cricket import features as cf
    from tusky_ml.cricket import model as cm
    from tusky_ml.cricket import pipeline as cp

    feats = cf.build_features(synth(n_matches=1100, seed=5, upcoming=0))
    early = feats[feats["start_time"] < feats["start_time"].sort_values().iloc[700]]
    cp.save(cm.train(early, "T20", min_matches=200), tmp_path)
    subject = subjects.cricket_subject(feats, tmp_path, "T20", 200)
    assert subject.key == "cricket/T20" and subject.champion_through < subject.dates.max()
    seen = []
    real = subject.train_before
    subject.train_before = lambda cutoff: (seen.append(cutoff), real(cutoff))[1]
    res = promote.run_cycle(subject, tmp_path, promote.Rules(min_eval=80, eval_frac=0.5), log=lambda *_: None)
    assert res["action"] in ("promote", "reject") and res["window"]["n"] >= 80
    assert seen and seen[0] == pd.Timestamp(res["window"]["from"])  # trained strictly before the evaluation window
    assert res["drift"]["checked"] and res["champion"]["n"] == res["challenger"]["n"] == res["window"]["n"]
    st = Registry(tmp_path, "cricket/T20").state()
    assert st["production"] is not None and st["history"][-1]["action"] == res["action"]


def test_the_real_football_glue_runs_a_full_cycle_on_a_synthetic_league(tmp_path):
    from tusky_ml import pipeline, subjects
    from tusky_ml.synthetic import league

    matches, _ = league("football", n_teams=14, seasons=4, seed=2, upcoming_rounds=0)
    cutoff = matches["start_time"].sort_values().iloc[int(len(matches) * 0.7)]
    pipeline.save(pipeline.train("football", matches[matches["start_time"] < cutoff], min_matches=100), tmp_path)
    subject = subjects.team_subject(None, tmp_path, "football", 100, matches=matches)
    seen = []
    real = subject.train_before
    subject.train_before = lambda c: (seen.append(c), real(c))[1]
    res = promote.run_cycle(subject, tmp_path, promote.Rules(min_eval=60, eval_frac=0.5), log=lambda *_: None)
    assert res["action"] in ("promote", "reject") and res["window"]["n"] >= 60
    assert seen[0] == pd.Timestamp(res["window"]["from"])
    assert res["champion"]["n"] == res["challenger"]["n"] and res["drift"]["checked"]
