// Brings the TEST database schema up to date before the suite (non-destructive:
// `prisma migrate deploy` only applies pending migrations, it never deletes data).
// Tests create their own uniquely-named records and compare revenue as deltas,
// so they don't need an empty database. Refuses any database not ending in "_test".
import { execSync } from 'node:child_process';

export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.example).');
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to use "${dbName}": the test database name must end with _test.`);
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: { ...process.env, DATABASE_URL: url } });
}
