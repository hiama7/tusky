"""Retrain-and-promote: a retrained model replaces the production one only when it earns it.

A scheduled retrain is not trusted blindly. Each cycle:

1. Takes the matches played since the production model's training data ended ("new matches").
   Too few of them -> nothing to learn from, nothing is done.
2. Splits them in time: the older part is extra training data for a CHALLENGER, the newer part
   (the evaluation window, `eval_frac` of the new matches) is held out from the challenger.
3. Fits the challenger on everything BEFORE the evaluation window, with the same pipeline that
   normally trains the model (candidate search, tuned settings). The production model (the
   "champion") is used exactly as deployed.
4. Scores both on the evaluation window, match by match, and promotes the challenger only if
   - its log-loss is better with the paired bootstrap 95% interval entirely above zero, AND
   - its calibration error (ECE) is not worse than the champion's by more than the ECE noise floor.
   Ties keep the champion: a model is never swapped for noise.
5. If promoted, the same pipeline is refitted on ALL data and registered as a new version; the
   old one stays in the registry and `rollback` restores it. Every cycle's decision (including
   rejections and skips) is written to the registry history with its numbers.

The evaluation window is never seen by the challenger, and nothing after it is used anywhere,
so the comparison uses only information available when those matches were predicted.
The cycle also reports DRIFT: whether the champion's loss on the window is worse than its own
recorded validation loss by more than twice the standard error.
"""

from __future__ import annotations

import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd

from . import compare
from .registry import MODEL, REPORT, Registry


@dataclass(frozen=True)
class Rules:
    min_eval: int = 150      # matches needed in the evaluation window
    eval_frac: float = 0.5   # share of the new matches (the newest) held out for evaluation
    require_calibration: bool = True


@dataclass
class Subject:
    """Everything sport-specific, so the decision logic is tested without a database."""

    key: str
    k: int                                   # number of outcome classes (2 or 3)
    dates: pd.Series                         # kick-off time of every labelled row
    y: np.ndarray                            # outcome index of every labelled row
    champion_through: pd.Timestamp           # last kick-off the production model was trained on
    champion_probs: Callable[[np.ndarray], np.ndarray]
    train_before: Callable[[pd.Timestamp], object]
    challenger_probs: Callable[[object, np.ndarray], np.ndarray]
    train_all: Callable[[], object]
    save: Callable[[object, Path], None]     # writes model.joblib + report.json under <dir>/<key>/
    reference_loss: float | None = None      # the champion's own recorded validation log-loss


def decide(champ: np.ndarray, chall: np.ndarray, y: np.ndarray, rules: Rules, seed: int = 0) -> dict:
    """The promotion rule on one evaluation window (pure; probabilities are (n, k))."""
    loss_c, loss_n = compare.per_match_loss(champ, y), compare.per_match_loss(chall, y)
    gain = compare.paired_gain(loss_c, loss_n, seed)
    ev_c, ev_n = compare.evaluate(champ, y), compare.evaluate(chall, y)
    calibration_ok = ev_n["ece"] - ev_c["ece"] <= ev_n["ece_floor_p95"]
    better = gain["ci95"][0] > 0
    if better and (calibration_ok or not rules.require_calibration):
        verdict, reason = "promote", f"log-loss gain {gain['mean']:+.4f} (95% interval {gain['ci95'][0]:+.4f} to {gain['ci95'][1]:+.4f}), calibration within noise"
    elif better:
        verdict = "reject"
        reason = f"better log-loss ({gain['mean']:+.4f}) but ECE {ev_n['ece']:.4f} vs {ev_c['ece']:.4f} exceeds the noise floor {ev_n['ece_floor_p95']:.4f}"
    else:
        verdict = "reject"
        reason = f"no significant improvement: gain {gain['mean']:+.4f} (95% interval {gain['ci95'][0]:+.4f} to {gain['ci95'][1]:+.4f}); champion kept"
    return {"verdict": verdict, "reason": reason, "paired_gain": gain, "calibration_ok": bool(calibration_ok),
            "champion": ev_c, "challenger": ev_n, "n_eval": int(len(y)), "champion_mean_loss": float(loss_c.mean())}


def drift(mean_loss: float, losses: np.ndarray, reference: float | None) -> dict:
    """Is the champion doing worse on fresh matches than its recorded validation loss said (by > 2 standard errors)?"""
    if reference is None or len(losses) < 2:
        return {"checked": False}
    se = float(np.std(losses, ddof=1) / np.sqrt(len(losses)))
    return {"checked": True, "reference": reference, "observed": round(mean_loss, 5), "standard_error": round(se, 5),
            "drifting": bool(mean_loss - reference > 2 * se)}


def run_cycle(subject: Subject, artifacts_dir: Path, rules: Rules = Rules(), dry_run: bool = False, log=print) -> dict:
    """One retrain-and-promote cycle for one model. Returns the decision record (also appended to the registry history)."""
    reg = Registry(artifacts_dir, subject.key)
    if reg.bootstrap() is None:
        return _initial(subject, reg, artifacts_dir, dry_run, log)

    dates = pd.to_datetime(subject.dates, utc=True).reset_index(drop=True)
    new_idx = np.where(dates > pd.Timestamp(subject.champion_through))[0]
    n_eval = int(len(new_idx) * rules.eval_frac)
    if n_eval < rules.min_eval:
        reason = f"{len(new_idx)} new matches since {pd.Timestamp(subject.champion_through).date()}; need {int(np.ceil(rules.min_eval / rules.eval_frac))} for an evaluation window of {rules.min_eval}"
        log(f"  {subject.key}: skipped, {reason}")
        if dry_run:
            return {"action": "skip", "reason": reason}
        last = (reg.state()["history"] or [{}])[-1]
        if last.get("action") == "skip" and str(last.get("at", ""))[:10] == pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%d"):
            return {"action": "skip", "reason": reason}  # the loop calls this often; one skip entry per day is enough
        return reg.record("skip", reg.state()["production"], reason, n_new=int(len(new_idx)))

    window = new_idx[-n_eval:]
    cutoff = dates.iloc[window[0]]
    y = subject.y[window]
    champ_p = subject.champion_probs(window)
    challenger = subject.train_before(cutoff)
    chall_p = subject.challenger_probs(challenger, window)
    d = decide(champ_p, chall_p, y, rules)
    d["drift"] = drift(d["champion_mean_loss"], compare.per_match_loss(champ_p, y), subject.reference_loss)
    d["window"] = {"from": cutoff.isoformat(), "to": dates.iloc[window[-1]].isoformat(), "n": int(len(window))}
    log(f"  {subject.key}: {d['verdict']}, {d['reason']}" + (" [DRIFT: champion is worse than its validation loss]" if d["drift"].get("drifting") else ""))

    summary = {k: d[k] for k in ("paired_gain", "calibration_ok", "champion", "challenger", "n_eval", "drift", "window")}
    if d["verdict"] != "promote" or dry_run:
        action = "reject" if d["verdict"] != "promote" else "dry-run-promote"
        return {"action": action, "reason": d["reason"], **summary} if dry_run else reg.record(action, None, d["reason"], **summary)

    final = subject.train_all()
    with tempfile.TemporaryDirectory() as tmp:
        subject.save(final, Path(tmp))
        version = reg.unique_version(getattr(final, "version"))
        reg.add_version(version, Path(tmp) / subject.key / MODEL, Path(tmp) / subject.key / REPORT)
    reg.set_production(version, d["reason"], **summary)
    log(f"  {subject.key}: promoted {version}")
    return {"action": "promote", "version": version, "reason": d["reason"], **summary}


def _initial(subject: Subject, reg: Registry, artifacts_dir: Path, dry_run: bool, log) -> dict:
    """No production model yet: train one on all data and make it the first version (nothing to compare against)."""
    if dry_run:
        return {"action": "dry-run-initial", "reason": "no production model yet"}
    model = subject.train_all()
    with tempfile.TemporaryDirectory() as tmp:
        subject.save(model, Path(tmp))
        version = reg.unique_version(getattr(model, "version"))
        reg.add_version(version, Path(tmp) / subject.key / MODEL, Path(tmp) / subject.key / REPORT)
    reg.set_production(version, "first model for this key (nothing to compare against)", action="initial")
    log(f"  {subject.key}: first model {version}")
    return {"action": "initial", "version": version}
