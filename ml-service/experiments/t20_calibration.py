"""Experiment: which calibration is best for cricket T20 on the untouched test window?
Existing model fitted on the train window only; every calibrator fitted on validation only.
Run from ml-service/:  .venv/Scripts/python experiments/t20_calibration.py"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, ".")
from tusky_ml import calibrate, compare, db, metrics
from tusky_ml.config import load_settings
from tusky_ml.cricket import model as cmodel

s = load_settings()
task = compare.TASKS["cricket-T20"]
with db.connect(s.database_url) as conn:
    data = compare.load_task(conn, s.artifacts_dir, task)
tr, va, te = compare.windows(task, data.dates)
P, kind = compare.incumbent(task, s.artifacts_dir, data, tr, np.concatenate([va, te]))
Pva, Pte = P[: len(va)], P[len(va):]
yva, yte = data.y[va], data.y[te]
seg_va, seg_te = cmodel.segment_of(data.rows.iloc[va]), cmodel.segment_of(data.rows.iloc[te])
print(f"existing model: {kind}; validation {len(va)}, test {len(te)}; segments in test:", {k: int((seg_te == k).sum()) for k in np.unique(seg_te)})


def report(name, probs):
    m = compare.evaluate(probs, yte)
    print(f"  {name:<34} log_loss {m['log_loss']:.4f}  brier {m['brier_binary']:.4f}  acc {m['accuracy']:.3f}  ece {m['ece']:.4f} (noise floor p95 {m['ece_floor_p95']:.4f})")
    return compare.per_match_loss(probs, yte)


loss = {"raw": report("raw (no calibration)", Pte)}
for kind_ in ("platt", "isotonic"):
    loss[kind_] = report(f"global {kind_}", calibrate.Calibrator(kind_).fit(Pva, yva).apply(Pte))

# production style: a logit scale per segment fitted on validation (as cmodel.fit_temperature does)
out = Pte.copy()
for name in np.unique(seg_te):
    mv, mt = seg_va == name, seg_te == name
    if mv.sum() >= 30:
        s_ = cmodel.fit_temperature(Pva[mv, 0], (yva[mv] == 0).astype(float))
        out[mt] = cmodel.apply_temperature(np.column_stack([Pte[mt, 0], np.zeros(mt.sum()), Pte[mt, 1]]), s_)[:, [0, 2]]
loss["segment temperature"] = report("segment temperature (production style)", out)
out_temp = out.copy()

# per-segment Platt
out = Pte.copy()
for name in np.unique(seg_te):
    mv, mt = seg_va == name, seg_te == name
    if mv.sum() >= 60:
        out[mt] = calibrate.Calibrator("platt").fit(Pva[mv], yva[mv]).apply(Pte[mt])
loss["segment platt"] = report("per-segment platt", out)

print("paired gains vs raw (positive = better), 95% interval:")
for k in ("platt", "isotonic", "segment temperature", "segment platt"):
    g = compare.paired_gain(loss["raw"], loss[k])
    print(f"  {k:<22} {g['mean']:+.4f}  [{g['ci95'][0]:+.4f}, {g['ci95'][1]:+.4f}]")
g = compare.paired_gain(loss["segment temperature"], loss["platt"])
print(f"global platt vs segment temperature: {g['mean']:+.4f}  [{g['ci95'][0]:+.4f}, {g['ci95'][1]:+.4f}]")

# figure: reliability of raw vs the calibrations, on the test window
hit = (yte == 0).astype(float)
curves = {"raw": (Pte[:, 0], hit),
          "global platt": (calibrate.Calibrator("platt").fit(Pva, yva).apply(Pte)[:, 0], hit),
          "segment temperature (production)": (out_temp[:, 0], hit)}
fig_dir = Path(__file__).resolve().parents[2] / "docs" / "reports" / "figures"
compare.reliability_figure(fig_dir / "cricket-T20-calibration-methods.png",
                           f"cricket T20 test window ({len(te)} matches): calibration methods", curves)
print("figure saved to", fig_dir / "cricket-T20-calibration-methods.png")
