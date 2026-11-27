// Database backups, with a restore that is actually tried.
//   npm run backup            dump MySQL (site) and Postgres (ML), copy uploads
//   npm run backup:verify     restore the newest MySQL dump into a scratch database,
//                             compare every table's row count, then remove the scratch copy
// Backups hold users' personal data: keep backups/ private. It is git-ignored.
// Nothing is ever deleted from backups/; prune old folders yourself.
import { createReadStream, createWriteStream, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { BACKEND, ROOT, alert, log, readEnvFile, run, setting, writeState } from './lib.mjs';

const DIR = join(ROOT, 'backups');
const SCRATCH = 'predictx_restore_check';
const tool = (name) => setting(`${name.toUpperCase()}_PATH`) || (existsSync(`C:/xampp/mysql/bin/${name}.exe`) ? `C:/xampp/mysql/bin/${name}.exe` : name);

function mysqlTarget() {
  const url = new URL(readEnvFile(join(BACKEND, '.env')).DATABASE_URL);
  return {
    db: url.pathname.slice(1),
    args: ['-h', url.hostname, '-P', url.port || '3306', '-u', decodeURIComponent(url.username), '--protocol=tcp'],
    env: { ...process.env, MYSQL_PWD: decodeURIComponent(url.password) }, // never on the command line
  };
}

/** Streams a command's output into a gzip file; fails if the command does. */
async function dumpTo(file, exe, args, env = process.env) {
  const child = spawn(exe, args, { env, windowsHide: true });
  let errors = '';
  child.stderr.on('data', (d) => { errors = (errors + d).slice(-1000); });
  const exit = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  await pipeline(child.stdout, createGzip(), createWriteStream(file));
  if ((await exit) !== 0) {
    rmSync(file, { force: true }); // a half-written dump must not pass for a backup
    throw new Error(errors.trim() || `${exe} failed`);
  }
}

async function query(target, sql, db) {
  const { code, tail } = await run(tool('mysql'), [...target.args, '-N', '-B', ...(db ? [db] : []), '-e', sql], { env: target.env });
  if (code !== 0) throw new Error(tail.trim());
  return tail.trim().split(/\r?\n/).filter(Boolean);
}

async function rowCounts(target, db) {
  const counts = {};
  for (const table of await query(target, 'SHOW TABLES', db)) {
    counts[table] = Number((await query(target, `SELECT COUNT(*) FROM \`${table}\``, db))[0]);
  }
  return counts;
}

async function backup() {
  const out = join(DIR, new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'));
  mkdirSync(out, { recursive: true });
  const parts = {};
  const problems = [];

  try {
    const target = mysqlTarget();
    const counts = await rowCounts(target, target.db);
    await dumpTo(join(out, 'predictx.sql.gz'), tool('mysqldump'), [...target.args, '--single-transaction', '--routines', '--hex-blob', '--default-character-set=utf8mb4', target.db], target.env);
    parts.mysql = { counts };
  } catch (err) {
    problems.push(`MySQL: ${err.message}`);
  }
  try {
    await dumpTo(join(out, 'tusky.sql.gz'), 'docker', ['exec', setting('PG_CONTAINER', 'tusky-postgres'), 'pg_dump', '-U', 'tusky', '-d', 'tusky']);
    parts.postgres = true;
  } catch (err) {
    problems.push(`Postgres: ${err.message}`);
  }
  const uploads = join(BACKEND, 'uploads');
  if (existsSync(uploads)) {
    cpSync(uploads, join(out, 'uploads'), { recursive: true });
    parts.uploads = true;
  }

  writeFileSync(join(out, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), ...parts, problems }, null, 2));
  writeState('backup', { finishedAt: new Date().toISOString(), folder: out, mysql: Boolean(parts.mysql), postgres: Boolean(parts.postgres), problems });
  log(`backup written to ${out}: ${Object.keys(parts).join(', ') || 'nothing'}`);
  if (problems.length) {
    await alert(`Backup incomplete. ${problems.join(' | ')}`);
    process.exitCode = 1;
  }
}

async function verify() {
  const folder = existsSync(DIR) && readdirSync(DIR).sort().reverse().map((n) => join(DIR, n)).find((f) => existsSync(join(f, 'predictx.sql.gz')) && JSON.parse(readFileSync(join(f, 'manifest.json'))).mysql);
  if (!folder) throw new Error('No MySQL backup to verify. Run `npm run backup` first.');
  const { counts } = JSON.parse(readFileSync(join(folder, 'manifest.json'))).mysql;
  const target = mysqlTarget();
  if ((await query(target, `SHOW DATABASES LIKE '${SCRATCH}'`)).length) throw new Error(`Database ${SCRATCH} already exists; remove it yourself before verifying.`);

  await query(target, `CREATE DATABASE \`${SCRATCH}\``);
  try {
    const child = spawn(tool('mysql'), [...target.args, '--default-character-set=utf8mb4', SCRATCH], { env: target.env, windowsHide: true });
    let errors = '';
    child.stderr.on('data', (d) => { errors = (errors + d).slice(-1000); });
    const exit = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    await pipeline(createReadStream(join(folder, 'predictx.sql.gz')), createGunzip(), child.stdin);
    if ((await exit) !== 0) throw new Error(errors.trim() || 'restore failed');

    const restored = await rowCounts(target, SCRATCH);
    // counts were taken just before the dump, so a live site may have gained rows
    const wrong = Object.keys(counts).filter((t) => !(t in restored) || restored[t] < counts[t]);
    if (wrong.length) throw new Error(`restored copy is missing rows in: ${wrong.join(', ')}`);
    const rows = Object.values(restored).reduce((a, b) => a + b, 0);
    writeState('restore', { finishedAt: new Date().toISOString(), folder, ok: true, tables: Object.keys(restored).length, rows });
    log(`restore verified: ${Object.keys(restored).length} tables, ${rows} rows from ${folder}`);
  } finally {
    await query(target, `DROP DATABASE \`${SCRATCH}\``); // only the scratch copy made above
  }
}

const action = process.argv[2] === 'verify' ? verify : backup;
action().catch(async (err) => {
  await alert(`Backup ${process.argv[2] === 'verify' ? 'verification' : ''} failed: ${err.message}`);
  process.exitCode = 1;
});
