// Rate limiters (in-memory store; use a shared store such as Redis when running
// several server instances). Responses use the standard error envelope with 429.
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env.js';

const handler = (_req, res, _next, options) =>
  res.status(429).json({ success: false, message: options.message, errors: [] });

function limiter({ windowMs, limit, message, key }) {
  if (env.RATE_LIMIT_DISABLED) return (_req, _res, next) => next();
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message,
    handler,
    keyGenerator: key || ((req) => ipKeyGenerator(req.ip)),
  });
}

/** Whole-API safety net. */
export const apiLimiter = limiter({ windowMs: 60_000, limit: 300, message: 'Too many requests. Please slow down.' });

/** Login: per IP + email, to slow credential stuffing. */
export const loginLimiter = limiter({
  windowMs: 15 * 60_000,
  limit: 10,
  message: 'Too many login attempts. Try again in 15 minutes.',
  key: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email || '').toLowerCase()}`,
});

export const registerLimiter = limiter({ windowMs: 60 * 60_000, limit: 10, message: 'Too many accounts created from this network. Try again later.' });
export const passwordResetLimiter = limiter({ windowMs: 60 * 60_000, limit: 5, message: 'Too many password reset requests. Try again later.' });
export const paymentLimiter = limiter({ windowMs: 60_000, limit: 20, message: 'Too many payment requests. Please wait a moment.' });
