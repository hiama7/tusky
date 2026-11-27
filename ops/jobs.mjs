// The daily run: fetch results, predict, update the site, import headlines, check health.
//   npm run jobs                      every step
//   npm run jobs -- --only health     some steps (comma separated)
//   npm run jobs -- --list
// A failed step is logged and alerted; the remaining steps still run.
// Settings (project-root .env): JOBS_PUBLISH=true publishes new predictions
// (otherwise they arrive as drafts), ALERT_WEBHOOK_URL receives failures.
import { existsSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKEND, ROOT, STATE_DIR, alert, log, readEnvFile, run, setting, writeState } from './lib.mjs';

const node = process.execPath;
const ml = (...args) => ({ exe: node, args: [join(ROOT, 'ml-service', 'run.mjs'), ...args], cwd: ROOT });
const backend = (script, ...args) => ({ exe: node, args: ['--env-file-if-exists=.env', `scripts/${script}`, ...args], cwd: BACKEND });

/** Football seasons run from July: November 2026 is in "2026-27". */
export function season(date = new Date()) {
  const start = date.getUTCMonth() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function steps({ publish, news }) {
  return [
    { name: 'results', ...ml('openfootball', '--seasons', season(), '--refresh') },
    { name: 'predict', ...ml('predict', '--sport', 'football') },
    { name: 'sync', ...backend('ml-sync.js', ...(publish ? ['--publish'] : [])), failIf: /failed: [1-9]/ },
    ...(news ? [{ name: 'news', ...backend('news-import.js') }] : []),
    { name: 'health', ...backend('health-check.js') },
  ];
}

const newsKey = () => setting('GNEWS_API_KEY') || readEnvFile(join(BACKEND, '.env')).GNEWS_API_KEY;

async function main() {
  const args = process.argv.slice(2);
  const all = steps({ publish: setting('JOBS_PUBLISH') === 'true', news: Boolean(newsKey()) });
  if (args.includes('--list')) return console.log(all.map((s) => s.name).join('\n'));
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1]?.split(',') : null;
  const chosen = only ? all.filter((s) => only.includes(s.name)) : all;
  if (!chosen.length) throw new Error(`No such step. Available: ${all.map((s) => s.name).join(', ')}`);

  mkdirSync(STATE_DIR, { recursive: true });
  const lock = join(STATE_DIR, 'jobs.lock');
  if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs < 2 * 3600_000) {
    log(`another run is in progress (process ${readFileSync(lock, 'utf8')}); not starting`);
    return;
  }
  writeFileSync(lock, String(process.pid));

  const results = [];
  const startedAt = new Date().toISOString();
  try {
    for (const step of chosen) {
      log(`step ${step.name} started`);
      const { code, tail } = await run(step.exe, step.args, { cwd: step.cwd });
      const ok = code === 0 && !step.failIf?.test(tail);
      results.push({ name: step.name, ok, finishedAt: new Date().toISOString(), output: tail.trim().split('\n').slice(-6).join('\n') });
      log(`step ${step.name} ${ok ? 'succeeded' : `FAILED (exit ${code})`}\n${tail.trim().split('\n').slice(-6).join('\n')}`);
    }
  } finally {
    rmSync(lock, { force: true });
  }
  // running a few steps by hand must not count as the daily run having happened
  if (!only) writeState('jobs', { startedAt, finishedAt: new Date().toISOString(), steps: results });

  const failed = results.filter((r) => !r.ok).map((r) => r.name);
  if (failed.length) {
    await alert(`Daily run: ${failed.join(', ')} failed. See ops/logs.`);
    process.exitCode = 1;
  } else {
    log('all steps succeeded');
  }
}

// run only when executed directly, not when a test imports it
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main().catch(async (err) => {
    await alert(`Daily run could not start: ${err.message}`);
    process.exitCode = 1;
  });
}
