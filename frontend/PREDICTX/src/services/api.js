// =========================================================
// api.js — request helper shared by every service.
//
// Stage 1: `simulate()` runs a local function after a short delay so the UI
// shows realistic loading states (skeletons, spinners).
//
// Stage 2: set USE_PHP_API = true and point API_BASE at the PHP backend.
// Each service already documents the endpoint it maps to, e.g.
//   POST /api/purchases.php  { match_id, method }
// and `http()` below is the fetch wrapper to use for those calls.
// =========================================================
export const USE_PHP_API = false;
export const API_BASE = '/api';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs a demo implementation with a small artificial latency. Errors become rejected promises. */
export async function simulate(fn, ms = 220) {
  await wait(ms);
  return fn();
}

/** Stage 2 fetch wrapper (unused in Stage 1). Sends PHP session cookies. */
export async function http(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}

/** Error type for validation / business-rule failures shown to the user. */
export class DemoError extends Error {}
