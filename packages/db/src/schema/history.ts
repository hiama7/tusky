import { index, integer, jsonb, pgEnum, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { PlayerHistory } from "@tusky/shared";
import { competitions, players } from "./core.ts";

export const dataSourceEnum = pgEnum("data_source", ["api", "llm", "manual"]);

/** Per-season stats. `stats` holds the sport-specific shape (see @tusky/shared schemas/stats). */
export const playerStats = pgTable(
  "player_stats",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    season: text("season").notNull(),
    competitionId: integer("competition_id").references(() => competitions.id),
    /** Free-text competition name for manual / LLM rows that have no competition id. */
    competitionName: text("competition_name").notNull().default(""),
    source: dataSourceEnum("source").notNull(),
    stats: jsonb("stats").$type<Record<string, unknown>>().notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("player_stats_uq").on(t.playerId, t.season, t.competitionName, t.source)],
);

/** Qualitative + situational history ("when do they win / fall"). Append-only; newest row wins, manual beats llm. */
export const playerInsights = pgTable(
  "player_insights",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    recentForm: jsonb("recent_form").$type<PlayerHistory["recentForm"]>().notNull(),
    winConditions: jsonb("win_conditions").$type<PlayerHistory["winConditions"]>().notNull(),
    lossConditions: jsonb("loss_conditions").$type<PlayerHistory["lossConditions"]>().notNull(),
    strengths: jsonb("strengths").$type<string[]>().notNull(),
    weaknesses: jsonb("weaknesses").$type<string[]>().notNull(),
    injuries: jsonb("injuries").$type<PlayerHistory["injuries"]>().notNull(),
    keyStats: jsonb("key_stats").$type<PlayerHistory["keyStats"]>().notNull(),
    sources: jsonb("sources").$type<PlayerHistory["sources"]>().notNull(),
    confidence: real("confidence").notNull(),
    source: dataSourceEnum("source").notNull(),
    /** e.g. "gemini:gemini-2.5-flash" for llm rows. */
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("player_insights_player_idx").on(t.playerId, t.createdAt)],
);
