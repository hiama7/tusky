import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Always load the repo-root .env, regardless of which workspace is the cwd.
loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const csv = z
  .string()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );

const optionalString = z
  .string()
  .optional()
  .transform((s) => (s && s.trim() ? s.trim() : undefined));

const EnvSchema = z.object({
  DATABASE_URL: z.string().default("postgres://tusky:tusky@localhost:5433/tusky"),
  LOG_LEVEL: z.string().default("info"),

  APISPORTS_KEY: optionalString,
  APISPORTS_DAILY_BUDGET: z.coerce.number().int().positive().default(90),
  /** Gap between API-Sports calls per sport (free tier ~10 req/min). */
  APISPORTS_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(6_500),
  ENABLED_SPORTS: csv.pipe(z.array(z.enum(["football", "basketball"]))).default(["football"]),
  FOOTBALL_LEAGUE_IDS: csv,
  BASKETBALL_LEAGUE_IDS: csv,

  FIXTURE_DAYS_AHEAD: z.coerce.number().int().min(0).max(14).default(2),
  FETCH_FIXTURES_CRON: z.string().default("0 */6 * * *"),
  PROMOTE_LIVE_CRON: z.string().default("* * * * *"),

  HISTORY_STALE_DAYS: z.coerce.number().int().positive().default(7),
  PLAYER_HISTORY_CONCURRENCY: z.coerce.number().int().positive().default(2),
  MATCH_ENRICH_CONCURRENCY: z.coerce.number().int().positive().default(1),
  MAX_PLAYERS_PER_TEAM: z.coerce.number().int().min(0).default(0),

  GOOGLE_API_KEY: optionalString,
  LLM_GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  GROQ_API_KEY: optionalString,
  LLM_GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),
  ANTHROPIC_API_KEY: optionalString,
  LLM_CLAUDE_MODEL: z.string().default("claude-haiku-5-5"),
  TAVILY_API_KEY: optionalString,
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required env var ${String(key)} (see .env.example)`);
  }
  return value as NonNullable<Env[K]>;
}
