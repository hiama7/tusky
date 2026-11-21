# Agent Context: Tusky (score-prediction SaaS)

This file is the handoff for any agent continuing this project without prior context. Read it in full before changing anything. Update it when you finish a meaningful piece of work. The shorter [README.md](README.md) covers setup only.

Last updated: 2026-11-21. At that point phase 1 (scheduler + scraper) was complete and all tests passed.

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
| Backend API | Node + Express (**not started**, `backend/` is empty; the user said "API work later") |
| ORM / DB | Drizzle ORM + PostgreSQL **in Docker** |
| Rate limiting | **Later** (meaning rate limiting on our own API; the provider quota guard already exists) |
| Sports | **Multi-sport generic**: shared columns plus sport-specific `jsonb` checked by zod |
| Fixtures/stats source | **API-Sports** (api-sports.io) |
| Player history | **LangChain / LangGraph** with a cheap LLM, **plus manual JSON import** as an alternative |
| LLM preference | **Gemini (preferred) → Groq (preferred) → Claude (use least, only as last resort)** |
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

**Not verified:** nothing has run against the **real** API-Sports, Gemini, Groq or Tavily APIs yet, because no keys were set. Behaviour against real payloads (especially the Gemini structured-output schema and API-Sports error formats) needs a live smoke test once keys exist. See §10.

**State of the environment:** the project is **not a git repository** yet. `.env` exists locally with no API keys, and the dev DB is empty except for the seeded `sports` rows.

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

## 10. Suggested next steps (in priority order)

1. **Live smoke test with real keys.** Run `--once`, then the scraper, and check that real API-Sports payloads map correctly. Also check that **Gemini accepts `PlayerHistorySchema`** for structured output; if not, try `method: "jsonMode"` or simplify nullable fields. Confirm the Groq fallback by setting a bad `GOOGLE_API_KEY`. Fix whatever breaks and add recorded payloads to `packages/providers/test/fixtures.ts`.
2. **Quota prioritisation.** Give pg-boss priority to matches by kick-off time, and enrich only probable starters (API-Football `/fixtures/lineups` is about 1 hour before kick-off) or cap players per team by minutes played.
3. **Backend (Express)** in `backend/`: read endpoints for matches, players and insights (manual beats llm, newest first), then rate limiting. Reuse `@tusky/db` and `@tusky/shared`.
4. **Prediction service:** pre-match predictions from `player_stats`, `player_insights` and team form.
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
