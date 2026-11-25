# ML audit (Phase 1), 24 November 2026

Everything below is measured on the real database and the real saved models (`npm run ml:audit`, raw numbers in `ml-service/artifacts/audit.json`), except where marked "by inspection". Nothing was changed to make the numbers look better.

## 0. Premises in the brief that do not match this project

| The brief assumes | What is actually here |
|---|---|
| "my existing Cricbuzz scraper" | **There is none.** `grep` finds the word only in a doc note about another project's database container. No scraper code, and no rows from Cricbuzz (0 rows with an unknown provider). I did not check Cricbuzz's terms; your earlier specification asked for authorized sources only. Cricket history comes from Cricsheet (11,252 matches, 5.1M deliveries). Live fixtures would come from the CricketData.org adapter, which is written but unverified because there is no API key. |
| "my existing frontend" | **There is none.** `frontend/` and `backend/` are empty. A dashboard has to be built, not improved. |
| XGBoost, LightGBM, CatBoost, Optuna | **Not installed or used.** Only scikit-learn is in the environment. |
| Weather, pitch conditions, player availability for every sport | Not built; see section 4. |

## 1. Verdict in one paragraph

The pipeline is **honest**: no leakage was found by tests that I proved can catch leaks, validation is always chronological, football and basketball probabilities are calibrated within sampling noise, and nothing is missing or duplicated in the football data. The weaknesses are about **breadth and depth** rather than correctness: only linear and scikit-learn boosting models are used; small formats overfit badly; cricket T20 probabilities are miscalibrated; the basketball model is 17 months out of date; there is no untouched test set outside football; and there is no history of past predictions or rule for replacing a model.

## 2. Questions from the brief, answered

| Question | Answer |
|---|---|
| Which algorithms are used? | **Football:** Poisson regression (GLM) and Poisson gradient boosting, turned into home/draw/away through a Dixon-Coles scoreline grid; ensemble weight 0.6/0.4; the saved model is the GLM. **Basketball:** ridge and gradient-boosting regression of points, then a normal distribution for the margin; saved model is the ensemble. **Cricket:** logistic regression, gradient boosting and their ensemble per format, plus quantile boosting for the first-innings score and per-segment temperature scaling (a Platt-style rescaling). All boosting is scikit-learn's `HistGradientBoosting`. |
| How is training data collected? | Football: API-Sports free plan (2022-23 to 2024-25), openfootball CC0 (to 2026-27), and 295 gap results from TheSportsDB. Basketball: API-Sports (NBA 2022-23 to 2024-25). Cricket: Cricsheet bulk downloads. All through idempotent importers; no scraping. |
| How are data split? | Rolling-origin backtest: the newest half of the data is cut into 4 consecutive blocks, each predicted by a model fitted only on earlier matches. Football additionally has a one-shot holdout (matches from 1 July 2025) inside `tune`. **No untouched test set exists for basketball or cricket.** |
| Is there data leakage? | **No evidence of any** (section 3). |
| Overfitting? | Not in the linear models. **Yes in gradient boosting on small data** (section 3). |
| Is the dataset large enough? | Football 7,893 usable matches (658 per feature): adequate. Basketball 3,899 (325 per feature, three seasons): thin. Cricket T20 6,475, ODI 2,991, **Test 888: too small** for boosting. |
| Missing values and duplicates? | No NaN or infinite value in any feature matrix, but only because missing information is silently replaced by neutral values; there are no "was missing" flags. Football: 0 duplicate fixtures. Basketball: 16 suspicious pairs (section 3). Cricket: 0 failed imports, 0 duplicate source files. |
| Calibrated? | Football and basketball yes; cricket T20 no (section 3). |
| Outdated information? | **Basketball: yes, 519 days.** Football: current to 23 Nov 2026. Cricket results: 22 days old, but no upcoming fixtures are stored. |

## 3. Measurements

### Leakage: none found

| Probe | How it works | Result |
|---|---|---|
| Causal probe | For sampled matches, rebuild the features from only the earlier matches with the match's own result hidden, and compare with the full-history features | **Football 12 matches, basketball 12, cricket T20 6: maximum difference 0.0 in every feature.** |
| Noise probe | Replace the real results by random ones and run the whole pipeline | **Football skill −0.11% vs base rates, basketball −0.13%, cricket AUC 0.490 (0.5 means no signal).** |
| Do the probes work? | Tests plant two leaks (a feature using the match's own result; a feature using future matches) | **Both caught**; the clean builders pass. |

### Overfitting (fit on the first 60% of matches, compare with the next 40%)

| Sport / format | Model | Training | Held-out | Verdict |
|---|---|---|---|---|
| Football (RPS) | GLM | 0.2015 | 0.2022 | none |
| | gradient boosting | 0.1964 | 0.2036 | mild |
| Basketball (log-loss) | linear | 0.6314 | 0.6116 | none |
| | gradient boosting | 0.6177 | 0.6188 | none |
| Cricket T20 (log-loss) | logistic | 0.6254 | 0.5430 | not overfitting; the early rows have thin history (cold start) |
| | gradient boosting | 0.5590 | 0.5372 | mild |
| Cricket ODI (log-loss) | logistic | 0.5728 | 0.6252 | moderate |
| | gradient boosting | 0.5143 (acc 75%) | 0.6131 (acc 67%) | **strong** |
| Cricket Test (log-loss) | logistic | 0.9578 | 0.9434 | none |
| | gradient boosting | **0.5756 (acc 85%)** | **0.9205 (acc 59%)** | **severe memorisation** |

The ensembles chosen for ODI and Test include these overfit members.

### Calibration (backtest predictions; ECE = expected calibration error)

The "noise floor" is the ECE that a perfectly calibrated model would still show on this many matches by luck.

| | Matches | ECE | Noise floor (95th percentile) | Verdict |
|---|---|---|---|---|
| Football, home win | 3,947 | 0.0184 | 0.0264 | within noise |
| Football, draw | 3,947 | 0.0152 | 0.0238 | within noise |
| Basketball, home win | 1,950 | 0.0283 | 0.0367 | within noise |
| Cricket T20, raw model (before the per-segment temperature scaling that production applies) | 3,238 | **0.0423** | 0.0264 | raw model miscalibrated; **the deployed, calibrated model is within noise** (ECE 0.025 vs floor 0.032 on the untouched test window, see the comparison report) |
| Cricket ODI | 1,496 | 0.0362 | 0.0405 | within noise |
| Cricket Test | 444 | 0.0777 | 0.0761 | borderline (too few matches to tell) |

Football's one-shot holdout also shows a tail problem that the average hides: calls of 74% came true 85% of the time (92 matches) and low draw calls (17%) came true 12% of the time (245 matches).

### Data quality

| Check | Result |
|---|---|
| Football duplicate fixtures | 0 |
| Football completed without a score | 2 (one abandoned, one awarded; correct) |
| **Basketball** same teams, same home side, within 36 hours | **16 pairs with different ids and scores.** An NBA team never hosts the same opponent on consecutive days, so at least one game of each pair has a wrong home/away or date in the source (about 32 of 4,150 games). Cannot be fixed without a second source. |
| Cricket same teams at the same timestamp | 84 pairs; real double-headers (mostly associate tours). Their order within a day is arbitrary (by id). |
| Cricket matches without innings, line-ups, toss or venue | 0 each |
| Teams with fewer than 10 matches (football) | 79 (Champions League qualifiers); harmless, filtered by the minimum-games rule |

### Metrics definitions

The two-outcome "Brier" in my earlier reports sums over both outcomes and is **exactly double** the conventional binary Brier score (test: 0.3967 vs 0.1984). Cricket T20's 0.365 is 0.182 in the usual definition. Precision, recall and F1 were never reported.

## 4. Weaknesses, ranked

**High**
1. **Basketball is 519 days out of date** (data to 23 June 2025; the free plan allows no newer season). No upcoming games, no predictions.
2. **No untouched test set** for cricket and basketball. Candidate choice, calibration choice and the reported score use the same folds, so the numbers are slightly optimistic. (Football's holdout and backtest differ by only 0.0007 RPS, so the effect looks small, but it is unmeasured elsewhere.)
3. **Algorithm coverage:** only linear models and scikit-learn boosting; no random forest, XGBoost, LightGBM or CatBoost; no systematic hyperparameter search except random search of football's rating settings.
4. **Overfitting in small formats** (Test, ODI), see above.
5. ~~Cricket T20 is miscalibrated.~~ **Corrected after the comparison:** the audit measured the raw model (ECE 0.042 vs a noise floor of 0.026); the per-segment temperature scaling that production applies fixes it (ECE 0.025 vs 0.032 on an untouched test window). The remaining issue is that the IPL slice has no skill over a coin flip and is shrunk to near 50/50.
6. **No prediction history and no model-replacement rule.** The `predictions` table holds only forward predictions (318 rows, 3 versions of the same 106 matches), nothing compares them with results, and retraining replaces a model without comparing it with the old one.

**Medium**
7. Reporting gaps: double Brier, no precision/recall/F1, no ECE or reliability diagram in model reports.
8. Feature gaps against your list: **no weather, no pitch conditions** (venue statistics are a proxy), **no tournament importance, no team consistency**; football and basketball have no head-to-head, no venue or explicit 5/10/15-match windows, and no player data (no legal free source); cricket has no live features, bowling style or partnerships.
9. Missing information is hidden by neutral fills (zero NaN, no "was missing" flags).
10. Football tail calibration (above).
11. Cold-start rows are weighted like mature ones (cricket T20).
12. Small samples: Test 888, ODI 2,991, basketball three seasons.
13. Ratings across leagues and for promoted clubs start from defaults.

**Low**
14. Possible home/away or date errors in about 32 basketball games.
15. Same-day cricket order is arbitrary.
16. TheSportsDB-sourced football results are for development only (terms).
17. The CricketData adapter is unverified.

## 5. What is in good shape

Chronological validation everywhere (no random splits); causal feature replay with probes that catch planted leaks; football calibrated within noise and current to the day; every importer idempotent with checks; no NaN or infinite values; models and reports saved with versions and dates.

## 6. Plan, by phase

| Phase | Addresses |
|---|---|
| 2 + 4 + 5 (done: see ml-comparison-2026-11.md) | weaknesses 2, 3, 4, 5, 7, 10: model zoo with Optuna, Platt and isotonic calibration, a train/validation/test protocol with one untouched test window, old vs new model on the same matches |
| 3 | 8, 9, 11, 12: windows, head to head, consistency, venue, missing-value flags, weather (Open-Meteo) |
| 6 | 6: registry, evaluation of stored predictions, promotion rule |
| 7 and 8 | live engine and dashboard; need a live data source and a decision about the frontend |
