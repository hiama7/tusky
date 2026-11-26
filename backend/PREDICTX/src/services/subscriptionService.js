// Subscription status, history and cancellation. Access checks live in
// predictionService.activeSubscriptions (server-side, every request).
import { prisma } from '../config/database.js';
import { ApiError } from '../utils/apiResponse.js';
import { activity, notify } from './notificationService.js';
import * as S from './serializers.js';

/** Marks lapsed ACTIVE subscriptions as EXPIRED (cheap, called on read). */
export function expireLapsed(userId) {
  return prisma.userSubscription.updateMany({
    where: { ...(userId ? { userId } : {}), subscriptionStatus: 'ACTIVE', endDate: { lte: new Date() } },
    data: { subscriptionStatus: 'EXPIRED' },
  });
}

export async function listPlans({ includeInactive = false } = {}) {
  const plans = await prisma.subscriptionPlan.findMany({
    where: includeInactive ? {} : { status: 'ACTIVE' },
    include: { sports: { include: { sport: true } } },
    orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
  });
  return plans.map(S.plan);
}

export async function userSubscriptionStatus(userId) {
  await expireLapsed(userId);
  const subs = await prisma.userSubscription.findMany({
    where: { userId },
    include: { plan: { include: { sports: { include: { sport: true } } } } },
    orderBy: { startDate: 'desc' },
  });
  const now = new Date();
  const current = subs.find((s) => s.subscriptionStatus === 'ACTIVE' && s.startDate <= now && s.endDate > now) || null;
  const queued = subs.filter((s) => s.subscriptionStatus === 'ACTIVE' && s.startDate > now);
  return {
    current: current && S.subscription(current),
    queued: queued.map(S.subscription),
    history: subs.map(S.subscription),
  };
}

/**
 * Cancels the user's active (and queued) subscriptions. Access ends immediately;
 * refunds, if any, are handled by an admin through the transactions screen.
 */
export async function cancel(user) {
  const now = new Date();
  const { count } = await prisma.userSubscription.updateMany({
    where: { userId: user.id, subscriptionStatus: 'ACTIVE', endDate: { gt: now } },
    data: { subscriptionStatus: 'CANCELLED', cancelledAt: now },
  });
  if (!count) throw ApiError.notFound('You have no active subscription to cancel.');
  await notify(user.id, { title: 'Subscription cancelled', message: 'Individual purchases and your free-trial unlock remain available.', type: 'WARNING' });
  await activity(user.id, 'subscription', 'Cancelled subscription');
  return { cancelled: count };
}
