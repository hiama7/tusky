// =========================================================
// storage.js — the ONLY place that touches localStorage/sessionStorage.
// Every key is namespaced with "tusky_demo_" so demo state is easy to
// identify and wipe, and never mixes with real business data.
// Stage 2: this file is no longer needed for data — PHP + MySQL take over.
// =========================================================
const PREFIX = 'tusky_demo_';
export const CHANGE_EVENT = 'tusky-demo-change';

export function read(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key) ?? sessionStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Writes a value and notifies listening components so they re-fetch. */
export function write(key, value, { session = false } = {}) {
  const store = session ? sessionStorage : localStorage;
  const other = session ? localStorage : sessionStorage;
  other.removeItem(PREFIX + key);
  store.setItem(PREFIX + key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }));
}

export function remove(key) {
  localStorage.removeItem(PREFIX + key);
  sessionStorage.removeItem(PREFIX + key);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }));
}

/** Clears every demo key (used by "Reset demo data"). */
export function resetDemo() {
  for (const store of [localStorage, sessionStorage]) {
    Object.keys(store).filter((k) => k.startsWith(PREFIX)).forEach((k) => store.removeItem(k));
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: '*' }));
}

/** Reads a collection, seeding it from demo data the first time. */
export function collection(key, seed) {
  let value = read(key);
  if (value === null) {
    value = typeof seed === 'function' ? seed() : seed;
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  }
  return value;
}

export const uid = (prefix = '') => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
