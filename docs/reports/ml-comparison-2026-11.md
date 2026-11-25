# Model comparison (Phases 2, 4 and 5), 24 November 2026

Run with `node ml-service/run.mjs compare --trials 25` (raw numbers in `ml-service/artifacts/compare/<task>.json`, figures in `docs/reports/figures/`).

## 1. Result in three sentences

**None of the five new algorithms (random forest, XGBoost, LightGBM, CatBoost, tuned logistic regression), their ensemble, or a blend of old and new beats the existing models by a statistically meaningful margin on any of the five tasks.** All approaches land within about 1% of each other on the untouched test window, which says the limit is the information in the features, not the choice of algorithm. The one real gain is calibration of cricket T20 (about 2.5% lower log-loss), and the calibration already in production (per-segment temperature scaling) beats Platt scaling and isotonic regression.

## 2. Protocol (identical for every model)

- **Chronological windows, never shuffled.** Train, then validation, then an untouched test window:

| Task | Train | Validation | Test (scored once) |
|---|---|---|---|
| Football (5 leagues) | Jul 2022 to Jun 2024 (3,665 matches) | 2024-25 season (1,965) | 1 Jul 2025 to 23 Nov 2026 (**2,263**) |
| Basketball (NBA) | Oct 2022 to Dec 2023 (1,742) | Jan to Jun 2024 (843) | Jul 2024 to Jun 2025 (**1,314**) |
| Cricket T20 | 2007 to 2022 (2,930) | 2023 to 2024 (1,591) | 2025 to Nov 2026 (**1,954**) |
| Cricket ODI | 2003 to 2020 (1,959) | 2021 to 2023 (539) | 2024 to Nov 2026 (**493**) |
| Cricket Test | 2003 to 2018 (591) | 2019 to 2021 (101) | 2022 to Oct 2026 (**196**) |

- **Same features for every model** (27 for football and basketball, 28 for cricket, all from the causal replay that the audit checked for leakage). Cricket models are trained on both team orders and their predictions mirrored, as in production.
- **Tuning on validation only:** Optuna (TPE sampler, seed 0) with 25 trials per family, six families per task, minimising validation log-loss. The existing model is refitted on the same training window with its production settings.
- **Calibration chosen on validation only.** For each model, none, Platt scaling or isotonic regression is chosen by blocked cross-validation inside the validation window, fitted there, and applied unchanged to the test predictions of the same train-only model.
- **Ensemble and blend:** the ensemble averages the three best new families (by validation); the blend averages that ensemble with the existing model. Equal weights, nothing fitted. A new model counts as selected only through validation evidence.
- **Test window:** scored once, with paired bootstrap 95% intervals against the existing model.
- **Proof the test window cannot influence a choice:** a test scrambles the test labels and checks that the chosen families, ensemble members, calibrators and tuned settings are all unchanged.

## 3. Results on the untouched test windows

Log-loss, lower is better. "Existing" is the model that was in production before this work, refitted on the training window.

| Task | Base rates | Existing | Best new single | Ensemble (new) | Blend (existing + new) | Chosen on validation | Chosen vs existing |
|---|---|---|---|---|---|---|---|
| Football | 1.0698 | **0.9891** | 0.9911 (logreg + Platt) | 0.9920 (with Platt) | 0.9881 | blend | +0.11%, interval −0.0020 to +0.0041 |
| Basketball | 0.6917 | **0.6081** | 0.6143 (CatBoost) | 0.6125 | 0.6079 | blend | +0.03%, interval −0.0037 to +0.0038 |
| Cricket T20 | 0.6931 | 0.5518 raw, **0.5417** with Platt | 0.5415 (hgb + Platt) | 0.5451 | 0.5405 (with Platt) | XGBoost (0.5480) | −1.16% vs existing + Platt, interval −0.0122 to −0.0003 |
| Cricket ODI | 0.7091 | 0.6358 | 0.6330 (random forest) | 0.6338 | 0.6331 | XGBoost (0.6356) | +0.03%, interval −0.0116 to +0.0120 |
| Cricket Test (3-way) | 1.0278 | 0.9132 | 0.9035 (XGBoost) | 0.9161 | 0.9119 | ensemble | −0.32%, interval −0.0233 to +0.0167 |

How to read it:
- **Every interval for the chosen model includes zero, except T20 where it is significantly worse.** The blends are 0.0002 to 0.001 better in log-loss on football and basketball, far inside the noise.
- **Football.** The existing Poisson model beats every classifier. A plausible reason: it learns from the number of goals, which carries more information per match than the win/draw/loss label the classifiers see. RPS: existing 0.2023, best classifier 0.2026, blend 0.2021.
- **Cricket Test** has too little data to rank models: 101 validation and 196 test matches. XGBoost happened to score best on test (0.9035) but validation chose the ensemble, and the intervals are wide.
- **Tuning did not buy an edge.** None of the Optuna-tuned families beat the existing model on the test window. (I did not measure how much Optuna improved each family over its default settings.)

Other metrics on the test window (existing model, calibrated, for reference): football accuracy 52.5%, AUC 0.661; basketball accuracy 66.4%, AUC 0.721; T20 accuracy 72.3%, AUC 0.799; ODI accuracy 62.3%, AUC 0.687; Test accuracy 57.7%. Precision, recall and F1 are in the JSON files, but **for three-outcome tasks the macro precision and F1 swing wildly** (for example 0.34 to 0.67 between near-identical football models) because a draw is almost never the most likely outcome, so they depend on a handful of draw calls. Decisions here use log-loss and RPS.

## 4. Probability calibration

Expected calibration error (ECE) against its noise floor (the 95th percentile of the ECE a perfectly calibrated model would show on this many matches):

| Task | Existing model ECE | Noise floor | After calibration | Calibrator chosen on validation |
|---|---|---|---|---|
| Football (class-wise ECE; the floor is for the home-win probability only) | 0.0231 | about 0.034 | none needed | none |
| Basketball | 0.0290 | 0.0461 | none needed | none |
| Cricket T20 | **0.0564** (above the floor) | 0.0367 | 0.0359 with Platt (floor 0.0335) | Platt |
| Cricket ODI | 0.0675 | 0.0729 | none needed | none |
| Cricket Test | 0.1119 | 0.1070 | too few matches to tell | none |

For cricket T20, the calibration methods compared on the test window ([figure](figures/cricket-T20-calibration-methods.png), script `ml-service/experiments/t20_calibration.py`):

| Calibration of the existing T20 model | Log-loss | Brier (binary) | ECE | Gain over raw |
|---|---|---|---|---|
| None | 0.5518 | 0.1859 | 0.0564 | n/a |
| Global Platt scaling | 0.5417 | 0.1829 | 0.0359 | +0.0101 (interval +0.0052 to +0.0150) |
| Global isotonic regression | 0.5427 | 0.1830 | 0.0342 | +0.0092 (+0.0008 to +0.0168) |
| Per-segment Platt | 0.5409 | 0.1827 | 0.0280 | +0.0110 (+0.0050 to +0.0167) |
| **Per-segment temperature (production)** | **0.5378** | **0.1816** | **0.0252** (below the floor of 0.0323) | **+0.0140 (+0.0093 to +0.0187)** |

The production method is significantly better than global Platt (difference −0.0039, interval −0.0074 to −0.0007), and the calibrated model is within sampling noise of perfect. So the T20 miscalibration in the audit applied to the raw model; the deployed one is calibrated. Platt scaling and isotonic regression are implemented (`ml-service/tusky_ml/calibrate.py`, tested), chosen automatically where they help, and not adopted where they don't.

Reliability diagrams (observed frequency against predicted probability, with 95% intervals and a histogram of how often each probability was predicted) are saved for every task in `docs/reports/figures/`.

## 5. What this means

1. **Keep the existing models.** Replacing them with XGBoost, LightGBM, CatBoost or a random forest would add complexity and lose nothing or gain nothing measurable. I did not claim an improvement that the data doesn't show.
2. **The bottleneck is information.** Seven different learners reach the same score, so more of the same results-based features won't help. The next gains must come from new information (Phase 3): weather and venue conditions, playing-XI and availability data, head to head, finer recent-form windows.
3. **Small formats cannot rank models.** Test cricket (196 test matches) and ODIs (493) have intervals of about ±0.01 to ±0.02 log-loss, larger than every difference seen. More data is the only fix.
4. **A promotion rule is needed** (Phase 6): replace a model only if its paired improvement on a held-out window has a 95% interval above zero and its calibration is within noise.

## 6. Limits of this comparison

- One test window per task, and for the small formats a small one.
- Optuna search was modest (25 trials per family), and the search spaces were conservative; a much larger search might find a small edge.
- The existing model is the existing method refitted on the training window, so it shares the same features and sees the same data.
- The existing football model uses rating settings tuned on matches before July 2025. That covers this protocol's training and validation windows but not its test window, so the test is clean, but the existing model had a tuning advantage over the untuned new classifiers on those earlier windows.
- No bookmaker benchmark exists.
