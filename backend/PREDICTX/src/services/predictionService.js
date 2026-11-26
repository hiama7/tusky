// =============================================================================
// Prediction access control + validation + versioning.
//
// ACCESS RULE (checked on the server for every prediction request):
//   purchase (ACTIVE) for this user+match      → full prediction
//   else free trial used on this match          → full prediction
//   else active subscription covering the sport → full prediction
//   else                                        → locked preview only
// =============================================================================
import { prisma } from '../config/database.js';
import { ApiError } from '../utils/apiResponse.js';
import { toDecimal } from '../utils/money.js';
import * as S from './serializers.js';

/** Returns the active subscriptions that grant access right now (with plan sport policy). */
export function activeSubscriptions(userId, db = prisma) {
  const now = new Date();
  return db.userSubscription.findMany({
    where: { userId, subscriptionStatus: 'ACTIVE', startDate: { lte: now }, endDate: { gt: now } },
    include: { plan: { include: { sports: true } } },
  });
}

const planCovers = (plan, sportId) => plan.allSports || plan.sports.some((s) => s.sportId === sportId);

/**
 * Access reasons for many matches at once (used by list endpoints).
 * Returns Map<matchId, 'purchase'|'trial'|'subscription'|null>.
 */
export async function accessMap(userId, matches, db = prisma) {
  const result = new Map(matches.map((m) => [m.id, null]));
  if (!userId || !matches.length) return result;
  const ids = matches.map((m) => m.id);
  const [purchases, trial, subs] = await Promise.all([
    db.purchase.findMany({ where: { userId, matchId: { in: ids }, purchaseStatus: 'ACTIVE' }, select: { matchId: true } }),
    db.freeTrial.findUnique({ where: { userId } }),
    activeSubscriptions(userId, db),
  ]);
  const bought = new Set(purchases.map((p) => p.matchId));
  for (const m of matches) {
    if (bought.has(m.id)) result.set(m.id, 'purchase');
    else if (trial && trial.trialStatus === 'USED' && trial.matchId === m.id) result.set(m.id, 'trial');
    else if (subs.some((s) => planCovers(s.plan, m.sportId))) result.set(m.id, 'subscription');
  }
  return result;
}

export async function accessFor(userId, match, db = prisma) {
  return (await accessMap(userId, [match], db)).get(match.id);
}

/** Public/user view of a match prediction: full content only with an entitlement. */
export async function predictionForViewer(matchId, userId) {
  const match = await prisma.match.findFirst({
    where: { id: matchId, published: true, archivedAt: null },
    include: { prediction: true },
  });
  if (!match) throw ApiError.notFound('Match not found');
  const published = match.prediction?.publicationStatus === 'PUBLISHED';
  const reason = userId ? await accessFor(userId, match) : null;
  // Buyers/trial users keep access if an admin later unpublishes the prediction (it only stops new sales).
  // Drafts and subscription access never reveal unpublished content.
  const keepsAccess = (reason === 'purchase' || reason === 'trial') && match.prediction?.publishedAt;
  if (!published && !keepsAccess) return { ...S.lockedPrediction(match, { available: false }), unlocked: Boolean(reason), unlockReason: reason };
  if (!reason) return S.lockedPrediction(match, { available: true });
  return { locked: false, unlockReason: reason, prediction: S.prediction(match.prediction) };
}

// ----------------------------------------------------------------------------- validation

/**
 * Validates probabilities for the outcome format and returns normalised values.
 * TWO_WAY: A + B = 100 (no draw). THREE_WAY: A + B + Draw = 100.
 */
export function validateProbabilities({ outcomeFormat, teamAProbability, teamBProbability, drawProbability, predictedOutcome }) {
  const a = toDecimal(teamAProbability);
  const b = toDecimal(teamBProbability);
  const errors = [];
  for (const [field, v] of [['teamAProbability', a], ['teamBProbability', b]]) {
    if (v.lt(0) || v.gt(100)) errors.push({ field, message: 'Must be between 0 and 100' });
  }
  let d = null;
  if (outcomeFormat === 'THREE_WAY') {
    if (drawProbability === undefined || drawProbability === null || drawProbability === '') {
      throw ApiError.validation([{ field: 'drawProbability', message: 'A draw probability is required for three-outcome matches' }], 'Invalid prediction probabilities');
    }
    d = toDecimal(drawProbability);
    if (d.lt(0) || d.gt(100)) errors.push({ field: 'drawProbability', message: 'Must be between 0 and 100' });
    if (!a.plus(b).plus(d).eq(100)) errors.push({ field: 'drawProbability', message: 'Team A + Team B + Draw must total exactly 100%' });
  } else {
    if (drawProbability !== undefined && drawProbability !== null && !toDecimal(drawProbability).eq(0)) {
      errors.push({ field: 'drawProbability', message: 'Two-outcome predictions cannot have a draw probability' });
    }
    if (!a.plus(b).eq(100)) errors.push({ field: 'teamBProbability', message: 'Team A + Team B must total exactly 100%' });
  }
  if (predictedOutcome === 'DRAW' && outcomeFormat !== 'THREE_WAY') {
    errors.push({ field: 'predictedOutcome', message: 'A draw cannot be predicted for a two-outcome match' });
  }
  if (errors.length) throw ApiError.validation(errors, 'Invalid prediction probabilities');

  // Default the predicted outcome to the most likely result.
  let outcome = predictedOutcome;
  if (!outcome) {
    const opts = [['TEAM_A', a], ['TEAM_B', b], ...(d ? [['DRAW', d]] : [])];
    outcome = opts.reduce((best, cur) => (cur[1].gt(best[1]) ? cur : best))[0];
  }
  return { teamAProbability: a, teamBProbability: b, drawProbability: d, predictedOutcome: outcome };
}

/** Immutable snapshot stored with every publish (audit + later accuracy evaluation). */
export function snapshotOf(p, match) {
  return {
    ...S.prediction(p),
    match: { id: match.id, startsAt: match.startsAt, teamAId: match.teamAId, teamBId: match.teamBId, sportId: match.sportId },
    snapshotAt: new Date().toISOString(),
  };
}
