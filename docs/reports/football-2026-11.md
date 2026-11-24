# Football model report: 2025 and 2026 data, tuning and results

Written 2026-11-24 and updated the same day after the two-month data gap was filled. Data runs through 2026-11-23. Leagues: Premier League, La Liga, Serie A, Bundesliga, Ligue 1.

## 1. Summary

- **New data:** 17 months of results that the model had never seen: the full 2025-26 season (1,751 matches) and 2026-27 up to 23 November (548 matches). The upcoming 2026-27 schedule (1,203 fixtures) came with it.
- **Result:** on the 2,263 matches played from August 2025 to 23 November 2026, which the tuning never saw, the model's score (RPS, lower is better) is **0.2030 against 0.2302** for a model that only knows the base rates, which is **11.8% better**. Three-way accuracy is **52.0%** against 44.2% for picking the home team every time.
- **What helped:** feeding in the new results improved the score by about 0.0040 RPS (significant). Tuning the settings added a further 0.0015 (small, but its 95% interval stays above zero).
- **The two-month gap is closed.** The free results source had no scores for 9 October to 22 November. A second source, TheSportsDB, supplied 295 of the 297 missing results, and every score it reported for a match we already had a trusted result for agreed (370 of 370).
- **Honest size of the gain:** modest. This is a results-only model, so there is no leap beyond what results alone can tell. Betting markets, which use far more information, are not expected to be matched.
- **Not possible:** a comparison with bookmaker odds (see section 2) and the Champions League after 2024-25.

## 2. Data

| Source | Used for | Licence |
|---|---|---|
| **openfootball** (`football.json`, github.com/openfootball) | results and the schedule for 2022-23 to 2026-27, five leagues | **CC0 1.0**, public domain (confirmed from the repository's `LICENSE.md`) |
| **TheSportsDB** (free development key) | the 295 results openfootball lacked for 9 Oct to 22 Nov 2026 | free key for development projects; a paid subscription is needed to publish an app, and the API may not be resold. **Replace before this becomes a product** (section 6) |
| API-Sports (existing) | 2022-23 to 2024-25 history, and 3 matches on 23 Nov 2026 | your plan's terms (free plan: seasons 2022 to 2024, and yesterday through tomorrow only) |
| football-data.co.uk | **not used** | free for private individuals only, not for commercial products or data-training products (per the site's data page). Its 25 CSV files are still on disk in `data/football-data/` (git-ignored) at your request and are not used for anything. |

Bookmaker odds, shots and expected goals would have come from football-data.co.uk, so there is **no bookmaker benchmark** and no shots feature. openfootball and TheSportsDB give results only.

What is stored, for the five leagues:

| Period | Matches | With a score | Notes |
|---|---|---|---|
| 2022-23 to 2024-25 | 5,341 | 5,341 | API-Sports, unchanged |
| 2025-26 | 1,752 | 1,751 | openfootball; Nantes–Toulouse (17 May 2026) was awarded administratively, so it has no played result |
| 2026-27 | 1,752 | 548 | 250 openfootball + 3 API-Sports + 295 TheSportsDB; Rayo Vallecano–Athletic (10 Oct) was abandoned; 1,203 are upcoming |

**Quality checks**
- The three earlier seasons exist in both openfootball and API-Sports, so I compared them: **5,310 matches compared, 99.98% have the same score**. The one difference is 14 Dec 2024, Union Berlin: openfootball has 0–2, API-Sports has 1–1. The API-Sports value was kept; I did not check which is right.
- **TheSportsDB check:** wherever it reported a match for which we already had a trusted score (299 matches of 2025-26 from openfootball, and 71 matches of 2026-27 from openfootball and API-Sports), **all 370 agreed**. The 295 results it filled look plausible too: 2.98 goals per match against 2.77 in 2025-26, a gap of about two standard errors at that sample size. It only fills a missing score, never overwrites one, and it ignores matches it marks abandoned or awarded, which is why two matches stay empty. Each filled match records `result_source = thesportsdb`.
- No duplicate fixtures (checked within 36 hours and within 60 days of each other).
- Kick-off times in openfootball are local time, and I convert them to UTC. I confirmed that only with the Premier League opener (20:00 BST = 19:00 UTC). They don't affect training, only the timing of upcoming fixtures.

**Team names** differ between sources ("Manchester City FC" vs "Man City"). For openfootball, 123 were matched by comparing dates and scores across the overlapping seasons, 2 by normalized name, 2 by a reviewed override. **11 genuinely new clubs** were created: Sunderland, Coventry City, Hull City, Paris FC, Le Mans, Paderborn, Pisa, Málaga, Deportivo La Coruña, Real Oviedo and Racing Santander. TheSportsDB names needed 13 reviewed overrides (for example "Paris SG", "Inter Milan", "Bayern Munich").

## 3. Problems found and fixed on the way

1. **Data gap would have flattened predictions.** The feature code treated any gap of 45+ days between a team's matches as an off-season and pulled its ratings a third of the way back to average, and it did so again for every further upcoming match. With results missing from 9 Oct to 22 Nov, every current prediction would have been shrunk, some twice. Fixed: the shrink applies once per break, and a match that was played but has no score yet (stored as `provider_status = NR`) now advances the team's clock without touching its ratings. This also keeps the model safe if a source falls behind again.
2. **Duplicate fixtures.** The first version of the importer inserted second copies of 22 matches that API-Sports already held, and then a 23rd, Brentford–Everton, which was rescheduled from 21 to 23 November and fell outside the 36-hour matching window. All 23 were removed. In a league each home/away pairing happens once per season, so football now matches the same two clubs within 60 days in the same competition (basketball keeps 36 hours, because NBA pairings recur within weeks). The same rule is in the daily scheduler.
3. **Wrong season in my first gap-fill run.** It took the season from the oldest missing match (the May 2026 Nantes game), so its first 38 requests asked for 2025-26 instead of 2026-27 and filled nothing. It also happened to give the 299-match comparison above. Fixed: each season is planned separately and the planning is tested. The shared free key also returned HTTP 429 once, after my first quick burst of about ten calls, so the importer now waits and retries, caches every response, and keeps to one request every 6 seconds. About 85 requests were made in total.

## 4. Method

1. **Search:** 150 random settings combinations, each scored with the rolling backtest on matches **before 1 July 2025 only**.
2. **Ensemble weight:** the mix between the two models (linear and gradient boosting) was chosen on the same early data.
3. **Holdout:** the default and tuned settings were each fitted **once** on the 5,630 usable matches before the cutoff, then scored on the 2,263 usable matches after it (15 Aug 2025 to 23 Nov 2026). Team ratings keep updating through the holdout, but each match only sees earlier results, and the model's regression weights stay frozen.
4. **"Frozen ratings":** the same model with every result after the cutoff hidden from the ratings. The difference to the normal run shows what the new data itself is worth.
5. The tuned settings were adopted only because they beat the defaults on that holdout. That is one yes/no decision made on the holdout, so the tuned figure is very slightly optimistic.

## 5. Results

### Holdout (never seen by the search): 2,263 matches

| Model | RPS (lower is better) | Log-loss | Accuracy |
|---|---|---|---|
| Base rates only (no skill) | 0.2302 | 1.0697 | 44.2% |
| Default settings, ratings frozen at July 2025 | 0.2087 | 1.0094 | 50.9% |
| Tuned settings, ratings frozen at July 2025 | 0.2070 | 1.0037 | 50.8% |
| Default settings, with the new results | 0.2045 | 0.9955 | 52.1% |
| **Tuned settings, with the new results (final)** | **0.2030** | **0.9914** | **52.0%** |

Paired improvement in RPS, positive is better, with a bootstrap 95% interval:

| Comparison | Gain | 95% interval |
|---|---|---|
| New results vs frozen ratings (default settings) | +0.0042 | +0.0015 to +0.0070 |
| New results vs frozen ratings (tuned settings) | +0.0039 | +0.0018 to +0.0062 |
| Tuned vs default settings | +0.0015 | +0.0006 to +0.0024 |
| Tuned vs base rates | +0.0272 | +0.0222 to +0.0322 |

### By league and season (RPS, tuned; base rates in brackets)

| Segment | Matches | RPS | Better than base rates |
|---|---|---|---|
| Premier League | 482 | 0.2093 (0.2275) | 8.0% |
| La Liga | 495 | 0.1991 (0.2262) | 12.0% |
| Serie A | 497 | 0.1997 (0.2357) | 15.3% |
| Bundesliga | 391 | 0.1978 (0.2313) | 14.5% |
| Ligue 1 | 398 | 0.2095 (0.2303) | 9.0% |
| 2025-26 | 1,735 | 0.2035 (0.2293) | 11.3% |
| 2026-27 so far | 528 | 0.2013 (0.2329) | 13.6% |

### Settings changed by the tuning

| Setting | Default | Tuned | What it means |
|---|---|---|---|
| Attack/defence rating step | 0.040 | 0.020 | ratings move more slowly after each match |
| Rating warm-up | 4.0 | 3.8 | about the same |
| Recent-form weight | 0.12 | 0.056 | form averages over a longer stretch |
| Elo step | 20 | 16.6 | smaller Elo jumps |
| Home advantage (Elo points) | 60 | 49 | slightly less home advantage |
| Shrink after a long break | 33% | 19% | teams keep more of their rating over the summer |
| Older matches lose half their weight after | 365 days | 180 days | the regression leans on recent seasons |
| Weight on the linear model in the ensemble | 0.50 | 0.60 | rest on gradient boosting |

The search improved its own backtest from 0.2007 to 0.2001, a small gain, which the holdout confirmed.

### Calibration on the holdout (does "60%" happen 60% of the time?)

Home win, predicted → observed: 16% → 16% (168 matches), 25% → 24% (383), 35% → 39% (552), 44% → 47% (465), 55% → 57% (344), **64% → 71% (236), 74% → 85% (92)**. Draws: 17% → 12% (245), 25% → 26% (1,987), 30% → 32% (31). Bins with fewer than 15 matches are not shown. The model is well calibrated in the middle and **underconfident about strong home favourites** (a 74% call came true 85% of the time). I did not add a correction: each one has to be tested out of sample first (on synthetic football it made results worse; on real cricket it helped some segments and hurt others). It's worth testing here.

### Final model

Retrained on all 7,893 usable matches through 23 Nov 2026 with the tuned settings. Its own rolling backtest: RPS 0.2023 against 0.2321 for base rates (12.9% better), log-loss 0.9850, accuracy 52.8%. The linear model beat the ensemble by 0.0002, which is a tie.

### Predictions

106 fixtures from 27 November to 6 December 2026 are stored in the `predictions` table. Examples:

| Match | Home | Draw | Away | Expected goals | Likeliest score |
|---|---|---|---|---|---|
| Hamburger SV – Bayern München | 11.2% | 15.3% | 73.5% | 1.02 – 2.76 | 1–2 |
| Paris Saint Germain – Lorient | 71.6% | 17.4% | 11.1% | 2.39 – 0.83 | 2–0 |
| Arsenal – Manchester City | 51.2% | 24.2% | 24.7% | 1.76 – 1.15 | 1–1 |
| Everton – Liverpool | 30.8% | 26.1% | 43.1% | 1.23 – 1.50 | 1–1 |
| Werder Bremen – Gladbach | 55.8% | 23.1% | 21.1% | 1.87 – 1.07 | 1–1 |

The gap data matters for current games: before it was filled, Arsenal–Manchester City was 45.0% / 24.6% / 30.4%, because Arsenal's October and November results were missing.

## 6. Limits

- **TheSportsDB is a development source.** The free key is public and shared (it rate-limits without warning), and its terms require a paid subscription to publish an app. About 85 requests were made. Before Tusky is released as a product, the 295 filled results should come from a licensed source (a paid API-Sports plan, which also has the Champions League), or from openfootball once it catches up; the `result_source` field marks exactly which rows to refresh.
- **No Champions League or cup matches** after 2024-25, so clubs' European form is missing from their ratings, and there are no Champions League predictions. The 60-day fixture-matching rule assumes each pairing happens once per season, which is true for the five leagues but not for cups.
- **Results only.** No injuries, line-ups, shots, expected goals or odds, which is where most of the remaining accuracy is.
- **The holdout's regression weights were frozen for 17 months**; the shipped model is refitted on everything, so its real-world error should be a little better than the holdout shows.
- Draw probabilities at the low end are slightly too high, and strong home favourites are underrated (see calibration).
- Two matches have no played result (one abandoned, one awarded), and one score disagreement with API-Sports (Union Berlin, December 2024) was left unresolved.

## 7. What would improve it most

1. A licensed source for the current season, which also brings the Champions League.
2. A licensed source for shots, expected goals and injuries, then a bookmaker-odds benchmark.
3. A calibration correction for strong favourites, adopted only if it improves later matches, as was done for cricket.

## 8. Reproduce

```powershell
npm run football:import                       # download and import openfootball (CC0), all five seasons
npm run football:fill                         # fill results openfootball lacks from TheSportsDB (slow, cached, resumable)
node ml-service/run.mjs tune --sport football --trials 150 --seed 7   # search before 2025-07-01, score the holdout once
npm run ml:train -- --sport football          # retrain on everything with the saved tuned settings
npm run ml:predict -- --sport football        # score upcoming fixtures into `predictions`
```

Data: results and fixtures from openfootball (github.com/openfootball), released under CC0 1.0. Gap results from TheSportsDB (thesportsdb.com). Earlier seasons from API-Sports.
