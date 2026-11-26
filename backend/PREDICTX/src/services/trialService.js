// =============================================================================
// One-time free trial.
// Enforced by MySQL: free_trials.user_id is UNIQUE, and activation runs in a
// transaction that first locks the user row (SELECT … FOR UPDATE) so concurrent
// requests for the same account are serialised. Nothing is stored in the browser.
// =============================================================================
import { prisma } from '../config/database.js';
import { ApiError } from '../utils/apiResponse.js';
import { activity, notify } from './notificationService.js';
import { accessFor } from './predictionService.js';
import * as S from './serializers.js';

export async function trialStatus(userId) {
  const trial = await prisma.freeTrial.findUnique({ where: { userId }, include: { match: { include: S.MATCH_INCLUDE } } });
  if (!trial) return { status: 'available', matchId: null, activatedAt: null, match: null };
  return {
    status: trial.trialStatus === 'USED' ? 'used' : 'revoked',
    matchId: trial.matchId,
    activatedAt: trial.activatedAt,
    match: S.match(trial.match),
  };
}

export async function activateTrial(user, matchId) {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;

      if (await tx.freeTrial.findUnique({ where: { userId: user.id } })) {
        throw ApiError.conflict('Your free trial has already been used.');
      }
      const match = await tx.match.findFirst({
        where: { id: matchId, published: true, archivedAt: null },
        include: { prediction: true, teamA: true, teamB: true },
      });
      if (!match) throw ApiError.notFound('Match not found');
      if (match.prediction?.publicationStatus !== 'PUBLISHED') throw ApiError.badRequest('This match has no published prediction yet.');
      if (['COMPLETED', 'CANCELLED'].includes(match.status)) throw ApiError.badRequest('The free trial can only be used on upcoming matches.');
      const existing = await accessFor(user.id, match, tx);
      if (existing === 'purchase') throw ApiError.conflict('You already own this prediction — choose a locked match instead.');

      const trial = await tx.freeTrial.create({ data: { userId: user.id, matchId: match.id } });
      const name = `${match.teamA.name} vs ${match.teamB.name}`;
      await notify(user.id, { title: 'Free trial activated', message: `${name} has been unlocked for free.`, type: 'SUCCESS' }, tx);
      await activity(user.id, 'trial', `Used free trial on ${name}`, tx);
      return { status: 'used', matchId: trial.matchId, activatedAt: trial.activatedAt };
    });
  } catch (err) {
    // Unique constraint hit by a concurrent request that slipped past the lock.
    if (err.code === 'P2002') throw ApiError.conflict('Your free trial has already been used.');
    throw err;
  }
}
