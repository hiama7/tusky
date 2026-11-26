// CSRF protection for the cookie-based endpoints (refresh / logout).
// Refresh cookies are SameSite=Strict; additionally require the Origin (or Referer)
// to be one of the allowed front-end origins. Requests from other sites are rejected.
import { env } from '../config/env.js';
import { ApiError } from '../utils/apiResponse.js';

export function requireTrustedOrigin(req, _res, next) {
  const origin = req.get('origin') || (req.get('referer') ? new URL(req.get('referer')).origin : null);
  // Non-browser clients (curl, tests) send no Origin; cookies are not sent cross-site anyway.
  if (!origin) return next();
  const self = `${req.protocol}://${req.get('host')}`;
  if (origin === self || env.corsOrigins.includes(origin)) return next();
  throw ApiError.forbidden('Request origin not allowed');
}
