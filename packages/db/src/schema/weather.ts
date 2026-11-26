import { date, doublePrecision, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { matches } from "./core.ts";

/**
 * Match-day weather. `kind = archive` rows are observed values (ERA5) used for training;
 * `forecast` rows would hold the forecast available before a live match. Precipitation is
 * deliberately not stored: it is not reliably forecastable, so it must not be a feature.
 */
export const matchWeather = pgTable("match_weather", {
  matchId: integer("match_id")
    .primaryKey()
    .references(() => matches.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  kind: text("kind").notNull(),
  date: date("date").notNull(),
  tempMean: doublePrecision("temp_mean"),
  humidityMean: doublePrecision("humidity_mean"),
  dewPointMean: doublePrecision("dew_point_mean"),
  windMax: doublePrecision("wind_max"),
  cloudMean: doublePrecision("cloud_mean"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});
