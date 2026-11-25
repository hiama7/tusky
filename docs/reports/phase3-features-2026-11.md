# Phase 3 — advanced features: what was tried and what it was worth

Result in one line: **none of the new feature groups is adopted.** Across football, basketball and cricket (T20, ODI, Test), no new group improved the existing production models by a margin that survives a paired 95% interval on an untouched test window, and the one T20 gain that looked real disappeared once both sides were calibrated the same way.

## 1. Method (same rules as the earlier phases)

- **Causal features only.** Every feature is a replay: state is read before a match and updated after it. Each builder passes the causal-truncation probe (rebuild from the past only with the match's own result hidden must equal the full build), and the probe is tested against a planted leak.
- **Chronological windows.** Train → validation → test, in time order, with the test window untouched until the end. Window sizes (matches): football 3,665 / 1,965 / 2,263; basketball 1,742 / 843 / 1,314; cricket T20 2,930 / 1,591 / 1,954; ODI 1,959 / 539 / 493; Test 591 / 101 / 196.
- **Tuning on validation only.** Optuna (15 trials per family) for logreg, LightGBM and CatBoost, once on the existing features and once on existing + new features.
- **Group selection on validation only.** Each feature group is added alone to the existing features, using the family that is best on validation. A group is "kept" only if it lowers validation log-loss. The test window then judges that choice once; test results never choose anything.
- **Metric.** Log-loss difference per match, paired bootstrap 95% interval (positive = better than the existing model).
- **Fair baseline.** The existing model is refitted on the training window only (no hindsight).

## 2. Features built

| Sport | Groups |
|---|---|
| Football, basketball | rolling windows, win percentage, head-to-head, scoring consistency, schedule congestion, match importance, missing-data flags |
| Cricket | form (last 15, all-time win %), consistency (steadiness of innings totals), venue record (shrunk toward 50%), importance (knockout, major event, bilateral) plus importance × Elo interactions, recent form of the playing XI (last 5 innings/spells) |
| Cricket (weather) | mean temperature, humidity, dew point, wind, cloud cover for the match day |

Notes that matter for reading the results:

- **Importance flags are the same for both teams.** With the orientation augmentation, a linear model gives them exactly zero weight. They were first measured as exactly 0.0000 gain. The fix, flag × Elo-difference interactions, is tested, and the group now has an effect, but it does not help (see below).
- **Weather is an upper bound.** The archive holds what actually happened, while a live prediction only has a forecast. Precipitation is deliberately excluded because it includes post-hoc facts such as rain delays. All 7,357 T20/ODI/Test matches at the 243 geocoded venues have weather. 97 venues could not be geocoded unambiguously (ambiguous city names such as Hamilton, or towns under 20,000 people); their matches get a `wx_missing` flag with neutral values. Wrong coordinates would add noise, never leakage.
- **Pitch reports** are not available from any source in use; temperature, humidity and wind are only crude proxies.

## 3. Results

Group gains below are test log-loss improvements over the existing features with the group-selection family (positive = better). "Validation" is the gain that decided whether the group was kept.

### Football (existing model: GLM)

| Group | Validation gain | Test gain (95% interval) | Kept |
|---|---|---|---|
| windows | −0.0029 | −0.0026 (−0.0046 to −0.0005) | no |
| winpct | −0.0004 | +0.0018 (+0.0010 to +0.0027) | no |
| h2h | +0.0003 | −0.0006 (−0.0012 to +0.0001) | yes |
| consistency | −0.0006 | −0.0008 (−0.0020 to +0.0003) | no |
| congestion | −0.0021 | −0.0021 (−0.0038 to −0.0003) | no |
| importance | −0.0001 | −0.0001 | no |
| missing | +0.0003 | −0.00003 | yes |

New-feature ensemble vs existing model: **−0.0053 (−0.0115 to +0.0013)**, i.e. no gain.

### Basketball (existing model: ensemble)

| Group | Validation gain | Test gain (95% interval) | Kept |
|---|---|---|---|
| windows | +0.0006 | −0.0023 (−0.0054 to +0.0010) | yes |
| winpct | −0.0009 | −0.0020 (−0.0059 to +0.0020) | no |
| h2h | +0.0009 | **−0.0131 (−0.0202 to −0.0061)** | yes |
| consistency | −0.0012 | +0.0007 (−0.0006 to +0.0019) | no |
| congestion | +0.00004 | −0.0034 (−0.0093 to +0.0023) | yes |
| importance | −0.0017 | +0.0002 | no |
| missing | +0.0001 | +0.0003 (+0.00006 to +0.0005) | yes |

New-feature ensemble vs existing model: **−0.0073 (−0.0152 to +0.0009)**.

Head-to-head is a clear case of validation misleading: it looked slightly useful on validation and was significantly harmful on test. This is why test results never choose groups and why the kept-by-validation rule is reported as a rule, not as evidence.

### Cricket (existing model: HGB for T20, ensemble for ODI and Test)

| Format | Groups kept by validation | New-feature ensemble vs existing (test, 95% interval) |
|---|---|---|
| T20 (with weather available) | recent | +0.0056 (−0.0002 to +0.0111) |
| ODI (with weather available) | none | +0.0023 (−0.0067 to +0.0121) |
| Test (no weather) | venue, importance | +0.0022 (−0.0280 to +0.0330) |

Cricket group gains on test (positive = better):

| Group | T20 | ODI | Test |
|---|---|---|---|
| form | −0.0011 (−0.0038 to +0.0016) | −0.0018 (−0.0093 to +0.0062) | +0.0096 (+0.0011 to +0.0184) |
| consistency | +0.0015 (−0.0010 to +0.0039) | +0.0048 (−0.0018 to +0.0117) | +0.0009 (−0.0098 to +0.0127) |
| venue | +0.0032 (+0.0004 to +0.0060) | +0.0008 (−0.0072 to +0.0087) | +0.0157 (−0.0109 to +0.0413) |
| importance | +0.0008 (−0.0022 to +0.0038) | +0.0011 (−0.0063 to +0.0085) | −0.0013 (−0.0063 to +0.0037) |
| recent | +0.0020 (−0.0020 to +0.0057) | +0.0027 (−0.0052 to +0.0111) | −0.0038 (−0.0109 to +0.0031) |
| weather | −0.0018 (−0.0049 to +0.0014) | −0.0026 (−0.0103 to +0.0051) | not run |

Reading it:

- **Weather does not help**, on either validation or test, in T20 or ODI, even though the data are the best case (observed, not forecast). Real-world value can only be lower.
- **Validation decisions and test results disagree in most cells.** Examples: T20 venue lost on validation but gained on test (+0.0032, interval above zero); Test-format form gained on test while validation said no. With 101 validation and 196 test Test matches these are noise-sized effects; nothing is adopted on them.
- **Test-format logreg gain** (+0.030 in one family) is a one-family result on a 196-match window. The other families show nothing.

### The calibrated T20 comparison (the deciding one)

The first T20 ensemble result was positive only because it compared raw outputs against raw outputs. Production applies a per-segment temperature (club, women, men's international). So both sides were calibrated with a temperature fitted on the validation window only, then scored once on test:

| Model | Test log-loss raw | Test log-loss calibrated | Gain vs calibrated existing (95% interval) |
|---|---|---|---|
| Existing (HGB) | 0.5518 | 0.5378 | baseline |
| New logreg | 0.5545 | 0.5436 | −0.0057 (−0.0135 to +0.0019) |
| New LightGBM | 0.5463 | 0.5389 | −0.0011 (−0.0072 to +0.0051) |
| New CatBoost | 0.5585 | 0.5517 | −0.0139 (−0.0224 to −0.0050) |
| New ensemble | 0.5474 | 0.5383 | −0.0005 (−0.0066 to +0.0055) |

Calibration alone improves the existing model by 0.014, more than any new feature does. After it, the new-feature ensemble is level with the existing model and CatBoost is significantly worse. Calibration error (ECE) for the existing model falls from 0.0564 to 0.0252. The club segment needs heavy shrinking in every model (temperature 0.37–0.78).

## 4. Conclusions and what changes in production

- **Adopted: nothing from Phase 3.** The existing production models stay.
- **Why:** the remaining signal in these sports is largely already captured by Elo-style ratings and the existing features; additional descriptive features mostly add variance. This agrees with Phase 2, where no new algorithm beat the existing models significantly.
- **Kept as tooling:** the new feature builders, the ablation harness, the weather ingestion and the calibrated comparison stay in the repository, off by default, so any future data source can be evaluated by the same protocol.
- **Not claimed:** no accuracy percentage is claimed from this phase.

## 5. Limitations

- Small validation and test windows, especially Test cricket (101 / 196) and ODI (539 / 493), mean only larger effects could be detected; absence of a gain is not proof of no effect.
- Weather coverage is incomplete (97 venues could not be geocoded unambiguously) and observed rather than forecast.
- Live or in-play features (Phase 7) and player-level injury or availability data are not covered here; no authorised source for them is wired in yet.
- The weather and ablation artifacts are under `ml-service/artifacts/ablate/` (git-ignored); rerun with `npm run ml:ablate -- --tasks cricket-T20 [--weather]` (or `--calibrated --groups recent` for the calibrated comparison) to reproduce with the same seed.

## 6. Data and attribution

Weather: Open-Meteo (open-meteo.com), ERA5 reanalysis, free non-commercial API. Replace or license before any commercial release. Cricket data: Cricsheet (ODC-BY).
