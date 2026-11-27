// Two-factor sign-in for administrators: an authenticator-app code on top of the
// password, with one-use recovery codes for a lost phone. Optional per account.
// Lost both? `npm run admin:2fa-reset -- --email you@example.com` on the server.
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { ApiError } from '../utils/apiResponse.js';
import { sha256 } from '../utils/generateToken.js';
import { matchingStep, newSecret, otpauthUrl, seal, unseal } from '../utils/totp.js';

const RECOVERY_CODES = 8;

const normalise = (code) => String(code || '').replace(/[\s-]/g, '').toLowerCase();
const fieldError = (field, message) => ApiError.validation([{ field, message }], message);
const load = (userId) => prisma.user.findUnique({ where: { id: userId } });

async function requirePassword(user, password) {
  if (!(await bcrypt.compare(String(password || ''), user.passwordHash))) throw fieldError('password', 'Password is incorrect');
}

/** Accepts an app code (each usable once) or an unused recovery code. */
export async function consumeCode(user, input) {
  const code = normalise(input);
  const step = matchingStep(unseal(user.totpSecret), code);
  if (step !== null) {
    // compare-and-set: the same code cannot be used twice, even at the same moment
    const { count } = await prisma.user.updateMany({
      where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step },
    });
    return count === 1;
  }
  if (!/^[a-f0-9]{10}$/.test(code)) return false;
  return prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
    const fresh = await db.user.findUnique({ where: { id: user.id } });
    const left = Array.isArray(fresh.totpRecovery) ? fresh.totpRecovery : [];
    if (!left.includes(sha256(code))) return false;
    await db.user.update({ where: { id: user.id }, data: { totpRecovery: left.filter((h) => h !== sha256(code)) } });
    return true;
  });
}

/** Called after the password check. Throws unless the second factor is satisfied. */
export async function checkSecondFactor(user, code) {
  if (!user.totpEnabledAt) return;
  const need = (message) => new ApiError(401, message, [{ field: 'code', message }]);
  if (!code) throw need('Enter the 6-digit code from your authenticator app');
  if (!(await consumeCode(user, code))) throw need('That code is not valid. Try the newest one.');
}

export async function status(userId) {
  const user = await load(userId);
  return {
    enabled: Boolean(user.totpEnabledAt),
    recoveryCodesLeft: user.totpEnabledAt && Array.isArray(user.totpRecovery) ? user.totpRecovery.length : 0,
  };
}

/** Step 1: create a secret for the authenticator app. Nothing changes until it is confirmed. */
export async function setup(userId, password) {
  const user = await load(userId);
  await requirePassword(user, password);
  if (user.totpEnabledAt) throw ApiError.conflict('Two-factor sign-in is already on.');
  const secret = newSecret();
  await prisma.user.update({ where: { id: userId }, data: { totpSecret: seal(secret), totpLastStep: null } });
  return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
}

/** Step 2: prove the app works, then switch it on. Recovery codes are shown only here. */
export async function enable(userId, code) {
  const user = await load(userId);
  if (user.totpEnabledAt) throw ApiError.conflict('Two-factor sign-in is already on.');
  if (!user.totpSecret) throw ApiError.badRequest('Start the setup first.');
  const step = matchingStep(unseal(user.totpSecret), normalise(code));
  if (step === null) throw fieldError('code', 'That code is not valid. Check your phone’s clock and try the newest code.');
  const codes = Array.from({ length: RECOVERY_CODES }, () => crypto.randomBytes(5).toString('hex'));
  await prisma.user.update({ where: { id: userId }, data: { totpEnabledAt: new Date(), totpLastStep: step, totpRecovery: codes.map(sha256) } });
  return { recoveryCodes: codes.map((c) => `${c.slice(0, 5)}-${c.slice(5)}`) };
}

export async function disable(userId, password, code) {
  const user = await load(userId);
  await requirePassword(user, password);
  if (!user.totpEnabledAt) throw ApiError.badRequest('Two-factor sign-in is not on.');
  if (!(await consumeCode(user, code))) throw fieldError('code', 'That code is not valid');
  await prisma.user.update({ where: { id: userId }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, totpRecovery: Prisma.DbNull } });
}
