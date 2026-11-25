"""Phase 3 ablation: what do new features add, measured on the untouched test window.

For each model family the same Optuna search is run on the old features and on old + new
features (identical chronological windows, validation-only tuning), and the test log-loss is
compared per match with a paired bootstrap. Each feature GROUP is then added to the old
features on its own (logistic regression with the old features' tuned settings), so you can see
which group helps and which only adds noise.

Which groups to keep is decided on VALIDATION gains only (a group is kept if it lowers
validation log-loss); the test window then judges that choice once.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from . import compare, db, features2, metrics


def _ll(P: np.ndarray, y: np.ndarray) -> float:
    return round(float(compare.per_match_loss(P, y).mean()), 5)


def ablate_task(task: compare.Task, data: compare.TaskData, extra: pd.DataFrame, groups: dict[str, list[str]],
                incumbent_fn, families=("logreg", "lgbm", "cat"), trials: int = 15, seed: int = 0, log=print) -> dict:
    """`extra` has one row per row of `data.X` (same order) with every column named in `groups`."""
    tr, va, te = compare.windows(task, data.dates)
    y = data.y
    all_cols = [c for cols in groups.values() for c in cols]
    X_old = data.X.reset_index(drop=True)
    extra = extra.reset_index(drop=True)
    X_new = pd.concat([X_old, extra[all_cols]], axis=1)
    res: dict = {"task": task.name, "windows": [len(tr), len(va), len(te)], "old_features": int(X_old.shape[1]),
                 "new_features": int(len(all_cols)), "trials": trials, "families": {}, "groups": {}}
    log(f"[{task.name}] {X_old.shape[1]} existing + {len(all_cols)} new features; train {len(tr)} / validation {len(va)} / test {len(te)}")

    def fit(X, name, params=None):
        if params is None:
            params = compare.tune_family(task, name, X.iloc[tr], y[tr], X.iloc[va], y[va], trials, seed)["params"]
        model = compare._factory(task, name, params)().fit(X.iloc[tr], y[tr])
        return params, model.predict_proba(X.iloc[va]), model.predict_proba(X.iloc[te])

    old_probs: dict[str, tuple] = {}
    new_probs: dict[str, tuple] = {}
    for name in families:
        p_old, va_old, te_old = fit(X_old, name)
        p_new, va_new, te_new = fit(X_new, name)
        old_probs[name], new_probs[name] = (p_old, va_old, te_old), (p_new, va_new, te_new)
        res["families"][name] = {
            "validation_log_loss": {"old": _ll(va_old, y[va]), "new": _ll(va_new, y[va])},
            "test": {"old": compare.evaluate(te_old, y[te]), "new": compare.evaluate(te_new, y[te])},
            "paired_test_gain": compare.paired_gain(compare.per_match_loss(te_old, y[te]), compare.per_match_loss(te_new, y[te]), seed),
        }
        g = res["families"][name]["paired_test_gain"]
        log(f"  {name}: validation {res['families'][name]['validation_log_loss']['old']:.4f} -> {res['families'][name]['validation_log_loss']['new']:.4f}; "
            f"test {res['families'][name]['test']['old']['log_loss']:.4f} -> {res['families'][name]['test']['new']['log_loss']:.4f} (paired gain {g['mean']:+.4f}, {g['ci95'][0]:+.4f} to {g['ci95'][1]:+.4f})")
    ens_old = np.mean([old_probs[n][2] for n in families], axis=0)
    ens_new = np.mean([new_probs[n][2] for n in families], axis=0)
    res["ensemble_of_families"] = {"old": compare.evaluate(ens_old, y[te]), "new": compare.evaluate(ens_new, y[te]),
                                   "paired_test_gain": compare.paired_gain(compare.per_match_loss(ens_old, y[te]), compare.per_match_loss(ens_new, y[te]), seed)}
    inc, inc_kind = incumbent_fn(np.concatenate([va, te]))
    res["existing_model"] = {"kind": inc_kind, "test": compare.evaluate(inc[len(va):], y[te])}
    res["new_ensemble_vs_existing"] = compare.paired_gain(compare.per_match_loss(inc[len(va):], y[te]), compare.per_match_loss(ens_new, y[te]), seed)

    # Feature groups, added one at a time to the old features with logistic regression (settings tuned on the old features).
    # Group effects are measured with the family that is best on VALIDATION with the old features, so a model
    # that can use interactions (trees) is used where it is the better one (cricket), never chosen by test.
    base_family = min(old_probs, key=lambda n: res["families"][n]["validation_log_loss"]["old"])
    res["group_model"] = base_family
    base_params = old_probs[base_family][0]
    _, va_base, te_base = fit(X_old, base_family, base_params)
    keep: list[str] = []
    for gname, cols in groups.items():
        _, va_g, te_g = fit(pd.concat([X_old, extra[cols]], axis=1), base_family, base_params)
        val_gain = round(_ll(va_base, y[va]) - _ll(va_g, y[va]), 5)
        res["groups"][gname] = {
            "features": cols, "validation_gain": val_gain,
            "test_gain": compare.paired_gain(compare.per_match_loss(te_base, y[te]), compare.per_match_loss(te_g, y[te]), seed),
            "kept_by_validation": val_gain > 0,
        }
        if val_gain > 0:
            keep.append(gname)
        tg = res["groups"][gname]["test_gain"]
        log(f"  group {gname:<12} validation gain {val_gain:+.4f}  test gain {tg['mean']:+.4f} ({tg['ci95'][0]:+.4f} to {tg['ci95'][1]:+.4f})  {'kept' if val_gain > 0 else 'dropped'}")

    kept_cols = [c for g in keep for c in groups[g]]
    if kept_cols:
        _, va_k, te_k = fit(pd.concat([X_old, extra[kept_cols]], axis=1), base_family, base_params)
        res["kept_groups"] = {"groups": keep, "validation_log_loss": _ll(va_k, y[va]), "test": compare.evaluate(te_k, y[te]),
                              "paired_test_gain_vs_old_logreg": compare.paired_gain(compare.per_match_loss(te_base, y[te]), compare.per_match_loss(te_k, y[te]), seed)}
    else:
        res["kept_groups"] = {"groups": [], "note": "no group lowered validation log-loss"}
    res["logreg_old_test"] = compare.evaluate(te_base, y[te])  # (name kept for old result files: this is the group model, see group_model)
    return res


def run_team_sport(conn, artifacts_dir: Path, task_name: str, families=("logreg", "lgbm", "cat"), trials: int = 15, seed: int = 0, log=print) -> dict:
    task = compare.TASKS[task_name]
    data = compare.load_task(conn, artifacts_dir, task)
    matches = db.load_matches(conn, task.sport)
    extras = db.load_match_extras(conn, task.sport)
    feats = features2.build(matches, task.sport, extras).set_index("match_id")
    extra = feats.loc[data.rows["match_id"].to_numpy(), features2.FEATURES].reset_index(drop=True)
    tr = compare.windows(task, data.dates)[0]
    return ablate_task(task, data, extra, features2.GROUPS, lambda rest: compare.incumbent(task, artifacts_dir, data, tr, rest), families, trials, seed, log)


def _segment_temperatures(P: np.ndarray, y: np.ndarray, seg: np.ndarray) -> dict[str, float]:
    """Per-segment logit scale fitted on one window (win probability of team 1 = column 0), as production does."""
    from .cricket import model as cmodel

    out = {}
    for name in np.unique(seg):
        m = seg == name
        if m.sum() >= 30:
            out[str(name)] = cmodel.fit_temperature(P[m, 0], (y[m] == 0).astype(float))
    return out


def _apply_segment_temperatures(P: np.ndarray, seg: np.ndarray, temps: dict[str, float]) -> np.ndarray:
    out = P.copy()
    for name, s in temps.items():
        m = seg == name
        if m.any():
            t1 = 1 / (1 + np.exp(-s * np.log(np.clip(P[m, 0], 1e-6, 1 - 1e-6) / np.clip(P[m, 1], 1e-6, 1 - 1e-6))))
            out[m] = np.column_stack([t1, 1 - t1])
    return out


def calibrated_comparison(task: compare.Task, data: compare.TaskData, extra: pd.DataFrame, cols: list[str], incumbent_fn,
                          families=("logreg", "lgbm", "cat"), trials: int = 15, seed: int = 0, log=print) -> dict:
    """Existing model vs new-feature models with the SAME calibration on both sides.

    Production applies a per-segment temperature (club / women / intl). Every model here gets one fitted on the
    VALIDATION window only (models are fitted on the training window), then scored once on the test window, so
    a gain that was just better calibration, or one the calibration already provides, shows up honestly."""
    from .cricket import model as cmodel

    tr, va, te = compare.windows(task, data.dates)
    y = data.y
    seg = cmodel.segment_of(data.rows)
    X_old = data.X.reset_index(drop=True)
    X_new = pd.concat([X_old, extra.reset_index(drop=True)[cols]], axis=1)
    inc, kind = incumbent_fn(np.concatenate([va, te]))
    candidates: dict[str, tuple[np.ndarray, np.ndarray]] = {f"existing ({kind})": (inc[: len(va)], inc[len(va):])}
    new_va, new_te = [], []
    for name in families:
        params = compare.tune_family(task, name, X_new.iloc[tr], y[tr], X_new.iloc[va], y[va], trials, seed)["params"]
        model = compare._factory(task, name, params)().fit(X_new.iloc[tr], y[tr])
        pv, pt = model.predict_proba(X_new.iloc[va]), model.predict_proba(X_new.iloc[te])
        candidates[f"new {name}"] = (pv, pt)
        new_va.append(pv)
        new_te.append(pt)
    candidates["new ensemble"] = (np.mean(new_va, axis=0), np.mean(new_te, axis=0))
    out: dict = {"task": task.name, "new_columns": cols, "windows": [len(tr), len(va), len(te)], "candidates": {}}
    cal: dict[str, np.ndarray] = {}
    for label, (pv, pt) in candidates.items():
        temps = _segment_temperatures(pv, y[va], seg[va])
        cal[label] = _apply_segment_temperatures(pt, seg[te], temps)
        out["candidates"][label] = {"temperatures": {k: round(v, 3) for k, v in temps.items()},
                                    "raw_test": compare.evaluate(pt, y[te]), "calibrated_test": compare.evaluate(cal[label], y[te])}
        r, c = out["candidates"][label]["raw_test"], out["candidates"][label]["calibrated_test"]
        log(f"  {label:<20} log-loss raw {r['log_loss']:.4f} -> calibrated {c['log_loss']:.4f}   ECE {r['ece']:.4f} -> {c['ece']:.4f}   temps {out['candidates'][label]['temperatures']}")
    base = next(iter(cal))
    out["vs_existing_calibrated"] = {}
    for label in list(cal)[1:]:
        g = compare.paired_gain(compare.per_match_loss(cal[base], y[te]), compare.per_match_loss(cal[label], y[te]), seed)
        out["vs_existing_calibrated"][label] = g
        log(f"  {label:<20} vs calibrated existing: paired gain {g['mean']:+.4f} ({g['ci95'][0]:+.4f} to {g['ci95'][1]:+.4f})")
    return out


def run_cricket_calibrated(conn, artifacts_dir: Path, task_name: str, groups: list[str], families=("logreg", "lgbm", "cat"),
                           trials: int = 15, seed: int = 0, log=print, with_weather: bool = False) -> dict:
    inputs = _cricket_inputs(conn, task_name, with_weather)
    task, data, extra, all_groups = inputs
    cols = [c for g in groups for c in all_groups[g]]
    tr = compare.windows(task, data.dates)[0]
    log(f"[{task.name}] calibrated comparison with groups {groups} ({len(cols)} columns)")
    return calibrated_comparison(task, data, extra, cols, lambda rest: compare.incumbent(task, artifacts_dir, data, tr, rest), families, trials, seed, log)


def _cricket_inputs(conn, task_name: str, with_weather: bool):
    from .cricket import data as cdata
    from .cricket import features as cfeat
    from .cricket import features2 as cf2
    from .cricket import model as cmodel

    task = compare.TASKS[task_name]
    cd = cdata.load(conn, formats=(task.fmt,))
    rows = cmodel.win_rows(cfeat.build_features(cd), task.fmt).reset_index(drop=True)
    y = cmodel._labels_idx(rows) if task.k == 3 else np.where(rows["label"].to_numpy() == 1.0, 0, 1)
    data = compare.TaskData(cmodel.stage_matrix(rows, "post").reset_index(drop=True), y, rows["start_time"], rows)
    feats = cf2.build(cd).set_index("match_id")
    groups = {k: list(v) for k, v in cf2.GROUPS.items()}
    base_cols = [c for c in cf2.FEATURES if c not in cf2.INTERACTIONS]
    extra = feats.loc[rows["match_id"].to_numpy(), base_cols].reset_index(drop=True)
    extra = cf2.add_interactions(extra, data.X["elo_diff"].to_numpy())
    if with_weather:
        from . import weather

        wx = weather.features_for(conn, rows["match_id"].to_numpy())
        groups["weather"] = weather.FEATURES
        extra = pd.concat([extra, wx[weather.FEATURES].reset_index(drop=True)], axis=1)
    return task, data, extra, groups


def run_cricket(conn, artifacts_dir: Path, task_name: str, families=("logreg", "lgbm", "cat"), trials: int = 15, seed: int = 0, log=print,
                with_weather: bool = False) -> dict:
    from .cricket import data as cdata
    from .cricket import features as cfeat
    from .cricket import features2 as cf2
    from .cricket import model as cmodel

    task = compare.TASKS[task_name]
    cd = cdata.load(conn, formats=(task.fmt,))
    rows = cmodel.win_rows(cfeat.build_features(cd), task.fmt).reset_index(drop=True)
    y = cmodel._labels_idx(rows) if task.k == 3 else np.where(rows["label"].to_numpy() == 1.0, 0, 1)
    data = compare.TaskData(cmodel.stage_matrix(rows, "post").reset_index(drop=True), y, rows["start_time"], rows)
    feats = cf2.build(cd).set_index("match_id")
    groups = {k: list(v) for k, v in cf2.GROUPS.items()}
    base_cols = [c for c in cf2.FEATURES if c not in cf2.INTERACTIONS]
    extra = feats.loc[rows["match_id"].to_numpy(), base_cols].reset_index(drop=True)
    extra = cf2.add_interactions(extra, data.X["elo_diff"].to_numpy())
    if with_weather:
        from . import weather

        wx = weather.features_for(conn, rows["match_id"].to_numpy())
        groups["weather"] = weather.FEATURES
        extra = pd.concat([extra, wx[weather.FEATURES].reset_index(drop=True)], axis=1)
    tr = compare.windows(task, data.dates)[0]
    return ablate_task(task, data, extra, groups, lambda rest: compare.incumbent(task, artifacts_dir, data, tr, rest), families, trials, seed, log)
