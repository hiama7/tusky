import { z } from "zod";

/** Normalised per-season basketball stats stored in `player_stats.stats`. */
export const BasketballStatsSchema = z.object({
  games: z.number().nullable(),
  minutesPerGame: z.number().nullable(),
  pointsPerGame: z.number().nullable(),
  reboundsPerGame: z.number().nullable(),
  assistsPerGame: z.number().nullable(),
  stealsPerGame: z.number().nullable(),
  blocksPerGame: z.number().nullable(),
  turnoversPerGame: z.number().nullable(),
  fieldGoalPct: z.number().nullable(),
  threePointPct: z.number().nullable(),
  freeThrowPct: z.number().nullable(),
});

export type BasketballStats = z.infer<typeof BasketballStatsSchema>;
