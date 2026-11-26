// Admin authorization: requires an ADMIN-scope token (signed with a separate secret)
// AND role = ADMIN in the database on every request. Frontend role claims are never trusted.
import { ApiError } from '../utils/apiResponse.js';
import { bearer, resolveUser } from './authMiddleware.js';

export async function requireAdmin(req, _res, next) {
  const token = bearer(req);
  if (!token) throw ApiError.unauthorized('Admin authentication required');
  const user = await resolveUser(token, 'admin');
  if (user.role !== 'ADMIN') throw ApiError.forbidden('Administrator access required');
  req.admin = user;
  next();
}
