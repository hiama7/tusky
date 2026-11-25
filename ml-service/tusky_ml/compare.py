"""Phases 2, 4 and 5: compare model families against the existing model on identical
chronological windows, with calibration and a single untouched test window.

Protocol (per task):
- TRAIN: matches before `train_end`. Every family is fitted here, and Optuna tunes its settings
  here by validation log-loss.
- VALIDATION: `train_end` to `val_end`. Used for tuning, for choosing a calibrator, and for
  deciding whether an ensemble is worth adopting. Nothing else.
- TEST: from `val_end` on. Scored once. Calibrators are fitted on validation predictions of the
  train-only model and applied unchanged to the test predictions of that same model.
Features come from the causal replay (each match only sees earlier results), so the split can
be by date without leakage.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import precision_recall_fscore_support, roc_auc_score

from . import calibrate, db, metrics, tune, zoo
from .cricket import data as cdata
from .cricket import features as cfeat
from .cricket import model as cmodel
from .features import CONFIGS, WIDE_FEATURES, build_features, trainable
from .models import make_predictor


@dataclass(frozen=True)
class Task:
    name: str
    sport: str
    fmt: str | None
    k: int
    train_end: str
    val_end: str
    symmetric: bool = False


TASKS = {
    "football": Task("football", "football", None, 3, "2024-07-01", "2025-07-01"),
    "basketball": Task("basketball", "basketball", None, 2, "2024-01-01", "2024-07-01"),
    "cricket-T20": Task("cricket-T20", "cricket", "T20", 2, "2023-01-01", "2025-01-01", True),
    "cricket-ODI": Task("cricket-ODI", "cricket", "ODI", 2, "2021-01-01", "2024-01-01", True),
    "cricket-Test": Task("cricket-Test", "cricket", "Test", 3, "2019-01-01", "2022-01-01", True),
}


@dataclass
class TaskData:
    X: pd.DataFrame
    y: np.ndarray
    dates: pd.Series
    rows: pd.DataFrame  # the feature rows the existing model needs


def match_matrix(rows: pd.DataFrame) -> pd.DataFrame:
    """Match-level feature matrix for the classifiers: every replay feature plus a few differences."""
    X = rows[WIDE_FEATURES].astype("float64").copy()
    X["elo_diff"] = X["h_elo"] - X["a_elo"]
    X["rate_diff"] = X["h_rate"] - X["a_rate"]
    X["att_def_home"] = X["h_att"] - X["a_def"]
    X["att_def_away"] = X["a_att"] - X["h_def"]
    return X.reset_index(drop=True)


def load_task(conn, artifacts_dir: Path, task: Task) -> TaskData:
    if task.sport in ("football", "basketball"):
        matches = db.load_matches(conn, task.sport)
        if task.sport == "football":
            tune.apply_saved(artifacts_dir, "football")
        cfg = CONFIGS[task.sport]
        rows = trainable(build_features(matches, cfg), cfg).reset_index(drop=True)
        y = metrics.outcome_index(rows["home_score"].to_numpy(), rows["away_score"].to_numpy())
        if task.k == 2:
            y = np.where(y == 0, 0, 1)
        return TaskData(match_matrix(rows), y, rows["start_time"], rows)
    data = cdata.load(conn, formats=(task.fmt,))
    rows = cmodel.win_rows(cfeat.build_features(data), task.fmt).reset_index(drop=True)
    y = cmodel._labels_idx(rows) if task.k == 3 else np.where(rows["label"].to_numpy() == 1.0, 0, 1)
    return TaskData(cmodel.stage_matrix(rows, "post").reset_index(drop=True), y, rows["start_time"], rows)


def windows(task: Task, dates: pd.Series) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    a, b = pd.Timestamp(task.train_end, tz="UTC"), pd.Timestamp(task.val_end, tz="UTC")
    d = pd.to_datetime(dates, utc=True)
    return np.where(d < a)[0], np.where((d >= a) & (d < b))[0], np.where(d >= b)[0]


# ---- evaluation ---------------------------------------------------------------------------------------------


def evaluate(P: np.ndarray, y: np.ndarray) -> dict:
    k = P.shape[1]
    P = np.clip(P, 1e-9, 1.0)
    P = P / P.sum(axis=1, keepdims=True)
    out: dict = {"n": int(len(y)), "log_loss": round(metrics.log_loss(P, y), 5), "brier": round(metrics.brier(P, y), 5),
                 "accuracy": round(metrics.accuracy(P, y), 4)}
    pred = P.argmax(axis=1)
    if k == 2:
        out["brier_binary"] = round(metrics.brier_binary(P[:, 0], (y == 0).astype(float)), 5)
        pr, rc, f1, _ = precision_recall_fscore_support(y == 0, pred == 0, average="binary", zero_division=0)
        out["roc_auc"] = round(float(roc_auc_score(y == 0, P[:, 0])), 4) if len(set(y)) > 1 else None
        out["ece"] = round(metrics.expected_calibration_error(P[:, 0], (y == 0).astype(float)), 5)
        floor = metrics.ece_noise_floor(P[:, 0], sims=100)
    else:
        pr, rc, f1, _ = precision_recall_fscore_support(y, pred, average="macro", labels=list(range(k)), zero_division=0)
        out["rps"] = round(metrics.rps(P, y), 5)
        try:
            out["roc_auc"] = round(float(roc_auc_score(y, P, multi_class="ovr", average="macro")), 4)
        except ValueError:
            out["roc_auc"] = None
        out["ece"] = round(metrics.classwise_ece(P, y), 5)
        floor = metrics.ece_noise_floor(P[:, 0], sims=100)
    out.update(precision=round(float(pr), 4), recall=round(float(rc), 4), f1=round(float(f1), 4), ece_floor_p95=floor["p95"])
    return out


def per_match_loss(P: np.ndarray, y: np.ndarray) -> np.ndarray:
    P = np.clip(P, 1e-9, 1.0)
    P = P / P.sum(axis=1, keepdims=True)
    return -np.log(P[np.arange(len(y)), y])


def paired_gain(loss_old: np.ndarray, loss_new: np.ndarray, seed: int = 0, n: int = 2000) -> dict:
    """Mean log-loss improvement of `new` over `old` with a bootstrap 95% interval (positive = better)."""
    d = loss_old - loss_new
    rng = np.random.default_rng(seed)
    boots = [d[rng.integers(0, len(d), len(d))].mean() for _ in range(n)]
    return {"mean": round(float(d.mean()), 5), "ci95": [round(float(np.percentile(boots, 2.5)), 5), round(float(np.percentile(boots, 97.5)), 5)]}


# ---- model fitting ----------------------------------------------------------------------------------------------


def _factory(task: Task, name: str, params: dict):
    def make():
        return zoo.Fitted(name, params, task.k)

    if task.symmetric:
        return lambda: zoo.Symmetric(make, cmodel.swap, task.k)
    return make


def tune_family(task: Task, name: str, Xtr, ytr, Xva, yva, trials: int, seed: int) -> dict:
    import optuna

    optuna.logging.set_verbosity(optuna.logging.WARNING)

    def objective(trial) -> float:
        params = zoo.suggest(name, trial, task.k)
        model = _factory(task, name, params)().fit(Xtr, ytr)
        return metrics.log_loss(model.predict_proba(Xva), yva)

    study = optuna.create_study(direction="minimize", sampler=optuna.samplers.TPESampler(seed=seed))
    study.optimize(objective, n_trials=trials)
    return {"params": study.best_params, "val_log_loss": round(study.best_value, 5), "trials": trials}


def incumbent(task: Task, artifacts_dir: Path, data: TaskData, tr: np.ndarray, rest: np.ndarray) -> tuple[np.ndarray, str]:
    """The model in production before this work, refitted on the training window only."""
    rows = data.rows
    if task.sport == "cricket":
        kind = json.loads((artifacts_dir / "cricket" / task.fmt / "report.json").read_text(encoding="utf-8"))["post"]["selected"]
        m = cmodel.WinModel(task.fmt, "post", kind).fit(rows.iloc[tr])
        p = m.predict(rows.iloc[rest])
        return (p if task.k == 3 else p[:, [0, 2]] / p[:, [0, 2]].sum(axis=1, keepdims=True)), kind
    kind = json.loads((artifacts_dir / task.sport / "report.json").read_text(encoding="utf-8"))["kind"]
    m = make_predictor(task.sport, kind).fit(rows.iloc[tr])
    p = pipeline_probs(m.predict(rows.iloc[rest]))
    return (p if task.k == 3 else p[:, [0, 2]]), kind


def pipeline_probs(frame: pd.DataFrame) -> np.ndarray:
    return frame[["p_home", "p_draw", "p_away"]].to_numpy()


def reliability_figure(path: Path, title: str, curves: dict[str, tuple[np.ndarray, np.ndarray]]) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, (ax, hist) = plt.subplots(2, 1, figsize=(5.6, 6.6), gridspec_kw={"height_ratios": [3, 1]}, sharex=True)
    ax.plot([0, 1], [0, 1], color="#9aa0a6", lw=1, ls="--", label="perfectly calibrated")
    for label, (p, hit) in curves.items():
        rel = metrics.reliability_table(p, hit, bins=10)
        x = [r["predicted"] for r in rel]
        ax.errorbar(x, [r["observed"] for r in rel], yerr=[[r["observed"] - r["lo"] for r in rel], [r["hi"] - r["observed"] for r in rel]],
                    marker="o", ms=4, lw=1.4, capsize=2, label=f"{label} (ECE {metrics.expected_calibration_error(p, hit):.3f})")
    ax.set_ylabel("observed frequency")
    ax.set_title(title, fontsize=10)
    ax.legend(fontsize=8, loc="upper left")
    ax.grid(alpha=0.25)
    for label, (p, _) in curves.items():
        hist.hist(p, bins=20, range=(0, 1), alpha=0.45, label=label)
    hist.set_xlabel("predicted probability")
    hist.set_ylabel("matches")
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def run_task(conn, artifacts_dir: Path, task: Task, trials: int = 25, seed: int = 0, figures_dir: Path | None = None, log=print) -> dict:
    data = load_task(conn, artifacts_dir, task)
    tr = windows(task, data.dates)[0]
    return evaluate_task(task, data, lambda rest: incumbent(task, artifacts_dir, data, tr, rest), trials, seed, figures_dir, log)


def evaluate_task(task: Task, data: TaskData, incumbent_fn, trials: int = 25, seed: int = 0, figures_dir: Path | None = None, log=print) -> dict:
    """The protocol itself, on already-built data. `incumbent_fn(eval_indices)` returns the existing
    model's probabilities for those rows (fitted on the training window only) and its name."""
    tr, va, te = windows(task, data.dates)
    X, y = data.X, data.y
    res: dict = {"task": task.name, "k": task.k, "trials": trials, "seed": seed,
                 "windows": {"train": [str(data.dates.iloc[tr].min())[:10], task.train_end, len(tr)],
                             "validation": [task.train_end, task.val_end, len(va)], "test": [task.val_end, str(data.dates.iloc[te].max())[:10], len(te)]},
                 "features": int(X.shape[1])}
    log(f"[{task.name}] train {len(tr)} / validation {len(va)} / test {len(te)} matches, {X.shape[1]} features")
    Xtr, ytr, Xva, yva, Xte, yte = X.iloc[tr], y[tr], X.iloc[va], y[va], X.iloc[te], y[te]

    val_p: dict[str, np.ndarray] = {}
    test_p: dict[str, np.ndarray] = {}
    res["families"] = {}
    for name in zoo.MODELS:
        try:
            found = tune_family(task, name, Xtr, ytr, Xva, yva, trials, seed)
        except ImportError as e:
            log(f"  {name}: skipped ({e})")
            continue
        model = _factory(task, name, found["params"])().fit(Xtr, ytr)
        val_p[name], test_p[name] = model.predict_proba(Xva), model.predict_proba(Xte)
        res["families"][name] = found
        log(f"  {name}: validation log-loss {found['val_log_loss']:.4f}")

    both, inc_kind = incumbent_fn(np.concatenate([va, te]))
    val_p["existing"], test_p["existing"] = both[: len(va)], both[len(va):]
    res["existing_model"] = inc_kind

    # Ensemble of the three best new families by validation log-loss (adopted only on validation evidence).
    ranked = sorted(res["families"], key=lambda n: res["families"][n]["val_log_loss"])
    top = ranked[:3]
    val_p["ensemble"] = np.mean([val_p[n] for n in top], axis=0)
    test_p["ensemble"] = np.mean([test_p[n] for n in top], axis=0)
    res["ensemble_members"] = top
    # A blend of the existing model with that ensemble: a fair test of whether combining the old and
    # new approaches beats either alone. Equal weights, nothing fitted, so nothing can be overfitted.
    val_p["blend"] = (val_p["existing"] + val_p["ensemble"]) / 2
    test_p["blend"] = (test_p["existing"] + test_p["ensemble"]) / 2

    # Calibration chosen on validation only.
    cal: dict[str, dict] = {}
    for name in val_p:
        pick = calibrate.choose(val_p[name], yva)
        fitted = calibrate.Calibrator(pick["chosen"]).fit(val_p[name], yva)
        cal[name] = {**pick, "test_probs": fitted.apply(test_p[name])}
    res["calibration_choice"] = {n: {"chosen": c["chosen"], "validation_cv_log_loss": c["scores"]} for n, c in cal.items()}

    # The new model: best validation (cross-validated, calibrated) log-loss among the new families and the ensemble.
    new_names = list(res["families"]) + ["ensemble", "blend"]
    best_new = min(new_names, key=lambda n: cal[n]["scores"][cal[n]["chosen"]])
    best_single = min(res["families"], key=lambda n: cal[n]["scores"][cal[n]["chosen"]])
    res["selected_new_model"] = best_new
    res["ensemble_adopted"] = best_new in ("ensemble", "blend")

    # Test (scored once).
    base_p = np.tile(np.bincount(ytr, minlength=task.k) / len(ytr), (len(te), 1))
    res["test"] = {"base_rates": evaluate(base_p, yte)}
    for name in val_p:
        res["test"][name] = {"raw": evaluate(test_p[name], yte), "calibrated": evaluate(cal[name]["test_probs"], yte), "calibrator": cal[name]["chosen"]}
    inc = cal["existing"]["test_probs"]
    new = cal[best_new]["test_probs"]
    res["comparison"] = {
        "new_model": best_new, "existing_model": f"existing ({inc_kind})",
        "log_loss_existing": res["test"]["existing"]["calibrated"]["log_loss"], "log_loss_new": res["test"][best_new]["calibrated"]["log_loss"],
        "improvement_pct_vs_existing": round(100 * (res["test"]["existing"]["calibrated"]["log_loss"] - res["test"][best_new]["calibrated"]["log_loss"])
                                             / res["test"]["existing"]["calibrated"]["log_loss"], 3),
        "paired_log_loss_gain_vs_existing": paired_gain(per_match_loss(inc, yte), per_match_loss(new, yte), seed),
        "paired_log_loss_gain_raw_best_single_vs_existing_raw": paired_gain(per_match_loss(test_p["existing"], yte), per_match_loss(test_p[best_single], yte), seed),
        "best_single_family": best_single,
    }
    if figures_dir is not None:
        hit = (yte == 0).astype(float)
        reliability_figure(figures_dir / f"{task.name}-reliability.png", f"{task.name}: test window ({len(te)} matches), first team's win probability",
                           {f"existing ({inc_kind}), raw": (test_p["existing"][:, 0], hit),
                            f"{best_new}, {cal[best_new]['chosen']} calibrated": (cal[best_new]["test_probs"][:, 0], hit)})
    return res
