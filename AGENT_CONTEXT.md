# Agent Context: Tusky (score-prediction SaaS)

This file is the handoff for any agent continuing this project without prior context. Read it in full before changing anything. Update it when you finish a meaningful piece of work. The shorter [README.md](README.md) covers setup only.

Last updated: 2026-11-23. Phase 1 (scheduler + scraper) is complete, and phase 2 (the ML prediction service, `ml-service/`) is built and tested on synthetic data. All tests pass.

---

## 1. Product goal

A SaaS that predicts match outcomes and scores across sports. The pipeline:

1. A **scheduler** (cron) fetches upcoming matches worldwide and stores them in the DB.
2. The **scraper service** then finds the players in each match. For every player whose history is missing or stale, it gathers stats and **situational history**: when they tend to win or struggle, form, strengths and weaknesses, and injuries. It stores all of that.
3. Later: prediction logic, a REST API, a React frontend, rate limiting, and live in-match data.

## 2. Decisions the user has made (do not re-litigate)

| Topic | Decision |
|---|---|
| Language | TypeScript everywhere (ESM) |
| Frontend | React (**not started**, `frontend/` is empty) |
| Backend API | **FastAPI (Python)** in `backend/`, importing `tusky_ml` (changed from Express on 2026-11-23; not started) |
| ORM / DB | Drizzle ORM + PostgreSQL **in Docker** |
| Rate limiting | **Later** (meaning rate limiting on our own API; the provider quota guard already exists) |
| Sports | **Multi-sport generic**: shared columns plus sport-specific `jsonb` checked by zod |
| Fixtures/stats source | **API-Sports** (api-sports.io) |
| Player history | **LangChain / LangGraph** with a cheap LLM, **plus manual JSON import** as an alternative |
| LLM preference | **Gemini (preferred) → Groq (preferred) → Claude (use least, only as last resort)** |
| Prediction model | **Python** service in `ml-service/` (scikit-learn), reads `matches`, writes `predictions` |
| Model output | **Home/draw/away probabilities plus expected scores** (scorelines, over/under, etc.) |
| Training data | **API-Sports past seasons** via `npm run history:backfill` (about 1 request per league-season) |
| ML sports | **Football and basketball** |
| Full platform plan | **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**: the user's platform spec (cricket/football/basketball/tennis, model zoo, SHAP, live, dashboard). Follow its §10 build order |
| Cricket data | **Cricsheet** (bulk ball-by-ball history, ODC-BY) plus the **CricketData.org free tier** (fixtures, toss, XI, live) |
| Tennis | **Deferred.** Sackmann data is non-commercial; a licensed source is needed first |
| Weather | **Open-Meteo** forecast and archive (free for non-commercial use; a paid plan is needed if commercial) |
| Live events (toss, penalty…) | Design for them now, build later. The `match_events` table and a `match.live-poll` stub exist. |

User preference: they like being asked short clarifying questions before big design choices, and they want a working pipeline before API or UI work.

## 3. Current state

**Done and verified:**
- Monorepo with npm workspaces, Docker Postgres, Drizzle schema, and an initial migration (applied to the dev DB).
- Scheduler: fixture sync (every 6h) and live/completed status promotion (every 1m), with a `--once` mode.
- Scraper: `match.enrich` worker, `player.history` worker (LangGraph agent), and a `match.live-poll` stub.
- API-Sports client with a Postgres-backed daily quota guard, a throttle, and pagination. Football adapter (full) and basketball adapter (no per-season player stats; see §8).
- LLM provider chain with fallback, Tavily web search, deterministic validation, and token/cost tracking.
- Manual import CLI and a single-player debug CLI.
- `npm run typecheck` is clean. `npm test` passes 34 tests in 5 files, including a real-DB integration test of the whole pipeline.

- Phase 2 (ML): `matches.home_score/away_score`, a `predictions` table (migration 0001), `fetchSeasonResults` on both adapters, the `history:backfill` CLI, and a daily `syncRecentResults` scheduler job. `ml-service/` has leak-free features, a football Poisson model with Dixon-Coles, basketball points regression with normal margin/total distributions, and model selection plus a backtest report. `npm run ml:test` passes 15 tests, including a Postgres round trip on `tusky_test`.

- Module 1 (cricket ingestion, 2026-11-24): migration 0002 adds `venues`, `team_aliases`/`player_aliases`/`match_aliases`, match cricket columns (format, toss, winner, result_type, venue_id, neutral_venue), and `cricket_innings`, `deliveries`, `match_lineups`, `ingest_files`. `ml-service/tusky_ml/ingest/cricsheet.py` handles the Cricsheet import (`npm run cricket:import`). `packages/providers/src/cricketData/adapter.ts` is the CricketData fixtures adapter, `packages/shared/src/cricket.ts` holds the team keys, `promoteLiveMatches` now uses per-format durations, and `storeFixture` resolves aliases. The real IPL, T20I, ODI and Test data is imported into the dev DB, and the IPL import was spot-checked against known scorecards.

**Not verified:** nothing has run against the **real** API-Sports, Gemini, Groq or Tavily APIs yet, because no keys were set. Behaviour against real payloads (especially the Gemini structured-output schema and API-Sports error formats) needs a live smoke test once keys exist. See §10.

**State of the environment:** git repository on `master`. `.env` exists locally with no API keys, and the dev DB is empty except for the seeded `sports` rows.

## 4. Architecture

```
scheduler (node-cron, UTC)                         scrapper-service (pg-boss workers)
├─ FETCH_FIXTURES_CRON (0 */6 * * *)
│   fetchUpcomingMatches ──enqueue match.enrich──► enrichMatch: squads → players + match_players
│     API-Sports fixtures → competitions/teams/matches     └─enqueue player.history (missing/failed/stale)
└─ PROMOTE_LIVE_CRON (* * * * *)                   playerHistory: LangGraph agent → player_stats + player_insights
    promoteLiveMatches: scheduled→live (start_time<=now) livePoll: STUB, logs only
      → enqueue match.live-poll; live→completed after
      sport duration (football 135m, basketball 150m)
                  └──────────── Postgres: app tables (public) + pg-boss (schema `pgboss`) ────────────┘
```

- **Queue:** pg-boss (Postgres-backed, so there is no Redis). Queues use policy `stately`: at most one queued and one active job per `singletonKey`. Keys are `match:<id>`, `player:<id>` and `live:<id>`.
- **Quota exhaustion:** API-Sports throws `QuotaExceededError`. The worker then **re-sends the job with `startAfter` = next 00:05 UTC** and completes the current one, so retries are not spent while over quota.
- **Freshness:** a player is re-scraped when `history_status` is `pending` or `failed`, when it is `ready`/`needs_review` and older than `HISTORY_STALE_DAYS` (7), or when it has been stuck in `scraping` for more than 1h (a crashed worker).

### Player-history LangGraph agent (`scrapper-service/src/agent`)

```
START → collectApiStats → webResearch → extract → validate ─(errors & attempts<2)→ extract
                                                         └─(ok or out of attempts)→ persist → END
```
- `collectApiStats`: calls `adapter.fetchPlayerSeasonStats` for the current and previous season. Stats are saved right away (`player_stats`, source `api`) and missing profile fields (nationality, DOB, position, photo) are filled in. Non-quota errors are logged and the flow continues; `QuotaExceededError` propagates.
- `webResearch`: 3 Tavily queries (form, home/away and big-match splits, injuries). Results are de-duplicated by URL, each doc is cut to 1,500 characters, and the total is capped at 12,000. With no Tavily key it returns `[]`.
- `extract`: `withStructuredOutput(PlayerHistorySchema)`. The prompt is in `nodes/extract.ts`; on a retry it includes the previous validation errors.
- `validate` (deterministic, `checkDraft`): re-parses with zod, removes source URLs that are not among the research docs, requires citations and win/loss conditions when docs exist, and caps confidence by evidence (API stats plus up to 3 sources map to ceilings 0.2/0.45/0.6/0.75/0.9).
- `persist`: inserts `player_insights` (source `llm`, model `"<provider>:<model>"`) and sets `history_status`.
- Dependencies (`GraphDeps`: `fetchApiStats`, `search`, `invoke`, `persist`) are **injected**, so tests use fakes. `createDeps(overrides)` in `workers/playerHistory.ts` builds the real ones.
- LLM chain (`agent/llm.ts`): an **explicit loop** over providers rather than `.withFallbacks()`, so the code knows which provider answered and its token usage. Providers without a key are skipped. Output that fails the schema counts as a provider failure. `maxRetries: 1` and temperature 0.

## 5. File map

```
package.json            workspaces + root scripts (db:*, dev:*, scrape:player, player:import, typecheck, test)
tsconfig.base.json      strict, ESNext, moduleResolution Bundler, noEmit, allowImportingTsExtensions
tsconfig.json           root typecheck including all src/test/scripts
docker-compose.yml      postgres:17-alpine, container tusky-postgres, host port ${POSTGRES_PORT:-5433}
.env.example            every config key, with comments (copy to .env)
vitest.config.ts        test env (tusky_test DB, fake keys, throttle 0), globalSetup
test/globalSetup.ts     creates + migrates tusky_test; sets TUSKY_DB_AVAILABLE
test/run-vitest.mjs     Windows drive-letter fix wrapper (see §7)
data/sample-players.json  example manual-import file

packages/shared/src/
  env.ts                zod-validated env; loads repo-root .env no matter which workspace is the cwd
  logger.ts             pino (+pino-pretty unless NODE_ENV=production)
  queue.ts              QUEUES, job payload types, getBoss()/enqueue()/stopBoss(), queue policies
  schemas/playerHistory.ts  PlayerHistorySchema (LLM output) + ManualImportFileSchema
  schemas/stats/{football,basketball}.ts  normalized per-season stat shapes
packages/db/
  drizzle.config.ts     schemaFilter ['public'] (keeps drizzle-kit away from pgboss)
  migrations/           generated SQL (0000_*.sql)
  src/schema/core.ts    sports, competitions, teams, players, matches, match_players + enums
  src/schema/history.ts player_stats, player_insights, data_source enum
  src/schema/ops.ts     match_events, scrape_runs, provider_quota
  src/repo.ts           upsert helpers (upsertTeam/Player/Match/...), insertPlayerInsight, start/finishRun
  src/migrate.ts, seed.ts   migrate + seed sports
packages/providers/src/
  types.ts              SportAdapter interface + Normalized* types
  apiSports/client.ts   ApiSportsClient (serialized, throttled, quota guarded), errors, nextQuotaReset
  apiSports/football.ts mapping + FootballAdapter (API-Football v3)
  apiSports/basketball.ts BasketballAdapter (API-Basketball v1)
  registry.ts           getAdapter(sport), enabledAdapters()
scheduler/src/index.ts  cron boot / --once; jobs/fetchUpcomingMatches.ts, jobs/promoteLiveMatches.ts
scrapper-service/src/
  index.ts              registers pg-boss workers; fails fast if no LLM key
  defer.ts              deferUntilQuotaReset()
  workers/enrichMatch.ts, playerHistory.ts (runPlayerHistory = core unit), livePoll.ts (stub)
  agent/state.ts, graph.ts, llm.ts, tools/search.ts, nodes/*.ts
scrapper-service/scripts/scrapePlayer.ts, importPlayers.ts
tests: packages/providers/test, packages/shared/test, scheduler/test, scrapper-service/test (graph + pipeline.int)
```

## 6. Database (Drizzle, `packages/db/src/schema`)

Every provider entity has a unique key on `(sport_id, provider, external_id)`, which keeps upserts idempotent.
- `players.history_status` ∈ `pending | scraping | ready | needs_review | failed`, together with `history_updated_at`.
- `matches.status` ∈ `scheduled | live | completed | postponed | cancelled`. The upsert never moves a match from `live`/`completed` back to `scheduled`. The raw provider code is kept in `provider_status`.
- `player_stats`: unique on `(player_id, season, competition_name, source)`, with `stats` jsonb.
- `player_insights`: **append-only**; the newest row wins and **manual beats llm** (the API layer must apply that rule when reading).
- `scrape_runs`: one row per worker run (status, error, llm_provider/model, tokens_in/out, meta).
- `provider_quota`: PK `(provider, sport, day)` (UTC day), incremented atomically before each API call.
- `match_events`: for live data later. `dedupe_key` is unique.

To change the schema: edit `src/schema/*`, run `npm run db:generate`, then `npm run db:migrate`. Never hand-edit applied migrations.

## 7. Gotchas: read before coding

1. **Dependency versions are newer than most training data.** Check the `.d.ts` files in `node_modules` instead of assuming an API:
   - **pg-boss 12**: `import { PgBoss } from "pg-boss"` (named export). `work()` handlers receive an **array** of jobs. Options are `localConcurrency` and `batchSize`. Queues must be created (`createQueue`) before use; `getBoss()` does that.
   - **zod 4**, **@langchain/core 1.x**, **@langchain/langgraph 1.7** (the `Annotation.Root` API is used), **@langchain/google-genai 2.x**, **@langchain/tavily** (`TavilySearch`), **drizzle-orm 0.45** (table extras use the array form `(t) => [...]`), **node-cron 4** (`noOverlap`, `timezone`, `name` options), **dotenv 18** (`quiet: true`), **TypeScript 7**, **Vitest 5**, **pino 10**.
2. **No build step.** Workspace packages export `./src/index.ts` directly and everything runs through `tsx`. Imports use explicit `.ts` extensions (`allowImportingTsExtensions`). A production deploy will need a bundler such as tsup/esbuild, or `tsx` in prod.
3. **Port 5433, not 5432.** The user has another project's container (`cricbuzz-postgres`) on 5432. **Do not stop or modify it.**
4. **Vitest on Windows:** if the cwd has a lowercase drive letter (`c:\`, which is common in VS Code terminals), every suite fails with `Cannot read properties of undefined (reading 'config')`. Always run tests with `npm test`, which uses `test/run-vitest.mjs`. Don't call `npx vitest` directly from a lowercase-drive shell.
5. Tests use a **separate DB, `tusky_test`**, which `globalSetup` creates and migrates. The integration test truncates its tables. Never point tests at the dev DB.
6. `npm ls` crashes with an npm-internal `edgesOut` error. That comes from npm itself and does not mean the install is broken.
7. `npm audit` shows a moderate esbuild advisory. It comes from drizzle-kit's dev tooling only and is safe to ignore.
8. Don't commit `.env` (it is gitignored). Don't put the user's personal info in requests to external services.

## 8. Known limitations and constraints

- **The API-Sports free tier allows 100 requests/day per sport** (the budget is set to 90) and about 10 requests/minute (throttled at 6.5s per call). Fixtures cost 1 request per day per sport. **One football match costs about 100 requests** to enrich fully (2 squad calls plus 2 seasons × ~50 players), so the free tier handles roughly one complete match a day. Ways to reduce that: `FOOTBALL_LEAGUE_IDS` (default `39,140,135,78,61,2`), `MAX_PLAYERS_PER_TEAM`, fetching one season instead of two, prioritising starting XIs, or a paid plan.
- **Free API-Football plans restrict seasons.** Restricted seasons return a "plan" error, which is treated as non-retryable and skipped.
- **Basketball:** API-Basketball has no per-season player aggregates, so `fetchPlayerSeasonStats` returns nothing and the LLM research covers it.
- **There is no cricket support in API-Sports.** Cricket needs a different provider: implement `SportAdapter`, register it in `registry.ts`, add a sport seed row, and widen the `ENABLED_SPORTS` and `SportCode` enums.
- `MAX_PLAYERS_PER_TEAM` cuts the squad in the order the API returns it (goalkeepers first), not by importance.
- Squad position strings differ per sport and are stored as-is.

## 9. How to run and verify

```bash
cp .env.example .env    # add APISPORTS_KEY, GOOGLE_API_KEY, GROQ_API_KEY, TAVILY_API_KEY (ANTHROPIC optional)
npm install
npm run db:up && npm run db:migrate
npm run dev:scheduler -- --once     # sync fixtures once, then exit
npm run dev:scraper                 # workers (needs at least one LLM key)
npm run scrape:player -- --player-id <id>   # synchronous agent run for one player, prints JSON
npm run player:import -- ./data/sample-players.json
npm run db:studio
npm run typecheck && npm test       # must stay green
```

Useful SQL: `select name, state, count(*) from pgboss.job group by 1,2;` and `select * from scrape_runs order by id desc limit 20;`

## 9a00. Football 2025–26 data, tuning and report (2026-11-24)

Full results: [docs/reports/football-2026-11.md](docs/reports/football-2026-11.md).

- **Source decision:** football results after 2024 come from **openfootball (CC0)**, imported by `ml-service/tusky_ml/ingest/openfootball.py` (`npm run football:import`). **football-data.co.uk was rejected**: its data page limits use to private individuals and excludes commercial and data-training products. Its 25 CSVs sit unused in `data/football-data/` (git-ignored) because the user asked to keep them. Do not use them for training or validation unless the user confirms the project stays non-commercial. The earlier plan claimed the opposite; that was an unchecked assumption.
- **What's stored:** 2025-26 (1,751 of 1,752 scored; Nantes–Toulouse was awarded) and 2026-27 (548 scored, 1,203 upcoming, 1 abandoned: Rayo Vallecano–Athletic). openfootball lagged the real season (no scores for 9 Oct to 22 Nov 2026), so **`ml-service/tusky_ml/ingest/thesportsdb.py` (`npm run football:fill`) filled 295 results** from TheSportsDB's free development key. Validation: all 370 trusted scores it overlapped (299 from 2025-26, 71 from 2026-27) matched. It is slow and cached on purpose (the key is public and shared and returns HTTP 429). **Its terms require a paid subscription to publish an app, so replace those rows with a licensed source before release** (`raw->>'result_source' = 'thesportsdb'` finds them). Rerun it whenever openfootball lags again; matches played but lacking a score are `provider_status NR`. TheSportsDB club names are mapped by the reviewed `TSDB_OVERRIDES`. No Champions League after 2024-25, and the 60-day fixture window assumes once-a-season pairings, which does not hold for cups.
- **Team identity:** `team_aliases` rows `of:<league>:<normalized name>` record every openfootball name decision. `OVERRIDES` (in the importer) holds reviewed same-club mappings (Troyes, Elversberg). Never add an automatic fuzzy rule: it would merge Paris FC into PSG. The name normalizer exists in both Python (`normalize_team`) and TS (`normalizeTeamName`) with a parity test.
- **Fixture dedupe:** `findExistingMatch` (db repo) and `Importer._existing` (Python) attach a provider's fixture to an existing row. Football uses `sameFixtureWindowHours = 24 * 60` within the same competition because a league pairing happens once per season; other sports use 36 h. `storeFixture` takes the adapter's window.
- **Feature fixes** (`ml-service/tusky_ml/features.py`): the long-break shrink applies once per break (`regressed_for`), and a completed match with no score advances `last` without touching ratings. Without these, the data gap above flattened every upcoming prediction.
- **Tuning** (`ml-service/tusky_ml/tune.py`, CLI `tune`): random search over `SportConfig` before a cutoff, ensemble weight search, a one-shot holdout, a "frozen ratings" counterfactual, paired bootstrap intervals. Tuned settings are saved to `artifacts/<sport>/config.json` and applied by `train`; a trained model carries its own `cfg`, so `predict` uses the settings it was trained with. `SportConfig.ensemble_weight` is the GLM share in the ensemble. Only football has a search space.
- **Result (gap filled):** holdout (2,263 matches, Aug 2025 to 23 Nov 2026) RPS 0.2030 vs 0.2302 for base rates (11.8% better), accuracy 52.0%; tuning added +0.0015 RPS (95% interval +0.0006 to +0.0024), the new data about +0.0040. There is no bookmaker benchmark.
- **Open:** the model underrates strong home favourites (74% calls come true 85% of the time); a calibration correction should be tested out of sample before adopting. A stored Union Berlin result (14 Dec 2024) disagrees between sources; API-Sports is kept.

## 9a0. Football and basketball on real data (2026-11-24)

- **The API-Sports free plan allows seasons 2022–2024 only**, for both football and basketball. 2021, 2025 and 2025-26 return a "plan" error, which the backfill skips. Today's date-based fixtures *are* accessible: `/fixtures?date=` returned 2026/27 Champions League games.
- **Stored data:** 6 football leagues × 2022–2024 (EPL, La Liga, Serie A: 380 per season; Bundesliga and Ligue 1: 306 plus 2 relegation play-off games; UCL including qualifying) and NBA 2022-23 to 2024-25. Everything has scores. Backfilling cost 31 football and 5 basketball requests.
- **NBA preseason and All-Star games** aren't flagged by API-Basketball. `ml-service/tusky_ml/exhibitions.py` drops them in `db.load_matches` using regular-season opening dates (`SEASON_OPENERS`, which needs a new line each season) and sides with fewer than 10 games. That removes 204 of 4,150 games.
- **Results** (rolling backtest on the newest half, ensemble selected for both sports):
  - Football: RPS 0.2002 vs base rates 0.2336 (14.3% better), log-loss 0.982, accuracy 52.9%, good calibration. Per competition: EPL 0.1945 (17% better), La Liga 15%, Serie A 16%, Bundesliga 13%, Ligue 1 11.5%, UCL 9.8%.
  - NBA: log-loss 0.611 vs 0.693, accuracy 66.1%, margin MAE 11.2 points, good calibration.
- **The free plan's date window is only yesterday through tomorrow (UTC)**, for both APIs. This was tested on 2026-11-24: `/fixtures?date=2025-12-06` and `/games?date=2025-12-06` returned `{"plan":"Free plans do not have access to this date, try from 2026-11-23 to 2026-11-25."}`. Backfilling 2025+ by date is impossible on the free plan.
- **Fixed 2026-11-24:** both adapters' `fetchUpcoming` go through `ApiSportsClient.getDate`, which skips a plan-refused date with a warning instead of failing the whole sync (tests in `packages/providers/test/planDates.test.ts`, using the verbatim error body). Checked against the real API: the results sync skipped 2026-11-22 and stored 2026-11-23. On the free plan the scheduler still only sees yesterday through tomorrow, so `FIXTURE_DAYS_AHEAD` and `RESULTS_DAYS_BACK` above 1 just spend a request on a refused date.
- **Open issue: stale ratings.** History ends in mid-2025, so current-season predictions would lean on ratings that are over a year old. Options: backfill by date (1 request per day, if past dates are allowed on the free plan), a paid plan, or let the daily results sync catch up over time.

## 9a. Cricket data

- **Identity:** teams use `provider='cricket'`, `external_id='<m|f>:<normalized name>'`, from `cricketTeamKey` (TS) and `team_key` (Python). Both must give the same result; a parity test exists in each language. Franchise renames live in `KNOWN_ALIASES` / `CRICKET_KNOWN_ALIASES`, and an alias row is written only when a match uses the old name. Players use `provider='cricsheet'` with the people-register ID. Venues use the Cricsheet venue-register ID (format 1.3), or `name:<normalized>` when there is none.
- **Matches:** Cricsheet rows have `provider='cricsheet'` and `external_id=<file id>`. `match_aliases` records the Cricsheet ID when the result attaches to an existing CricketData fixture (same teams, same UTC date). Cricket `home_score`/`away_score` hold total runs (super overs excluded). **Use `winner_team_id` and `result_type` for labels, not the scores** (DLS, super overs).
- **Import:** idempotent by `ingest_files.sha256`. A changed file deletes and rewrites that match's innings, deliveries and line-ups. Bad files are recorded as `failed` and don't stop the run. Deliveries go in with COPY at about 11 matches/s.
- **Formats:** T20 (T20 and IT20), ODI, ListA (ODM), Test, MultiDay (MDM). Phase splits are T20 overs 1–6/7–15/16–20 and ODI 1–10/11–40/41–50, with null for multi-day formats.
- `deliveries.bowler_type` (pace/spin) is empty, because Cricsheet doesn't record bowling style. A source is needed before the spin-vs-pace features (architecture §6.2) can be built.
- The CricketData adapter is **unverified**: their docs need JavaScript and no key was available. Only the failure envelope (HTTP 200, `{"status":"failure","reason":...}`) is confirmed. Verify field names with a real key and add recorded payloads to the tests.

## 9a2. Cricket model (`ml-service/tusky_ml/cricket/`)

- `data.py` loads matches, innings (super overs excluded), per-player batting and bowling per match (aggregated in SQL from `deliveries`) and line-ups. `features.py` replays matches with **state per format** and outputs `pre_*`/`post_*` XI features, toss features, labels (1, 0, or 0.5 for a draw; None = no decision) and first-innings rows. The `fi1_`/`fi2_` columns are the two batting-order scenarios, and `fi_` is the actual order.
- `model.py`: `WinModel` is trained on both orientations and symmetrized (`swap` negates the `ANTISYMMETRIC` features). Candidates are logistic, hgb and an ensemble, plus the coin-flip and `EloOnly` references. The nested temperature (`_nested_temperature`) is adopted only if later folds improve. `FirstInningsModel` uses quantile HGB with CQR widening. The report includes segment breakdowns.
- `pipeline.py` handles artifacts at `artifacts/cricket/<fmt>/`. `predict` picks pre- or post-toss by `toss_a != 0` and stores per-format versions (`upsert_predictions` takes a per-row `version` column).
- Migration 0003 makes `predictions.exp_home_score`/`exp_away_score` nullable (null for cricket).
- **First full-data results (2026-11-24)**, backtest on the newest half, post-toss model:
  - T20: log-loss 0.541 vs coin flip 0.693 and Elo-only 0.616, AUC 0.80, accuracy 72%.
  - ODI: 0.598, AUC 0.74.
  - Test (3-way): 0.911 vs base rates 1.037.
  - First innings: T20 median off by 29 runs on average vs 36 for the venue average; ODI 49 vs 58; the 10–90% range covers 78–79% of scores.
- **IPL finding:** for recent IPL seasons (n≈215 in the backtest) neither the model nor Elo-only beats a coin flip (raw log-loss 0.707–0.714). Per-segment nested calibration (`segment_calibration` in the report) therefore shrinks club predictions almost to 50/50 (×0.08), sharpens women's T20 (×1.55), and leaves the other segments alone. The headline T20 accuracy comes mostly from internationals and women's cricket. Improving IPL is open work: auction-era squad turnover and player-level form are the likely levers. Don't claim IPL skill without new evidence.
- Known gaps: there is no weather yet (module 3). Pace vs spin needs bowling-style data. Associate T20Is inflate the overall accuracy, so read the `segments` in the report.

## 9b. ML service (`ml-service/`)

- Python 3.11+, venv at `ml-service/.venv` (gitignored), created by `npm run ml:setup`. npm scripts go through `ml-service/run.mjs`. The config comes from the repo-root `.env` (`DATABASE_URL`, `ML_*`).
- `features.py` replays every match of a sport in kick-off order and records the state **before** each match, then updates it with the result. Training and prediction share that code path, so there is no train/serve skew. A test checks that changing a result never changes earlier features.
- Each match becomes 2 "team perspective" rows (`team_rows`), so one regressor predicts "score of T vs O".
- `models.py`: football `glm` (PoissonRegressor on log-rates) or `hgb` (HistGB, poisson loss), plus Dixon-Coles `rho` fitted by MLE. Basketball `linear` (Ridge) or `hgb`, plus `sigma_margin`/`sigma_total` measured on the validation fold.
- `pipeline.train`: rolling-origin backtest (`backtest`, 4 expanding-window folds over the newest half), candidates `glm|hgb|ensemble` (football) and `linear|hgb|ensemble` (basketball), picks the best (football by RPS, basketball by log-loss), refits on all rows, and writes `artifacts/<sport>/model.joblib` and `report.json`. It refuses to train on fewer than `ML_MIN_TRAIN_MATCHES` usable matches; a match is usable when both teams have at least 3 prior games.
- `predictions` has one row per (match, model_version), upserted. Readers should take the newest `updated_at` per match. `details` jsonb holds the sport-specific extras.
- `features.py` also keeps **online opponent-adjusted attack/defence ratings** (`rating_lr`; football 0.04, basketball 0.08) and exposes their implied scoring rate as the `rate` feature. Football training uses recency weights (`sample_half_life_days=365`).
- `npm`-less benchmark: `node ml-service/run.mjs bench` gives the share of skill captured between baseline (0%) and the true-strength oracle (100%), over 5 synthetic leagues with in-season drift. As of 2026-11-23: football about 65% (ensemble/glm), basketball about 77% (linear). Judge modelling changes with it. Already tried and rejected: temperature/probit calibration (worse out of sample) and recency weights for basketball. **The model has not been trained on real data yet.**
- Known limits: Elo across leagues starts equal, so cross-league cups (league 2 = UCL) are weak at first. Player data (`player_stats` and `player_insights` injuries) is **not** used yet because it is too sparse on the free tier.

## 10. Suggested next steps (in priority order)

1. **Live smoke test with real keys.** Run `--once`, then the scraper, and check that real API-Sports payloads map correctly. Also check that **Gemini accepts `PlayerHistorySchema`** for structured output; if not, try `method: "jsonMode"` or simplify nullable fields. Confirm the Groq fallback by setting a bad `GOOGLE_API_KEY`. Fix whatever breaks and add recorded payloads to `packages/providers/test/fixtures.ts`.
2. **Quota prioritisation.** Give pg-boss priority to matches by kick-off time, and enrich only probable starters (API-Football `/fixtures/lineups` is about 1 hour before kick-off) or cap players per team by minutes played.
3. **Backend (Express)** in `backend/`: read endpoints for matches, players and insights (manual beats llm, newest first), then rate limiting. Reuse `@tusky/db` and `@tusky/shared`.
4. **Prediction service:** ~~done~~ (team-level model in `ml-service/`). Next: once API keys exist, backfill 2–3 seasons, train, and check `report.json`. Then add player availability (injuries from `player_insights`, starting XI) as features and expose `predictions` through the API.
5. **Live polling:** implement `workers/livePoll.ts` as described in its header comment (`/fixtures/events`, `match_events` with `dedupeKey`, self re-enqueue every 60s, status from the feed). This needs a paid plan or a short list of featured matches.
6. **Frontend (React)** in `frontend/`.
7. **Cricket** via a new provider adapter.
8. Housekeeping: `git init` plus a first commit, CI running `typecheck` and `test`, and a production build/Dockerfiles for the two services.

## 11. Conventions

- Keep the sport-agnostic core generic. Sport-specific logic belongs in adapters and the `schemas/stats/*` zod shapes.
- All writes go through the idempotent upsert helpers in `packages/db/src/repo.ts`.
- New background work means a new queue in `shared/src/queue.ts` (`QUEUES`, payload type, `QUEUE_CONFIG`), with deduplication by `singletonKey`.
- External calls get injectable dependencies so they can be unit-tested with fakes. Add a test with every change, and keep `npm test` and `npm run typecheck` green.
- Log with `childLogger("<svc>")`. Never log API keys.
