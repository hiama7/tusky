# Final report: ML audit and improvement (Phases 1 to 9), 26 November 2026

Every number here comes from a measurement in the earlier reports or from a run on 26 November 2026. Where something could not be measured or was not built, it says so. No accuracy claim is made beyond what the untouched test windows show.

## 1. The answer in short

- **The existing models were not beaten.** Five new algorithm families (random forest, XGBoost, LightGBM, CatBoost, tuned logistic regression), their ensemble, a blend with the old models, probability calibration, and about twenty new feature groups including weather: none improved on the existing models by a margin that survives a paired 95% interval on an untouched test window. The existing models therefore stay in production. The honest "percentage improvement of the new model over the original" is **0%, within noise**.
- **What did improve** is the data, the safety of the process, and the evidence:
  - The football model now runs on data through 23 November 2026, and a gap of two months was closed. On the 2,263 holdout matches, the new results and tuned settings together are 2.7% better in RPS than the same model with ratings frozen at July 2025 (0.2030 against 0.2087).
  - Leakage tests, a chronological comparison protocol, calibration tooling and reliability diagrams now exist and are tested.
  - A model is no longer replaced just because it is old: it must beat the production model on held-out matches (Phase 6).
- **Not done:** Phase 7 (live prediction) and Phase 8 (dashboard). They are blocked on two decisions from you (section 8).

## 2. Phase status

| Phase | Status | Outcome | Report |
|---|---|---|---|
| 1 Audit | Done | No leakage; weaknesses ranked; two premises in the brief did not match the project (no Cricbuzz scraper, no existing frontend) | [ml-audit-2026-11.md](ml-audit-2026-11.md) |
| 2 Algorithms | Done | None beats the existing models; the limit is information, not the algorithm | [ml-comparison-2026-11.md](ml-comparison-2026-11.md) |
| 3 Features | Done | Nothing adopted, weather included | [phase3-features-2026-11.md](phase3-features-2026-11.md) |
| 4 Calibration | Done | Helps cricket T20 only, and production's per-segment temperature scaling already beats Platt and isotonic | comparison report, section 4 |
| 5 Validation | Done | Chronological windows, one untouched test window per task, paired bootstrap | comparison report, section 2 |
| 6 Retrain and promote | Done | Registry, promotion rule, rollback; not yet exercised on real data (no new matches) | README, "Retraining and promotion" |
| 7 Live prediction | **Not done** | Blocked: no Cricbuzz scraper exists in the repo, and I have not verified a live source | n/a |
| 8 Dashboard | **Not done** | Blocked: there was no frontend; a `frontend/PREDICTX/` folder appeared during the session and is not mine | n/a |
| 9 Final test and report | Done | This report | |

## 3. Original against improved

"Original" is the model in production when the audit started, refitted on the training window only; "improved" is the best candidate selected by validation evidence. All on windows the choice never saw.

| Task | Test matches | Base rates | Original | Best selected on validation | Difference, 95% interval |
|---|---|---|---|---|---|
| Football (log-loss) | 2,263 | 1.0698 | **0.9891** | blend 0.9881 | +0.11%, −0.0020 to +0.0041 |
| Basketball (log-loss) | 1,314 | 0.6917 | **0.6081** | blend 0.6079 | +0.03%, −0.0037 to +0.0038 |
| Cricket T20 (log-loss) | 1,954 | 0.6931 | **0.5378** (calibrated, as deployed) | XGBoost 0.5480 uncalibrated (comparison report); with the new features and the same calibration, ensemble 0.5383 | −0.09% for the new-feature ensemble (−0.0066 to +0.0055 in log-loss); other new models level or worse |
| Cricket ODI (log-loss) | 493 | 0.7091 | **0.6358** | XGBoost 0.6356 | +0.03%, −0.0116 to +0.0120 |
| Cricket Test, 3-way (log-loss) | 196 | 1.0278 | **0.9132** | ensemble 0.9161 | −0.32%, −0.0233 to +0.0167 |

Positive means better. Every interval includes zero, so these are ties. The cricket T20 original is the production model with its per-segment temperature scaling, which means the "calibration gain" over raw outputs (0.5518 to 0.5378, 2.5%) was already in production and is not an improvement made during this work.

Other metrics on the same test windows, existing models: accuracy football 52.5% (AUC 0.661), basketball 66.4% (0.721), T20 72.3% (0.799), ODI 62.3% (0.687), Test 57.7%. These are measured, not targets. For scale, picking the home team every time gets 44.2% in football.

## 4. Best algorithm

There is no meaningful winner. Seven learners land within about 1% of each other on every task:

- **Football:** the existing Poisson model with a Dixon-Coles scoreline grid, which beats every classifier. A plausible reason is that it learns from goal counts, which carry more information than the win/draw/loss label.
- **Basketball:** the existing ensemble (a points regression with a normal margin).
- **Cricket:** the existing logistic/boosting models. On single windows XGBoost or random forest sometimes scored best (ODI random forest 0.6330, Test XGBoost 0.9035), but never when chosen from validation evidence, and never with an interval above zero.
- **Small formats:** cricket Test (196 test, 101 validation matches) and ODI (493 test) cannot rank models; their intervals are larger than every difference seen.

Tuning with Optuna (25 trials per family) did not produce an edge. I did not measure how much it improved each family over its defaults.

## 5. Calibration

| Task | Existing model ECE | Noise floor | Verdict |
|---|---|---|---|
| Football | 0.0231 | about 0.034 | within noise |
| Basketball | 0.0290 | 0.0461 | within noise |
| Cricket T20, raw | 0.0564 | 0.0367 | miscalibrated before scaling |
| Cricket T20, as deployed | 0.0252 | 0.0323 | within noise |
| Cricket ODI | 0.0675 | 0.0729 | within noise |
| Cricket Test | 0.1119 | 0.1070 | too few matches to tell |

Football's average hides a tail problem (calls of 74% came true 85% of the time over 92 matches). Reliability diagrams for every task are in `docs/reports/figures/`. Platt scaling and isotonic regression are implemented and tested, chosen only where validation shows a benefit (nowhere beyond T20, where production's method is significantly better, −0.0039 log-loss against global Platt).

## 6. What contributed, and what did not

**Contributed (measured):**
- **New football data:** the full 2025-26 season (1,751 matches) and 2026-27 to 23 November (548 matches). Using them improved RPS by +0.0042 (interval +0.0015 to +0.0070) against ratings frozen at July 2025.
- **Tuned football rating settings:** a further +0.0015 RPS (+0.0006 to +0.0024). The adoption decision was made on this holdout, so the figure is very slightly optimistic.
- **A fix that prevented harm:** missing results from 9 October to 22 November would have made the feature code treat every team as returning from an off-season and shrink every current prediction. It now shrinks once per break and handles matches that were played but have no score yet.

**Did not contribute (measured, on untouched test windows):**
- Weather: −0.0018 in T20 (−0.0049 to +0.0014) and −0.0026 in ODI (−0.0103 to +0.0051). The data are observed, not forecast, so this is the best case.
- Form windows, venue record, consistency, tournament importance, playing-XI recent form, head-to-head, congestion, win percentage, missing-data flags: no group has a reliable positive effect. Head-to-head in basketball and congestion in football were significantly harmful on test.
- The T20 ensemble gain of +0.006 that first looked real was calibration: compared on equal calibration, it is −0.0005 (−0.0066 to +0.0055).

## 7. Testing and verification (run on 26 November 2026)

| Check | Result |
|---|---|
| Python tests (`npm run ml:test`) | **135 passed** |
| TypeScript tests (`npm test`) | **74 passed** in 12 files |
| Typecheck (`npm run typecheck`) | clean |
| Audit probes (`npm run ml:audit`), re-run today | football causal probe passed (12 matches, max difference 0), noise probe skill −0.11% vs base rates; basketball passed (12 matches), noise skill −0.13%; cricket T20 causal probe passed (6 matches), noise AUC 0.490 |
| Leakage tests can fail | Planted leaks (own result, future matches) are caught; tests cover the new feature builders too |
| Test window cannot steer choices | Tests scramble the test labels and check that selections, calibrators and kept feature groups do not move |
| Existing database records | Preserved: only additive migrations (0004 adds weather and venue columns); data fills only add missing results; no row was deleted except 23 duplicate fixtures created by my own first importer run |

Not verified: the promotion path on real data. A dry run on all five models skipped every one, because there are no matches since their training data ended (latest 23 November 2026), so no evaluation window exists yet. It is exercised only on synthetic data, including the real football and cricket pipelines.

## 8. Limitations and open decisions

1. **Information, not algorithms, is the limit.** The models use match results and lineups. Injuries, availability, live state, odds and pitch reports are not available from any authorised source I have used, and no feature I could add improved the results.
2. **Small samples.** Test cricket has 888 matches, ODI 2,991, basketball three seasons. Only differences larger than about ±0.01 to ±0.02 log-loss could be detected in the small formats, so absence of a gain there is not proof of no effect.
3. **Basketball is 519 days out of date** at the audit (the free API plan has no newer season) and has no upcoming games or predictions.
4. **Data caveats.** About 32 basketball games probably have a wrong date or home/away flag in the source. One football score differs between sources (Union Berlin, 14 December 2024), unresolved.
5. **Licences before a product launch.** TheSportsDB (free development key, used for 295 football results) and Open-Meteo (free non-commercial) must be replaced or licensed. Cricsheet (ODC-BY) and openfootball (CC0) are fine with attribution. football-data.co.uk is not used because its terms exclude this use.
6. **No bookmaker benchmark**, because no authorised odds source is in use.
7. **Decisions I need for Phases 7 and 8:**
   - Where is the "existing Cricbuzz scraper"? It is not in this repository. The alternative is the CricketData.org adapter (written, unverified, needs an API key). I have not checked Cricbuzz's terms, and your earlier brief asked for authorised sources only.
   - Is the `frontend/PREDICTX/` folder the dashboard to build on, or should I build a new one? It is currently untracked.

## 9. Reproducing

```bash
npm run ml:audit                                   # leakage, overfitting, calibration, data quality
node ml-service/run.mjs compare --trials 25        # algorithms, calibration, one untouched test window
npm run ml:ablate -- --tasks cricket-T20 --weather # feature ablation (add --calibrated --groups recent for the calibrated comparison)
npm run ml:retrain -- --dry-run                    # would a retrained model be promoted?
npm run ml:test && npm test && npm run typecheck
```

Raw results are in `ml-service/artifacts/` (git-ignored): `audit.json`, `compare/`, `ablate/`.
