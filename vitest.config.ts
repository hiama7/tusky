import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "scheduler/test/**/*.test.ts", "scrapper-service/test/**/*.test.ts"],
    globalSetup: ["./test/globalSetup.ts"],
    // Tests never touch the dev database or real APIs.
    env: {
      DATABASE_URL: "postgres://tusky:tusky@localhost:5433/tusky_test",
      APISPORTS_KEY: "test-key",
      GOOGLE_API_KEY: "",
      GROQ_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      TAVILY_API_KEY: "",
      ENABLED_SPORTS: "football",
      FOOTBALL_LEAGUE_IDS: "",
      LOG_LEVEL: "warn",
      APISPORTS_MIN_INTERVAL_MS: "0",
      FIXTURE_DAYS_AHEAD: "1",
      NODE_ENV: "production",
    },
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
