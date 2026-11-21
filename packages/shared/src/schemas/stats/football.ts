import { z } from "zod";

/** Normalised per-season football stats stored in `player_stats.stats`. */
export const FootballStatsSchema = z.object({
  appearances: z.number().nullable(),
  lineups: z.number().nullable(),
  minutes: z.number().nullable(),
  position: z.string().nullable(),
  rating: z.number().nullable(),
  goals: z.number().nullable(),
  assists: z.number().nullable(),
  conceded: z.number().nullable(),
  saves: z.number().nullable(),
  shotsTotal: z.number().nullable(),
  shotsOnTarget: z.number().nullable(),
  passesTotal: z.number().nullable(),
  passesKey: z.number().nullable(),
  passAccuracy: z.number().nullable(),
  tackles: z.number().nullable(),
  interceptions: z.number().nullable(),
  duelsTotal: z.number().nullable(),
  duelsWon: z.number().nullable(),
  dribblesAttempts: z.number().nullable(),
  dribblesSuccess: z.number().nullable(),
  foulsDrawn: z.number().nullable(),
  foulsCommitted: z.number().nullable(),
  yellowCards: z.number().nullable(),
  redCards: z.number().nullable(),
  penaltiesScored: z.number().nullable(),
  penaltiesMissed: z.number().nullable(),
  penaltiesSaved: z.number().nullable(),
});

export type FootballStats = z.infer<typeof FootballStatsSchema>;
