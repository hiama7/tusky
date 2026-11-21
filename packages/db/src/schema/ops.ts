import { date, index, integer, jsonb, pgEnum, pgTable, primaryKey, serial, text, timestamp } from "drizzle-orm/pg-core";
import { matches, players, teams } from "./core.ts";

/**
 * Live in-match events (toss, goal, penalty, wicket, card, ...).
 * Written by the `match.live-poll` worker in a later phase; the table exists now so
 * in-play prediction can be added without a schema change.
 */
export const matchEvents = pgTable(
  "match_events",
  {
    id: serial("id").primaryKey(),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    /** toss | goal | penalty | card | wicket | substitution | period_end | ... */
    type: text("type").notNull(),
    /** Half / quarter / innings. */
    period: text("period"),
    /** Minute (football), game clock (basketball), over.ball (cricket) as text. */
    clock: text("clock"),
    teamId: integer("team_id").references(() => teams.id),
    playerId: integer("player_id").references(() => players.id),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** Provider event id / hash, to make polling idempotent. */
    dedupeKey: text("dedupe_key").notNull().unique(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("match_events_match_idx").on(t.matchId, t.occurredAt)],
);

export const scrapeRunStatusEnum = pgEnum("scrape_run_status", ["running", "succeeded", "failed", "needs_review"]);

/** One row per worker run: observability + LLM cost tracking. */
export const scrapeRuns = pgTable(
  "scrape_runs",
  {
    id: serial("id").primaryKey(),
    jobName: text("job_name").notNull(),
    jobId: text("job_id"),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    status: scrapeRunStatusEnum("status").notNull().default("running"),
    error: text("error"),
    llmProvider: text("llm_provider"),
    llmModel: text("llm_model"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("scrape_runs_entity_idx").on(t.entityType, t.entityId)],
);

/** Daily request counter per provider+sport so we never blow the API-Sports free tier. */
export const providerQuota = pgTable(
  "provider_quota",
  {
    provider: text("provider").notNull(),
    sport: text("sport").notNull(),
    day: date("day").notNull(),
    requestsUsed: integer("requests_used").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.provider, t.sport, t.day] })],
);
