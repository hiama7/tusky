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
```

## Tests

```bash
npm test   # unit tests + pipeline integration test (uses a separate tusky_test DB; skipped if Postgres is down)
npm run typecheck
```

`npm test` goes through `test/run-vitest.mjs`, which changes the drive letter to uppercase. Vitest 5 breaks on Windows when the working directory starts with a lowercase `c:\`.
