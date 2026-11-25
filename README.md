# Tusky: score-prediction data pipeline

Phase 1 contains the **scheduler** and the **scraper service**. The REST API (`backend/`), the React app (`frontend/`) and rate limiting come later.

```
scheduler (node-cron)                              scrapper-service (pg-boss workers)
├─ every 6h  fetchUpcomingMatches ──► match.enrich   ─► API-Sports squads ─► players, match_players
│            API-Sports fixtures → matches              └─► player.history (missing / stale players)
└─ every 1m  promoteLiveMatches  ──► player.history ─► LangGraph agent ─► player_stats, player_insights
             scheduled→live→completed  match.live-poll ─► stub (toss / goals / penalties come later)
                                   all state + queues in Postgres (Docker)
```

## Setup

```bash
cp .env.example .env        # then fill in the keys below
npm install
npm run db:up               # Postgres 17 on localhost:5433
npm run db:migrate          # applies migrations + seeds sports
```

| Key | Needed for | Get it |
|---|---|---|
| `APISPORTS_KEY` | fixtures, squads, stats | dashboard.api-sports.io (free: 100 req/day per sport) |
| `GOOGLE_API_KEY` | primary LLM (Gemini) | aistudio.google.com |
| `GROQ_API_KEY` | fallback LLM | console.groq.com |
| `TAVILY_API_KEY` | web research | tavily.com (optional; without it, profiles rely on API stats only) |
| `ANTHROPIC_API_KEY` | last-resort LLM | optional |

## Run

```bash
npm run dev:scheduler -- --once   # one sync, then exit (good first test)
npm run dev:scheduler             # cron mode (syncs immediately on boot)
npm run dev:scraper               # workers
npm run db:studio                 # browse the tables
```

Tools:

```bash
npm run scrape:player -- --player-id 42                         # run the agent for one player, print the result
npm run scrape:player -- --external-id 276 --sport football
npm run player:import -- ./data/sample-players.json              # manual player history
```

## Player-history agent (LangGraph)

`collectApiStats → webResearch → extract → validate ─(errors, 1 retry)→ extract`, then `persist`

- **collectApiStats**: per-season stats from API-Sports, stored straight away (`player_stats`, source `api`). Uses no LLM tokens.
- **webResearch**: 3 Tavily queries (form, home/away and big-match splits, injuries). Results are de-duplicated and trimmed to about 12k characters.
- **extract**: structured output against `PlayerHistorySchema` (`packages/shared`). Providers are tried in order: **Gemini → Groq → Claude**, skipping any without a key.
- **validate**: removes source URLs the model invented, requires citations when documents exist, and caps `confidence` by how much evidence there is. If validation fails twice, the profile is stored as `needs_review`.
- Every run writes a `scrape_runs` row recording the provider, model, tokens used and any errors.

Manual imports (`source = manual`) mark the player `ready`, so the scraper skips them until `HISTORY_STALE_DAYS` has passed.

## Football results beyond the free API plan (openfootball)

The free API-Sports plan only allows the 2022 to 2024 seasons, so newer football results come from [openfootball](https://github.com/openfootball/football.json), which is released under CC0 (public domain). It has results and schedules only, no shots or odds.

```bash
npm run football:import                                  # downloads data/openfootball/<season>/<league>.json and imports all five seasons
npm run football:import -- --seasons 2026-27 --refresh  # just refresh the current season (the source updates daily)
node ml-service/run.mjs tune --sport football --trials 150 --seed 7   # tune the settings before 2025-07-01, score a one-shot holdout after it
npm run ml:train -- --sport football                     # retrains with the saved tuned settings (ml-service/artifacts/football/config.json)
```

- Team names are matched to the existing API-Sports teams by comparing dates and scores in the seasons both sources cover. Genuinely new clubs are created. Names that look like an existing club but couldn't be matched are printed as `CHECK possible duplicates`; add a line to `OVERRIDES` in `ml-service/tusky_ml/ingest/openfootball.py` if it is the same club.
- Matches that were played but have no score in the source yet are stored as completed with `provider_status = 'NR'` and null scores. The feature replay uses them as rest days but never as results, and a later import fills in the score.
- `npm run football:fill` fills results that openfootball lacks yet (it lags the real season by weeks) from [TheSportsDB](https://www.thesportsdb.com)'s free development key. It is deliberately slow (one request every 6 seconds), caches every response in `data/thesportsdb/`, and can be re-run safely. It only fills a missing score, never overwrites one, ignores abandoned or awarded matches, and marks each filled match with `raw.result_source = thesportsdb`. The key is public and shared, and TheSportsDB's terms require a paid subscription to publish an app, so use a licensed source before releasing a product.
- A fixture that is already stored by another source (same two clubs, same competition, within 60 days) is never duplicated; the daily scheduler follows the same rule.
- The results of the last full run are in [docs/reports/football-2026-11.md](docs/reports/football-2026-11.md).
- football-data.co.uk offers CSVs with shots and odds, but its terms limit use to private individuals and exclude commercial and data-training products, so this project does not use it.

## Measuring and comparing models

```bash
npm run ml:audit                               # data quality, leakage probes, overfitting, calibration, staleness (artifacts/audit.json)
node ml-service/run.mjs compare --trials 25    # model zoo + Optuna + calibration on identical chronological windows, one untouched test window
node ml-service/.venv/Scripts/python.exe ml-service/experiments/t20_calibration.py   # calibration methods compared on cricket T20 (run from ml-service/)
```

- Reports: [docs/reports/ml-audit-2026-11.md](docs/reports/ml-audit-2026-11.md) and [docs/reports/ml-comparison-2026-11.md](docs/reports/ml-comparison-2026-11.md). Reliability diagrams are in `docs/reports/figures/`.
- Final report (all phases, original vs improved, limitations): [docs/reports/final-report-2026-11.md](docs/reports/final-report-2026-11.md).
- Phase 3 (new features incl. weather, none adopted): [docs/reports/phase3-features-2026-11.md](docs/reports/phase3-features-2026-11.md).
- Finding so far: XGBoost, LightGBM, CatBoost, random forest, logistic regression, their ensemble and a blend with the existing models do not beat the existing models by a statistically meaningful margin; calibration helps cricket T20 only, and production's per-segment temperature scaling beats Platt and isotonic regression there.
- The Python environment lives in `ml-service/.venv`. Installing the large ML wheels inside a OneDrive folder can stall for many minutes; if that happens, create the environment outside OneDrive.

## Cricket data

History comes from [Cricsheet](https://cricsheet.org): free ball-by-ball data under the Open Data Commons Attribution licence, so the app must credit Cricsheet. Upcoming fixtures, toss and live state come from CricketData.org.

```bash
npm run cricket:import -- --dataset ipl      # downloads data/cricsheet/ipl_json.zip (5 MB) and imports it
npm run cricket:import -- --dataset t20s     # also: odis, tests, it20s, recent (last 30 days), all (149 MB)
npm run cricket:import -- --path ./some.zip  # a local zip, folder of .json, or one file
npm run cricket:import -- --dataset recent   # incremental: unchanged files are skipped by content hash
```

- It writes `matches` (format, toss, winner, result type: normal/dls/super_over/tie/no_result/draw), `cricket_innings` (with powerplay/middle/death splits), `deliveries` (every ball), `match_lineups`, `venues` (Cricsheet venue IDs), `players` (Cricsheet register IDs) and `teams`.
- Teams use one key for every source, `m:<name>` or `f:<name>`. Franchise renames (Kings XI Punjab → Punjab Kings, and so on) map to the same team, so history carries across the rename. The list lives in both `tusky_ml/ingest/cricsheet.py` and `packages/shared/src/cricket.ts`, and the two must match; a parity test checks this.
- If a match already exists from CricketData (same teams, same date), the Cricsheet result attaches to that row instead of creating a duplicate.
### Cricket predictions

```bash
npm run cricket:train                  # all formats with enough data: backtest report + saved models
npm run cricket:train -- --format T20  # one format
npm run cricket:evaluate               # backtest report only, nothing saved
npm run cricket:predict                # score scheduled matches in the next 14 days -> predictions
npm run cricket:predict -- --dry-run
```

- **One model set per format** (T20, ODI, Test), with state kept separately per format.
- **Two win models.** *Pre-toss* uses each side's most recent XI. *Post-toss* adds the toss, the batting order and the announced XI. Prediction automatically uses the post-toss model once the toss is known.
- **Features** are all computed from matches before kick-off:
  - Elo and form over the last 5/10/20 matches
  - batting and bowling run rates, wickets lost and taken
  - head to head (shrunk when there are few meetings)
  - the venue's average first-innings score and chasing win rate, plus team familiarity with the venue
  - playing-XI batting average and strike rate, and bowling economy and strike rate, built from ball-by-ball data
  - experience and availability (the share of regulars playing), rest days, gender and club vs international
- **Win models** compare logistic regression, gradient boosting and their ensemble in a rolling backtest, against a coin flip and an Elo-only model. Probabilities are symmetrized, so swapping the two teams mirrors them exactly. For Tests, draws are a third outcome.
- **Calibration:** a temperature is fitted on earlier folds and kept only if it improves later folds. The report records the evidence either way.
- **First innings:** quantile gradient boosting gives a 10/50/90% projection, with the range widened by conformal calibration so that it covers about 80%. Before the toss, both batting-order scenarios are projected.
- **Reports** break accuracy down by segment (men's internationals, men's club, women, close matches), because mismatched associate T20Is inflate the headline number.
- Cricket predictions are stored in `predictions` with `exp_home_score`/`exp_away_score` left null; the projection lives in `details.first_innings`.

- For fixtures, add `cricket` to `ENABLED_SPORTS` and set `CRICKETDATA_API_KEY`. The adapter has **not been checked against the live API yet**; see `packages/providers/src/cricketData/adapter.ts`.

## Match predictions (ml-service, Python)

`ml-service/` trains on completed matches in Postgres and writes home/draw/away probabilities and expected scores to the `predictions` table. It needs Python 3.11+.

```bash
npm run ml:setup                                                   # once: creates ml-service/.venv
npm run history:backfill -- --sport football --seasons 2022,2023   # training data, ~1 request per league-season
npm run history:backfill -- --sport basketball --seasons 2022-2023,2023-2024 --leagues 12
npm run ml:train                     # backtest, pick the best model, save to ml-service/artifacts/
npm run ml:predict                   # score scheduled matches in the next 14 days -> predictions
npm run ml:predict -- --dry-run      # print only
npm run ml:evaluate                  # backtest report, saves nothing
npm run ml:run                       # service loop: predict hourly, retrain weekly
npm run ml:test                      # Python tests
node ml-service/run.mjs demo         # train + predict on a synthetic league, no DB or API key needed
node ml-service/run.mjs bench        # compare model kinds against an oracle on synthetic leagues
```

- **Features** are leak-free: every match is replayed in kick-off order, so a match only sees results from before it. Features cover opponent-adjusted attack/defence ratings (updated online after each match), Elo (goal or margin weighted, regressed after the off-season), the recent scoring and conceding average overall and at the venue, the competition's scoring level, rest days and games played. Football training down-weights matches by age (half-life 365 days).
- **Football**: a Poisson model predicts each side's expected goals. A Dixon-Coles scoreline grid then gives home/draw/away, the top 5 scores, over/under 1.5/2.5/3.5, both teams to score and clean sheets.
- **Basketball**: a points regression gives each side's expected points. A normal distribution for the margin and the total, with its spread measured on held-out games, gives the win probability, spread, total and over/under. There are no draws (overtime).
- **Model selection**: three candidates (GLM or linear, gradient boosting, and an equal-weight ensemble of the two) are scored with a rolling-origin backtest. The newest half of the matches is split into 4 blocks, and each block is predicted by a model fitted only on the matches before it. Selection uses RPS for football and log-loss for basketball, and the winner is refitted on all the data. A tested temperature-calibration layer made held-out results worse, so it is not used. The report in `artifacts/<sport>/report.json` compares it with a base-rate baseline and includes a calibration table.
- The scheduler's daily `syncRecentResults` job re-fetches the last two days so finished matches get their scores and become new training data.

## Budget notes (free tiers)

- Fixtures cost **1 request per day per sport**, regardless of the league filter.
- Enriching one football match costs **2 squad requests plus 2 stats requests per player**, about 100 requests for a full match. On the free tier that is roughly one fully enriched match per day. Jobs that hit the daily budget (`APISPORTS_DAILY_BUDGET`) are **deferred to 00:05 UTC**, not failed. To get more out of it, use `FOOTBALL_LEAGUE_IDS`, `MAX_PLAYERS_PER_TEAM` or a paid plan.
- Free API-Football plans only allow some seasons. Seasons you can't access are skipped, and the LLM research fills the gap.
- API-Sports has **no cricket API**. A cricket adapter would need a different provider; add it under `packages/providers` by implementing `SportAdapter`.

## Layout

```
packages/shared     env (zod), logger (pino), pg-boss queues, zod schemas
packages/db         drizzle schema, client, upsert helpers, migrations
packages/providers  API-Sports client (quota guard + throttle), football/basketball adapters
scheduler/          cron jobs
scrapper-service/   workers, LangGraph agent, CLI scripts
ml-service/         Python: features, models, train/predict CLI (writes `predictions`)
```

## Tests

```bash
npm test   # unit tests + pipeline integration test (uses a separate tusky_test DB; skipped if Postgres is down)
npm run typecheck
npm run ml:test   # Python: features, models, and a Postgres round trip against tusky_test
```

`npm test` goes through `test/run-vitest.mjs`, which changes the drive letter to uppercase. Vitest 5 breaks on Windows when the working directory starts with a lowercase `c:\`.

## Retraining and promotion

Models are not swapped blindly. `npm run ml:retrain` (and the `ml:run` loop, when a model is older than `RETRAIN_DAYS`) runs a cycle per model:

```bash
npm run ml:retrain -- --dry-run          # decide and report, change nothing
npm run ml:retrain -- --target football  # football, basketball, cricket-T20, cricket-ODI, cricket-Test (default: all)
npm run ml:registry                      # versions, the production pointer and the decision history
npm run ml:rollback -- --target football # put the previous production version back
```

- The matches played since the production model's data ended are split in time. A challenger is trained on everything before the newest half and compared with the production model on that held-out half, match by match.
- It is promoted only if its log-loss is better with the paired 95% bootstrap interval entirely above zero and its calibration error is not worse than the noise floor. Ties keep the current model. Fewer than 300 new matches (150 in the window) means nothing is done.
- On promotion the same pipeline is refitted on all data and stored as a new immutable version under `ml-service/artifacts/registry/<model>/`; the old version stays and can be restored. Every decision, including rejections and skips, is logged there with its numbers, together with a drift flag (the production model doing worse on fresh matches than its recorded validation loss).
