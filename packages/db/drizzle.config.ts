import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: "../../.env", quiet: true });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  // pg-boss owns the `pgboss` schema; keep drizzle-kit away from it.
  schemaFilter: ["public"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://tusky:tusky@localhost:5433/tusky",
  },
});
