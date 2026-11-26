// Authentication middleware for the USER area.
// The JWT only proves identity; role and account status are always re-read from
// MySQL so that blocking an account or changing a role takes effect immediately.
import { prisma } from '../config/database.js';
import { ApiError } from '../utils/apiResponse.js';
import { verifyAccessToken } from '../utils/generateToken.js';

function bearer(req) {
  const h = req.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

async function resolveUser(token, scope) {
  let payload;
  try {
    payload = verifyAccessToken(token, scope);
  } catch (err) {
    throw ApiError.unauthorized(err.name === 'TokenExpiredError' ? 'Session expired' : 'Invalid authentication token');
  }
  const user = await prisma.user.findUnique({
    where: { id: Number(payload.sub) },
    select: { id: true, fullName: true, email: true, phone: true, role: true, accountStatus: true, createdAt: true },
  });
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  if (user.accountStatus !== 'ACTIVE') throw ApiError.forbidden('This account has been blocked. Contact support.');
  return user;
}

/** Requires a valid user-scope access token. Sets req.user. */
export async function requireUser(req, _res, next) {
  const token = bearer(req);
  if (!token) throw ApiError.unauthorized();
  req.user = await resolveUser(token, 'user');
  next();
}

/**
 * Attaches req.user when a valid token is sent; anonymous requests continue.
 * An invalid/expired token still returns 401 so the client knows to refresh.
 */
export async function optionalUser(req, _res, next) {
  const token = bearer(req);
  req.user = token ? await resolveUser(token, 'user') : null;
  next();
}

export { bearer, resolveUser };
