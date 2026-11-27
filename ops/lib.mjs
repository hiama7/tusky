// Shared helpers for the operations scripts: settings, logging, alerts, commands.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BACKEND = join(ROOT, 'backend', 'PREDICTX');
export const STATE_DIR = join(ROOT, 'ops', 'state');
export const LOG_DIR = join(ROOT, 'ops', 'logs');

export const readEnvFile = (path) => (existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {});

/** Settings come from the environment, then the project-root .env. */
export function setting(name, fallback = '') {
  return process.env[name] || readEnvFile(join(ROOT, '.env'))[name] || fallback;
}

export function log(line) {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  mkdirSync(LOG_DIR, { recursive: true });
  appendFileSync(join(LOG_DIR, `${stamped.slice(0, 10)}.log`), `${stamped}\n`);
}

export function writeState(name, data) {
  mkdirSync(STATE_DIR, { recursive: true });
  const target = join(STATE_DIR, `${name}.json`);
  writeFileSync(`${target}.tmp`, JSON.stringify(data, null, 2));
  renameSync(`${target}.tmp`, target); // readers never see half a file
}

/** Posts to ALERT_WEBHOOK_URL (Slack, Discord and most chat tools accept this). */
export async function alert(text) {
  log(`ALERT ${text}`);
  const url = setting('ALERT_WEBHOOK_URL');
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `[TUSKY] ${text}`, content: `[TUSKY] ${text}` }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) log(`alert webhook answered ${res.status}`);
    return res.ok;
  } catch (err) {
    log(`alert webhook failed: ${err.message}`); // the URL is a secret: never log it
    return false;
  }
}

/** Runs a command without a shell; resolves with its exit code and the end of its output. */
export function run(exe, args, { cwd = ROOT, env = process.env, timeoutMs = 20 * 60_000 } = {}) {
  return new Promise((resolve) => {
    let tail = '';
    const child = spawn(exe, args, { cwd, env, windowsHide: true });
    const keep = (chunk) => { tail = (tail + chunk).slice(-4000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => { tail += `\ntimed out after ${timeoutMs / 1000}s`; child.kill(); }, timeoutMs);
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: 1, tail: err.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, tail }); });
  });
}
