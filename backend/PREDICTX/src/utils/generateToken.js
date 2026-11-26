// Token helpers: JWT access tokens, opaque refresh/reset tokens and their hashes.
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// User and admin sessions use different signing secrets, so a user token can never
// be replayed against admin routes even if the audience check were bypassed.
const secretFor = (scope) => (scope === 'admin' ? env.JWT_ADMIN_ACCESS_SECRET : env.JWT_ACCESS_SECRET);

export function signAccessToken(user, scope = 'user') {
  return jwt.sign({ sub: String(user.id), scope }, secretFor(scope), {
    expiresIn: env.ACCESS_TOKEN_TTL,
    issuer: 'predictx',
    audience: scope,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token, scope = 'user') {
  return jwt.verify(token, secretFor(scope), { issuer: 'predictx', audience: scope, algorithms: ['HS256'] });
}

/** Cryptographically random opaque token (given to the client once, stored only as a hash). */
export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Unique, human-friendly transaction reference, e.g. PX-20261126-8F3K2Q9A1B. */
export function transactionReference() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `PX-${d}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}
