// User dashboard data. Every query is scoped to req.user.id, so one user can
// never read another user's purchases, transactions, wallet or trial.
import { prisma } from '../config/database.js';
import { ApiError, ok, paginate } from '../utils/apiResponse.js';
import { money } from '../utils/money.js';
import * as payments from '../services/paymentService.js';
import * as trials from '../services/trialService.js';
import * as subs from '../services/subscriptionService.js';
import { activity } from '../services/notificationService.js';
import * as S from '../services/serializers.js';

const TXN_INCLUDE = { match: { include: { teamA: true, teamB: true } }, plan: true };

async function purchasesFor(userId) {
  const [rows, trial] = await Promise.all([
    prisma.purchase.findMany({ where: { userId, purchaseStatus: 'ACTIVE' }, include: { match: { include: S.MATCH_INCLUDE }, transaction: true }, orderBy: { purchasedAt: 'desc' } }),
    prisma.freeTrial.findUnique({ where: { userId }, include: { match: { include: S.MATCH_INCLUDE } } }),
  ]);
  const list = rows.map((p) => ({
    matchId: p.matchId,
    match: S.match(p.match, 'purchase'),
    amount: money(p.amount),
    method: S.transaction({ ...p.transaction, match: null, plan: null }).method,
    date: p.purchasedAt,
    reference: p.transaction.transactionReference,
    via: 'purchase',
  }));
  if (trial?.trialStatus === 'USED' && !rows.some((r) => r.matchId === trial.matchId)) {
    list.push({ matchId: trial.matchId, match: S.match(trial.match, 'trial'), amount: 0, method: 'Free Trial', date: trial.activatedAt, reference: 'FREE-TRIAL', via: 'trial' });
  }
  return list.sort((a, b) => new Date(b.date) - new Date(a.date));
}

export async function purchases(req, res) {
  ok(res, { items: await purchasesFor(req.user.id) });
}

export async function transactions(req, res) {
  const { skip, take, meta } = paginate(req.query, { defaultLimit: 50 });
  const where = { userId: req.user.id };
  const types = { prediction: 'PREDICTION', subscription: 'SUBSCRIPTION', wallet: 'WALLET_TOPUP' };
  if (types[req.query.type]) where.transactionType = types[req.query.type];
  const [rows, total] = await Promise.all([
    prisma.transaction.findMany({ where, include: TXN_INCLUDE, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.transaction.count({ where }),
  ]);
  ok(res, { items: rows.map(S.transaction), pagination: meta(total) });
}

export async function wallet(req, res) {
  ok(res, await payments.walletOverview(req.user.id));
}

export async function activityTimeline(req, res) {
  const rows = await prisma.activityLog.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 30 });
  ok(res, { items: rows.map((a) => ({ id: a.id, kind: a.kind, text: a.description, date: a.createdAt })) });
}

export async function setFavourites(req, res) {
  const slugs = [...new Set(req.valid.body.sports)];
  const sports = await prisma.sport.findMany({ where: { slug: { in: slugs }, status: 'ACTIVE' } });
  if (sports.length !== slugs.length) throw ApiError.validation([{ field: 'sports', message: 'Unknown sport in list' }]);
  await prisma.$transaction([
    prisma.userFavouriteSport.deleteMany({ where: { userId: req.user.id } }),
    prisma.userFavouriteSport.createMany({ data: sports.map((s) => ({ userId: req.user.id, sportId: s.id })) }),
  ]);
  await activity(req.user.id, 'account', 'Updated favourite sports');
  ok(res, { favourites: sports.map((s) => s.slug) }, 'Favourite sports updated');
}

export async function trialStatus(req, res) {
  ok(res, await trials.trialStatus(req.user.id));
}

export async function activateTrial(req, res) {
  ok(res, await trials.activateTrial(req.user, req.valid.body.matchId), 'Free trial activated', 201);
}

/** Everything the dashboard overview needs in one round trip. */
export async function dashboard(req, res) {
  const userId = req.user.id;
  const now = new Date();
  const [user, purchaseList, trial, sub, balance, upcomingCount, recentTxns, unread, notes, recentActivity] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, include: { favouriteSports: { include: { sport: true } } } }),
    purchasesFor(userId),
    trials.trialStatus(userId),
    subs.userSubscriptionStatus(userId),
    payments.walletBalance(userId),
    prisma.match.count({ where: { published: true, archivedAt: null, startsAt: { gt: now }, status: { in: ['UPCOMING', 'POSTPONED'] } } }),
    prisma.transaction.findMany({ where: { userId }, include: TXN_INCLUDE, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.notification.count({ where: { userId, isRead: false } }),
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.activityLog.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 8 }),
  ]);
  ok(res, {
    user: S.user(user),
    stats: { purchased: purchaseList.length, upcomingMatches: upcomingCount, walletBalance: money(balance), unreadNotifications: unread },
    trial,
    subscription: sub.current,
    recentPurchases: purchaseList.slice(0, 6),
    recentTransactions: recentTxns.map(S.transaction),
    notifications: notes.map(S.notification),
    activity: recentActivity.map((a) => ({ id: a.id, kind: a.kind, text: a.description, date: a.createdAt })),
  });
}
