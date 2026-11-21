import { z } from "zod";

/**
 * The structured "player history" we store in `player_insights`.
 * Used as (1) the LLM structured-output schema and (2) the manual import format.
 *
 * Kept deliberately flat (no unions / records) so it works with Gemini, Groq and
 * Claude structured output alike. Unknown values must be `null`, never invented.
 */
export const SourceRefSchema = z.object({
  url: z.string().describe("URL the fact was taken from"),
  title: z.string().nullable().describe("Page title, if known"),
});

export const SituationSchema = z.object({
  situation: z
    .string()
    .describe("Concrete situation, e.g. 'home games', 'vs top-6 opponents', 'when chasing', 'after long travel'"),
  impact: z.string().describe("What happens to the player's performance in that situation, with numbers if available"),
  evidence: z.string().nullable().describe("Short supporting evidence / stat"),
  sourceUrl: z.string().nullable(),
});

export const RecentFormSchema = z.object({
  period: z.string().describe("e.g. 'last 5 matches', '2025/26 season so far'"),
  summary: z.string(),
  rating: z.number().min(0).max(10).nullable().describe("0-10 form rating, null if unknown"),
});

export const InjurySchema = z.object({
  description: z.string(),
  status: z.enum(["active", "recovered", "doubtful", "unknown"]),
  since: z.string().nullable().describe("ISO date if known"),
});

export const PlayerHistorySchema = z.object({
  summary: z.string().describe("3-5 sentence scouting summary of the player, grounded in the sources"),
  recentForm: z.array(RecentFormSchema).max(5),
  winConditions: z
    .array(SituationSchema)
    .max(8)
    .describe("Situations in which the player (and their team) tends to perform well / win"),
  lossConditions: z
    .array(SituationSchema)
    .max(8)
    .describe("Situations in which the player tends to struggle / their team tends to lose"),
  strengths: z.array(z.string()).max(8),
  weaknesses: z.array(z.string()).max(8),
  injuries: z.array(InjurySchema).max(5),
  keyStats: z
    .array(z.object({ name: z.string(), value: z.string(), context: z.string().nullable() }))
    .max(15)
    .describe("Important stats not already present in the provided API stats"),
  sources: z.array(SourceRefSchema).max(15),
  confidence: z.number().min(0).max(1).describe("0-1 confidence in this profile given the evidence available"),
});

export type PlayerHistory = z.infer<typeof PlayerHistorySchema>;
export type Situation = z.infer<typeof SituationSchema>;

/** Manual import file format: an array of these. */
export const ManualPlayerImportSchema = z.object({
  player: z.union([
    z.object({ provider: z.string(), externalId: z.string() }),
    z.object({
      name: z.string(),
      sport: z.enum(["football", "basketball"]),
      team: z.string().optional(),
      nationality: z.string().optional(),
      position: z.string().optional(),
    }),
  ]),
  history: PlayerHistorySchema.extend({
    confidence: z.number().min(0).max(1).default(1),
    sources: z.array(SourceRefSchema).default([]),
    recentForm: z.array(RecentFormSchema).default([]),
    winConditions: z.array(SituationSchema).default([]),
    lossConditions: z.array(SituationSchema).default([]),
    strengths: z.array(z.string()).default([]),
    weaknesses: z.array(z.string()).default([]),
    injuries: z.array(InjurySchema).default([]),
    keyStats: z
      .array(z.object({ name: z.string(), value: z.string(), context: z.string().nullable().default(null) }))
      .default([]),
  }),
  stats: z
    .array(z.object({ season: z.string(), competition: z.string().optional(), stats: z.record(z.string(), z.unknown()) }))
    .default([]),
});

export const ManualImportFileSchema = z.array(ManualPlayerImportSchema);
export type ManualPlayerImport = z.infer<typeof ManualPlayerImportSchema>;
