import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const historyStatusEnum = pgEnum("history_status", ["pending", "scraping", "ready", "needs_review", "failed"]);
export const matchStatusEnum = pgEnum("match_status", ["scheduled", "live", "completed", "postponed", "cancelled"]);
export const matchPlayerRoleEnum = pgEnum("match_player_role", ["squad", "starting", "bench"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const sports = pgTable("sports", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
});

export const competitions = pgTable(
  "competitions",
  {
    id: serial("id").primaryKey(),
    sportId: integer("sport_id")
      .notNull()
      .references(() => sports.id),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    country: text("country"),
    season: text("season"),
    logoUrl: text("logo_url"),
    ...timestamps,
  },
  (t) => [uniqueIndex("competitions_provider_ext_uq").on(t.sportId, t.provider, t.externalId)],
);

export const teams = pgTable(
  "teams",
  {
    id: serial("id").primaryKey(),
    sportId: integer("sport_id")
      .notNull()
      .references(() => sports.id),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    country: text("country"),
    logoUrl: text("logo_url"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("teams_provider_ext_uq").on(t.sportId, t.provider, t.externalId),
    index("teams_name_idx").on(t.name),
  ],
);

export const players = pgTable(
  "players",
  {
    id: serial("id").primaryKey(),
    sportId: integer("sport_id")
      .notNull()
      .references(() => sports.id),
    /** `manual` for players created by the manual import without a provider id. */
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    nationality: text("nationality"),
    birthDate: date("birth_date"),
    position: text("position"),
    photoUrl: text("photo_url"),
    currentTeamId: integer("current_team_id").references(() => teams.id),
    historyStatus: historyStatusEnum("history_status").notNull().default("pending"),
    historyUpdatedAt: timestamp("history_updated_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("players_provider_ext_uq").on(t.sportId, t.provider, t.externalId),
    index("players_name_idx").on(t.name),
    index("players_history_status_idx").on(t.historyStatus),
  ],
);

export const matches = pgTable(
  "matches",
  {
    id: serial("id").primaryKey(),
    sportId: integer("sport_id")
      .notNull()
      .references(() => sports.id),
    competitionId: integer("competition_id").references(() => competitions.id),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    homeTeamId: integer("home_team_id")
      .notNull()
      .references(() => teams.id),
    awayTeamId: integer("away_team_id")
      .notNull()
      .references(() => teams.id),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    venue: text("venue"),
    city: text("city"),
    status: matchStatusEnum("status").notNull().default("scheduled"),
    /** Provider's raw status code, e.g. NS / 1H / FT / PST. */
    providerStatus: text("provider_status"),
    raw: jsonb("raw"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("matches_provider_ext_uq").on(t.sportId, t.provider, t.externalId),
    index("matches_status_start_idx").on(t.status, t.startTime),
  ],
);

export const matchPlayers = pgTable(
  "match_players",
  {
    id: serial("id").primaryKey(),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id),
    role: matchPlayerRoleEnum("role").notNull().default("squad"),
    ...timestamps,
  },
  (t) => [uniqueIndex("match_players_uq").on(t.matchId, t.playerId)],
);
