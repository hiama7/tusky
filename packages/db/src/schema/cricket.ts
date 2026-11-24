import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { matches, players, teams } from "./core.ts";

/**
 * One row per innings (super overs included, flagged). Phase splits use the format's
 * standard phases: T20 1-6 / 7-15 / 16-20, ODI 1-10 / 11-40 / 41-50; null for Tests.
 */
export const cricketInnings = pgTable(
  "cricket_innings",
  {
    id: serial("id").primaryKey(),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    inningsNo: integer("innings_no").notNull(),
    battingTeamId: integer("batting_team_id")
      .notNull()
      .references(() => teams.id),
    bowlingTeamId: integer("bowling_team_id").references(() => teams.id),
    runs: integer("runs").notNull(),
    wickets: integer("wickets").notNull(),
    legalBalls: integer("legal_balls").notNull(),
    extras: integer("extras").notNull(),
    targetRuns: integer("target_runs"),
    targetOvers: real("target_overs"),
    declared: boolean("declared").notNull().default(false),
    forfeited: boolean("forfeited").notNull().default(false),
    isSuperOver: boolean("is_super_over").notNull().default(false),
    ppRuns: integer("pp_runs"),
    ppWkts: integer("pp_wkts"),
    midRuns: integer("mid_runs"),
    midWkts: integer("mid_wkts"),
    deathRuns: integer("death_runs"),
    deathWkts: integer("death_wkts"),
  },
  (t) => [uniqueIndex("cricket_innings_uq").on(t.matchId, t.inningsNo)],
);

/** Ball by ball. `over` is 0-based; `ball` counts every delivery in the over (extras too), from 1. */
export const deliveries = pgTable(
  "deliveries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    inningsNo: integer("innings_no").notNull(),
    over: integer("over").notNull(),
    ball: integer("ball").notNull(),
    batterId: integer("batter_id")
      .notNull()
      .references(() => players.id),
    bowlerId: integer("bowler_id")
      .notNull()
      .references(() => players.id),
    nonStrikerId: integer("non_striker_id").references(() => players.id),
    runsBatter: integer("runs_batter").notNull(),
    runsExtras: integer("runs_extras").notNull(),
    runsTotal: integer("runs_total").notNull(),
    /** Comma-joined extras kinds present: wides, noballs, byes, legbyes, penalty. */
    extrasKind: text("extras_kind"),
    /** False for wides and no-balls (they don't count towards the over). */
    isLegal: boolean("is_legal").notNull(),
    nonBoundary: boolean("non_boundary").notNull().default(false),
    wicketKind: text("wicket_kind"),
    playerOutId: integer("player_out_id").references(() => players.id),
    /** Rare: a second dismissal on the same delivery, as recorded by the source. */
    extraWickets: jsonb("extra_wickets"),
    /** pace | spin, once known (Cricsheet does not record bowling style). */
    bowlerType: text("bowler_type"),
  },
  (t) => [
    index("deliveries_match_idx").on(t.matchId, t.inningsNo, t.over, t.ball),
    index("deliveries_batter_idx").on(t.batterId),
    index("deliveries_bowler_idx").on(t.bowlerId),
  ],
);

/** Playing XI (or squad) per match. */
export const matchLineups = pgTable(
  "match_lineups",
  {
    id: serial("id").primaryKey(),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    battingPosition: integer("batting_position"),
    isCaptain: boolean("is_captain"),
    isKeeper: boolean("is_keeper"),
    source: text("source").notNull(),
  },
  (t) => [uniqueIndex("match_lineups_uq").on(t.matchId, t.playerId)],
);

/** Bulk-import bookkeeping: lets re-imports skip files whose content has not changed. */
export const ingestFiles = pgTable(
  "ingest_files",
  {
    source: text("source").notNull(),
    fileName: text("file_name").notNull(),
    sha256: text("sha256").notNull(),
    matchId: integer("match_id").references(() => matches.id, { onDelete: "set null" }),
    status: text("status").notNull(),
    error: text("error"),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.source, t.fileName] })],
);
