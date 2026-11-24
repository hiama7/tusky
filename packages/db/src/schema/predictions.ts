import { doublePrecision, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { matches, sports } from "./core.ts";

/**
 * Pre-match outcome predictions, written by the Python `ml-service`.
 * One row per (match, model version); re-running the same model version updates the row.
 * Readers should take the newest `created_at` / `updated_at` per match.
 */
export const predictions = pgTable(
  "predictions",
  {
    id: serial("id").primaryKey(),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    sportId: integer("sport_id")
      .notNull()
      .references(() => sports.id),
    /** e.g. `football-glm-20261123T1200`. */
    modelVersion: text("model_version").notNull(),
    pHome: doublePrecision("p_home").notNull(),
    /** Always 0 for basketball (overtime decides). */
    pDraw: doublePrecision("p_draw").notNull(),
    pAway: doublePrecision("p_away").notNull(),
    /** Expected final score (football goals, basketball points). Null for cricket: see details.first_innings. */
    expHomeScore: doublePrecision("exp_home_score"),
    expAwayScore: doublePrecision("exp_away_score"),
    /** Sport-specific extras: top scorelines, over/under, BTTS, margin/total distribution. */
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    /** Pre-match feature values the model saw (for debugging / explanations). */
    features: jsonb("features").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("predictions_match_model_uq").on(t.matchId, t.modelVersion),
    index("predictions_match_idx").on(t.matchId, t.updatedAt),
  ],
);
