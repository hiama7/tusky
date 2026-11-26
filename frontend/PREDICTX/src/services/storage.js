// =============================================================================
// storage.js — harmless UI preferences only (e.g. notification toggles).
// Authentication, purchases, payments and trial status are NEVER stored in the
// browser: they live in MySQL and are checked by the server on every request.
// =============================================================================
const PREFIX = 'tusky_pref_';

/** Fired after any API write so open lists re-fetch (see hooks/useAsync). */
export const CHANGE_EVENT = 'tusky-data-change';

export function readPref(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writePref(key, value) {
  localStorage.setItem(PREFIX + key, JSON.stringify(value));
}

/** One-time clean-up of the Stage 1 demo keys, which are no longer used. */
export function clearLegacyDemoData() {
  for (const store of [localStorage, sessionStorage]) {
    Object.keys(store).filter((k) => k.startsWith('tusky_demo_')).forEach((k) => store.removeItem(k));
  }
}
