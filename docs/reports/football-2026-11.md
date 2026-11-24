# Football model report: 2025 and 2026 data, tuning and results

Written 2026-11-24. Data runs through 2026-11-23. Leagues: Premier League, La Liga, Serie A, Bundesliga, Ligue 1.

## 1. Summary

- **New data:** 17 months of results that the model had never seen: the full 2025-26 season (1,751 matches) and 2026-27 up to 20 September, plus 3 matches from 23 November. The upcoming 2026-27 schedule (1,203 fixtures) came with it.
- **Result:** on the 1,968 matches played from August 2025 to 23 November 2026, which the tuning never saw, the model's score (RPS, lower is better) is **0.2038 against 0.2299** for a model that only knows the base rates, which is **11.4% better**. Three-way accuracy is **51.4%** against 43.7% for picking the home team every time.
- **What helped:** feeding in the new results improved the score by 0.0045 RPS (significant). Tuning the settings added a further 0.0012 (small, but its 95% interval stays above zero).
- **Honest size of the gain:** modest. This is a results-only model, so there is no ceiling-breaking leap here. Betting markets, which use far more information, are not expected to be matched.
- **Not possible:** a comparison with bookmaker odds (see section 2), the Champions League after 2024-25, and about 300 matches played between 9 October and 22 November 2026, because the free source has no scores for them yet.

## 2. Data

| Source | Used for | Licence |
|---|---|---|
| **openfootball** (`football.json`, github.com/openfootball) | results and the schedule for 2022-23 to 2026-27, five leagues | **CC0 1.0**, public domain (confirmed from the repository's `LICENSE.md`) |
| API-Sports (existing) | 2022-23 to 2024-25 history, and 3 matches on 23 Nov 2026 | your plan's terms (free plan: seasons 2022 to 2024, and yesterday through tomorrow only) |
| football-data.co.uk | **not used** | free for private individuals only, not for commercial products or data-training products (per the site's data page). Its 25 CSV files are still on disk in `data/football-data/` (git-ignored) at your request and are not used for anything. |

Bookmaker odds, shots and expected goals would have come from football-data.co.uk, so there is **no bookmaker benchmark** and no shots feature. openfootball has results only.

What is stored, for the five leagues:

| Period | Matches | With a score | Notes |
|---|---|---|---|
| 2022-23 to 2024-25 | 5,341 | 5,341 | API-Sports, unchanged |
| 2025-26 | 1,752 | 1,751 | openfootball; 1 Ligue 1 match has no score in the source |
| 2026-27 | 1,752 | 253 | 250 openfootball + 3 API-Sports; **296 played but no score yet**; 1,203 upcoming |

**Quality checks**
- The three earlier seasons exist in both openfootball and API-Sports, so I compared them: **5,310 matches compared, 99.98% have the same score**. The one difference is 14 Dec 2024, Union Berlin: openfootball has 0–2, API-Sports has 1–1. The API-Sports value was kept; I did not check which is right.
- No duplicate fixtures (checked within 36 hours and within 60 days of each other).
- Kick-off times in openfootball are local time, and I convert them to UTC. I confirmed that only with the Premier League opener (20:00 BST = 19:00 UTC). They don't affect training, only the timing of upcoming fixtures.

**Team names** differ between sources ("Manchester City FC" vs "Man City"). 123 were matched by comparing dates and scores across the overlapping seasons, 2 by normalized name, 2 by a reviewed override (ES Troyes AC and SV 07 Elversberg, which had been created as duplicates and were caught by a check). **11 genuinely new clubs** were created: Sunderland, Coventry City, Hull City, Paris FC, Le Mans, Paderborn, Pisa, Málaga, Deportivo La Coruña, Real Oviedo and Racing Santander.

## 3. Problems found and fixed on the way

1. **Data gap would have flattened predictions.** The feature code treated any gap of 45+ days between a team's matches as an off-season and pulled its ratings a third of the way back to average, and it did so again for every further upcoming match. With results missing from 9 Oct to 22 Nov, every current prediction would have been shrunk, some twice. Fixed: the shrink applies once per break, and a match that was played but has no score yet (stored as `provider_status = NR`) now advances the team's clock without touching its ratings.
2. **Duplicate fixtures.** The first version of the importer inserted second copies of 22 matches that API-Sports already held, and then a 23rd, Brentford–Everton, which was rescheduled from 21 to 23 November and fell outside the 36-hour matching window. All 23 were removed. In a league each home/away pairing happens once per season, so football now matches the same two clubs within 60 days in the same competition (basketball keeps 36 hours, because NBA pairings recur within weeks). The same rule is in the daily scheduler, so API-Sports fixtures attach to existing rows instead of duplicating them, and a club that is new to a source is matched to an identically named existing club.

## 4. Method

1. **Search:** 150 random settings combinations, each scored with the rolling backtest on matches **before 1 July 2025 only**.
2. **Ensemble weight:** the mix between the two models (linear and gradient boosting) was chosen on the same early data.
3. **Holdout:** the default and tuned settings were each fitted **once** on the 5,630 usable matches before the cutoff, then scored on the 1,968 usable matches after it (15 Aug 2025 to 23 Nov 2026). Team ratings keep updating through the holdout, but each match only sees earlier results, and the model's regression weights stay frozen.
4. **"Frozen ratings":** the same model with every result after the cutoff hidden from the ratings. The difference to the normal run shows what the new data itself is worth.
5. The tuned settings were adopted only because they beat the defaults on that holdout. That is one yes/no decision made on the holdout, so the tuned figure is very slightly optimistic.

## 5. Results

### Holdout (never seen by the search): 1,968 matches

| Model | RPS (lower is better) | Log-loss | Accuracy |
|---|---|---|---|
| Base rates only (no skill) | 0.2299 | 1.0728 | 43.7% |
| Default settings, ratings frozen at July 2025 | 0.2094 | 1.0151 | 50.2% |
| Tuned settings, ratings frozen at July 2025 | 0.2078 | 1.0100 | 50.0% |
| Default settings, with the new results | 0.2050 | 1.0008 | 51.5% |
| **Tuned settings, with the new results (final)** | **0.2038** | **0.9975** | **51.4%** |

Paired improvement in RPS, positive is better, with a bootstrap 95% interval:

| Comparison | Gain | 95% interval |
|---|---|---|
| New results vs frozen ratings (default settings) | +0.0045 | +0.0016 to +0.0074 |
| New results vs frozen ratings (tuned settings) | +0.0041 | +0.0018 to +0.0064 |
| Tuned vs default settings | +0.0012 | +0.0003 to +0.0022 |
| Tuned vs base rates | +0.0261 | +0.0209 to +0.0314 |

### By league and season (RPS, tuned; base rates in brackets)

| Segment | Matches | RPS | Better than base rates |
|---|---|---|---|
| Premier League | 423 | 0.2074 (0.2277) | 8.9% |
| La Liga | 436 | 0.2014 (0.2258) | 10.8% |
| Serie A | 428 | 0.2028 (0.2354) | 13.8% |
| Bundesliga | 337 | 0.1974 (0.2315) | 14.7% |
| Ligue 1 | 344 | 0.2097 (0.2293) | 8.5% |
| 2025-26 | 1,735 | 0.2035 (0.2293) | 11.3% |
| 2026-27 so far | 233 | 0.2055 (0.2339) | 12.1% |

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

Home win, predicted → observed: 16% → 17% (151 matches), 25% → 24% (328), 35% → 39% (483), 44% → 46% (408), 55% → 56% (298), **64% → 71% (202), 74% → 83% (77)**. Draws: 17% → 12% (207), 25% → 27% (1,731), 30% → 30% (30). Bins with fewer than 15 matches are not shown. The model is well calibrated in the middle and **underconfident about strong home favourites** (a 74% call came true 83% of the time). I did not add a correction: each one has to be tested out of sample first (on synthetic football it made results worse; on real cricket it helped some segments and hurt others). It's worth testing here.

### Final model

Retrained on all 7,598 usable matches through 23 Nov 2026 with the tuned settings. Its own rolling backtest: RPS 0.2022 against 0.2320 for base rates (12.9% better), log-loss 0.9867, accuracy 52.6%. The linear model beat the ensemble by 0.0001, which is a tie.

### Predictions

106 fixtures from 27 November to 6 December 2026 are stored in the `predictions` table. Examples:

| Match | Home | Draw | Away | Expected goals | Likeliest score |
|---|---|---|---|---|---|
| Hamburger SV – Bayern München | 10.6% | 14.6% | 74.8% | 1.04 – 2.88 | 1–2 |
| Paris Saint Germain – Lorient | 69.6% | 18.0% | 12.4% | 2.36 – 0.90 | 2–0 |
| Arsenal – Manchester City | 45.0% | 24.6% | 30.4% | 1.67 – 1.33 | 1–1 |
| Everton – Liverpool | 32.4% | 25.7% | 41.9% | 1.30 – 1.51 | 1–1 |
| Werder Bremen – Gladbach | 49.1% | 24.3% | 26.6% | 1.73 – 1.22 | 1–1 |

## 6. Limits

- **Two months of results are missing** (9 Oct to 22 Nov 2026, 296 matches across the five leagues). Ratings and form for the five leagues are therefore about two months old, apart from 3 matches on 23 Nov. This is the biggest weakness for current predictions.
- **No Champions League or cup matches** after 2024-25, so clubs' European form is missing from their ratings, and there are no Champions League predictions.
- **Results only.** No injuries, line-ups, shots, expected goals or odds, which is where most of the remaining accuracy is.
- **The holdout's regression weights were frozen for 17 months**; the shipped model is refitted on everything, so its real-world error should be a little better than the holdout shows.
- Draw probabilities at the low end are slightly too high, and strong home favourites are slightly underrated (see calibration).
- One score disagreement with API-Sports (Union Berlin, December 2024) was left unresolved.

## 7. What would improve it most

1. **Fill the two-month gap:** a free football-data.org key (the free tier lists all five leagues plus the Champions League, but its season access and terms still need checking), or a paid API-Sports plan, which also brings the Champions League.
2. A licensed source for shots, expected goals and injuries, then a bookmaker-odds benchmark.
3. A calibration correction for strong favourites, adopted only if it improves later matches, as was done for cricket.

## 8. Reproduce

```powershell
npm run football:import                       # download and import openfootball (CC0), all five seasons
node ml-service/run.mjs tune --sport football --trials 150 --seed 7   # search before 2025-07-01, score the holdout once
npm run ml:train -- --sport football          # retrain on everything with the saved tuned settings
npm run ml:predict -- --sport football        # score upcoming fixtures into `predictions`
```

Data: results and fixtures from openfootball (github.com/openfootball), released under CC0 1.0. Earlier seasons from API-Sports.
