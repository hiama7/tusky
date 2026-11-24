import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const ADMIN_URL = "postgres://tusky:tusky@localhost:5433/tusky";
const TEST_URL = "postgres://tusky:tusky@localhost:5433/tusky_test";

/** Creates + migrates `tusky_test` if Postgres is up; integration tests skip themselves otherwise. */
export default async function setup() {
  const admin = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 2_000 });
  try {
    await admin.connect();
  } catch {
    process.env.TUSKY_DB_AVAILABLE = "0";
    console.warn("[test] Postgres not reachable on :5433 — DB integration tests will be skipped");
    return;
  }
  const { rowCount } = await admin.query("select 1 from pg_database where datname = 'tusky_test'");
  if (!rowCount) await admin.query("create database tusky_test");
  await admin.end();

  const pool = new pg.Pool({ connectionString: TEST_URL });
  await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL("../packages/db/migrations", import.meta.url)) });
  await pool.query(
    "insert into sports (code, name) values ('football','Football'),('basketball','Basketball'),('cricket','Cricket') on conflict do nothing",
  );
  await pool.end();
  process.env.TUSKY_DB_AVAILABLE = "1";
}
