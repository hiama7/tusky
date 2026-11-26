// =============================================================================
// api.js — the single HTTP client for the PREDICTX backend.
//
//  * Access tokens live only in memory (never localStorage). User and admin
//    sessions are separate, each with its own token and refresh cookie.
//  * On a 401 the client refreshes once via the httpOnly cookie and retries.
//  * Mutating requests broadcast CHANGE_EVENT so open lists re-fetch.
// =============================================================================
import { CHANGE_EVENT } from './storage';

export const API_BASE = import.meta.env.VITE_API_BASE || '/api';
export const SESSION_EXPIRED_EVENT = 'px-session-expired';

const tokens = { user: null, admin: null };
const inflight = { user: null, admin: null };

export const setToken = (scope, token) => { tokens[scope] = token || null; };
export const hasToken = (scope) => Boolean(tokens[scope]);

/** Error thrown for any non-2xx response. `fields` maps field → message for forms. */
export class ApiError extends Error {
  constructor(message, status, errors = []) {
    super(message);
    this.status = status;
    this.errors = errors;
    this.fields = Object.fromEntries(errors.filter((e) => e.field).map((e) => [e.field, e.message]));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Exchanges the refresh cookie for a new access token. Concurrent callers share
 * one request. A temporary server/network failure is retried (it must not log the
 * user out); only a real 401/403 means "no session".
 */
export function refreshSession(scope = 'user') {
  if (!inflight[scope]) {
    inflight[scope] = (async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const res = await fetch(`${API_BASE}/auth${scope === 'admin' ? '/admin' : ''}/refresh`, { method: 'POST', credentials: 'include' });
          if (res.status >= 500) throw new Error(`server ${res.status}`);
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            tokens[scope] = null;
            return null;
          }
          tokens[scope] = body.data.accessToken;
          return body.data;
        } catch {
          await sleep(600 * (attempt + 1));
        }
      }
      return null;
    })().finally(() => { inflight[scope] = null; });
  }
  return inflight[scope];
}

/**
 * request('/matches', { method, body, scope, form })
 *   scope: 'user' (default) | 'admin' | 'none'
 *   form:  FormData for multipart uploads
 */
export async function request(path, { method = 'GET', body, scope = 'user', form, query } = {}, retried = false) {
  const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 'all'))}` : '';
  const headers = {};
  if (scope !== 'none' && tokens[scope]) headers.Authorization = `Bearer ${tokens[scope]}`;
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${API_BASE}${path}${qs}`, { method, headers, credentials: 'include', body: form || (body !== undefined ? JSON.stringify(body) : undefined) });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0);
  }

  if (res.status === 401 && scope !== 'none' && !retried && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession(scope);
    if (refreshed) return request(path, { method, body, scope, form, query }, true);
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: scope }));
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new ApiError(json.message || `Request failed (${res.status})`, res.status, json.errors || []);
  }
  if (method !== 'GET') window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: path }));
  return json.data;
}

export const get = (path, opts) => request(path, { ...opts, method: 'GET' });
export const post = (path, body, opts) => request(path, { ...opts, method: 'POST', body });
export const put = (path, body, opts) => request(path, { ...opts, method: 'PUT', body });
export const patch = (path, body, opts) => request(path, { ...opts, method: 'PATCH', body });
export const del = (path, opts) => request(path, { ...opts, method: 'DELETE' });

/** Builds multipart FormData from a plain object (skips undefined/null). */
export function toFormData(obj, file, fileField = 'image') {
  const fd = new FormData();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    fd.append(k, v instanceof Date ? v.toISOString() : String(v));
  }
  if (file) fd.append(fileField, file);
  return fd;
}
