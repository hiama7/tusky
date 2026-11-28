// =============================================================================
// Authentication service
//  * bcrypt password hashing (cost from BCRYPT_ROUNDS)
//  * short-lived JWT access tokens (kept in memory by the React app)
//  * opaque refresh tokens in httpOnly SameSite=Strict cookies, stored as SHA-256
//    hashes, rotated on every use; re-use of a rotated token revokes the family
//  * user and admin sessions are separate (different cookies, secrets, scopes)
// =============================================================================
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/apiResponse.js';
import { randomToken, sha256, signAccessToken } from '../utils/generateToken.js';
import { sendMail, passwordResetEmail } from './emailService.js';
import { logger } from '../utils/logger.js';
import { activity, notify } from './notificationService.js';
import { checkSecondFactor } from './twoFactorService.js';
import * as S from './serializers.js';

export const COOKIE = { user: 'px_rt', admin: 'px_art' };
const COOKIE_PATH = { user: '/api/auth', admin: '/api/auth/admin' };
const RESET_TTL_MIN = 30;

// Used to keep login timing similar whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', env.BCRYPT_ROUNDS);

export const hashPassword = (pw) => bcrypt.hash(pw, env.BCRYPT_ROUNDS);

function cookieOptions(scope) {
  return {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'strict',
    path: COOKIE_PATH[scope],
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  };
}

export function clearSessionCookie(res, scope) {
  const { maxAge, ...opts } = cookieOptions(scope); // eslint-disable-line no-unused-vars
  res.clearCookie(COOKIE[scope], opts);
}

async function createRefreshToken(userId, scope, req, familyId = crypto.randomUUID(), db = prisma) {
  const token = randomToken();
  const row = await db.refreshToken.create({
    data: {
      userId,
      scope,
      familyId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      userAgent: (req.get('user-agent') || '').slice(0, 255),
      ip: (req.ip || '').slice(0, 45),
    },
  });
  return { token, row };
}

/** Issues access token + refresh cookie and returns the session payload. */
async function startSession(user, scope, req, res) {
  const { token } = await createRefreshToken(user.id, scope, req);
  res.cookie(COOKIE[scope], token, cookieOptions(scope));
  return { accessToken: signAccessToken(user, scope), user: S.user(user) };
}

// ----------------------------------------------------------------------------- register / login

export async function register({ fullName, email, phone, password }) {
  const exists = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (exists) throw ApiError.conflict('An account with this email already exists', [{ field: 'email', message: 'Email is already registered' }]);
  // Role is never taken from input: every self-registered account is a USER.
  const user = await prisma.user.create({
    data: { fullName, email, phone, passwordHash: await hashPassword(password), role: 'USER' },
  });
  await notify(user.id, { title: 'Welcome to TUSKY!', message: 'Your one free prediction is ready to use.', type: 'SUCCESS' });
  await activity(user.id, 'account', 'Created a TUSKY account');
  return S.user(user);
}

async function checkCredentials(email, password) {
  const user = await prisma.user.findUnique({ where: { email }, include: { favouriteSports: { include: { sport: true } } } });
  const okPw = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
  if (!user || !okPw) throw ApiError.unauthorized('Incorrect email or password');
  if (user.accountStatus !== 'ACTIVE') throw ApiError.forbidden('This account has been blocked by an administrator. Contact support.');
  return user;
}

export async function login({ email, password }, req, res) {
  const user = await checkCredentials(email, password);
  await activity(user.id, 'account', 'Logged in');
  return startSession(user, 'user', req, res);
}

export async function adminLogin({ email, password, code }, req, res) {
  const user = await checkCredentials(email, password);
  // Same generic message as a wrong password, so the endpoint doesn't reveal which accounts are admins.
  if (user.role !== 'ADMIN') throw ApiError.unauthorized('Incorrect email or password');
  await checkSecondFactor(user, code);
  return startSession(user, 'admin', req, res);
}

// ----------------------------------------------------------------------------- refresh / logout

/** Rotates the refresh token. Re-use of an already-rotated token revokes the whole family. */
export async function refresh(scope, req, res) {
  const presented = req.cookies?.[COOKIE[scope]];
  if (!presented) throw ApiError.unauthorized('No active session');

  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.refreshToken.findUnique({ where: { tokenHash: sha256(presented) }, include: { user: true } });
    if (!row || row.scope !== scope) return { error: 'invalid' };
    if (row.revokedAt) {
      // Token theft signal: someone is replaying an old token.
      await tx.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      return { error: 'reused' };
    }
    if (row.expiresAt <= new Date()) return { error: 'expired' };
    if (row.user.accountStatus !== 'ACTIVE') return { error: 'blocked' };
    if (scope === 'admin' && row.user.role !== 'ADMIN') return { error: 'invalid' };

    const next = await createRefreshToken(row.userId, scope, req, row.familyId, tx);
    const revoked = await tx.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date(), replacedBy: next.row.id } });
    if (revoked.count !== 1) return { error: 'reused' }; // lost a race with a concurrent refresh
    const user = await tx.user.findUnique({ where: { id: row.userId }, include: { favouriteSports: { include: { sport: true } } } });
    return { token: next.token, user };
  });

  if (result.error) {
    clearSessionCookie(res, scope);
    if (result.error === 'blocked') throw ApiError.forbidden('This account has been blocked by an administrator.');
    throw ApiError.unauthorized(result.error === 'expired' ? 'Session expired. Please log in again.' : 'Invalid session. Please log in again.');
  }
  res.cookie(COOKIE[scope], result.token, cookieOptions(scope));
  return { accessToken: signAccessToken(result.user, scope), user: S.user(result.user) };
}

export async function logout(scope, req, res) {
  const presented = req.cookies?.[COOKIE[scope]];
  if (presented) {
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(presented) } });
    if (row) await prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  clearSessionCookie(res, scope);
}

/** Signs out this account's other admin sessions, keeping the one making the request. */
export async function revokeOtherAdminSessions(userId, req) {
  const presented = req.cookies?.[COOKIE.admin];
  const current = presented ? await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(presented) } }) : null;
  await prisma.refreshToken.updateMany({
    where: { userId, scope: 'admin', revokedAt: null, ...(current?.userId === userId ? { NOT: { familyId: current.familyId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

export const revokeAllSessions = (userId, db = prisma) =>
  db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });

// ----------------------------------------------------------------------------- profile & passwords

export async function getProfile(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { favouriteSports: { include: { sport: true } } } });
  if (!user) throw ApiError.notFound('User not found');
  return S.user(user);
}

export async function updateProfile(userId, { fullName, email, phone }) {
  if (email) {
    const clash = await prisma.user.findFirst({ where: { email, NOT: { id: userId } }, select: { id: true } });
    if (clash) throw ApiError.conflict('Email is already in use', [{ field: 'email', message: 'Email is already in use' }]);
  }
  await prisma.user.update({ where: { id: userId }, data: { fullName, email, phone } });
  await activity(userId, 'account', 'Updated profile details');
  return getProfile(userId);
}

export async function changePassword(userId, currentPassword, newPassword, req, res, scope = 'user') {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw ApiError.validation([{ field: 'currentPassword', message: 'Current password is incorrect' }], 'Current password is incorrect');
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } }),
    prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await activity(userId, 'account', 'Changed password');
  // Other devices are signed out; keep this one signed in with a fresh session.
  return startSession(user, scope, req, res);
}

/** Always resolves the same way so the endpoint can't be used to discover accounts. */
export async function forgotPassword(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.accountStatus !== 'ACTIVE') return;
  const token = randomToken(32);
  await prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60_000) },
  });
  const link = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  const mail = passwordResetEmail(user.fullName, link);
  // Not awaited: a slow or broken mail server must not reveal that the account exists.
  sendMail({ to: user.email, ...mail }).catch((err) => logger.error({ err }, 'Password reset email failed'));
}

export async function resetPassword(token, newPassword) {
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.usedAt || row.expiresAt <= new Date()) throw ApiError.badRequest('This reset link is invalid or has expired. Request a new one.');
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(newPassword) } }),
    prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await activity(row.userId, 'account', 'Reset password via email link');
}
