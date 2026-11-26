// Admin: dashboard, analytics, users, transactions/refunds, subscriptions & plans,
// audit log and integrations. Every route is behind requireAdmin.
import { prisma } from '../config/database.js';
import { ApiError, created, ok, paginate } from '../utils/apiResponse.js';
import { money, toDecimal } from '../utils/money.js';
import * as analytics from '../services/analyticsService.js';
import * as payments from '../services/paymentService.js';
import * as subs from '../services/subscriptionService.js';
import * as integrations from '../services/sportsDataService.js';
import { revokeAllSessions } from '../services/authService.js';
import { adminLog } from '../services/notificationService.js';
import * as S from '../services/serializers.js';

// ----------------------------------------------------------------------------- dashboard & analytics

export async function dashboard(_req, res) {
  const [stats, series, bySport, recent] = await Promise.all([
    analytics.dashboardStats(),
    analytics.revenueSeries('30d'),
    analytics.salesBySport(),
    prisma.transaction.findMany({ include: { user: true, match: { include: { teamA: true, teamB: true } }, plan: true }, orderBy: { createdAt: 'desc' }, take: 8 }),
  ]);
  ok(res, { stats, revenue30d: series, salesBySport: bySport, recentTransactions: recent.map(S.transaction) });
}

export async function revenue(req, res) {
  ok(res, await analytics.revenueSeries(req.valid.query.range));
}

export async function analyticsOverview(_req, res) {
  const [weekly, monthly, yearly, growth, performance, bySport, stats] = await Promise.all([
    analytics.revenueSeries('12w'),
    analytics.revenueSeries('12m'),
    analytics.revenueSeries('5y'),
    analytics.subscriberGrowth(),
    analytics.predictionPerformance(),
    analytics.salesBySport(),
    analytics.dashboardStats(),
  ]);
  ok(res, { weekly, monthly, yearly, subscriberGrowth: growth, predictionPerformance: performance, salesBySport: bySport, totals: stats.revenue, refunds: stats.refunds, transactions: stats.transactions });
}

// ----------------------------------------------------------------------------- users

export async function listUsers(req, res) {
  const q = req.valid.query;
  const { skip, take, meta } = paginate(q);
  const now = new Date();
  const where = { role: 'USER' };
  if (q.status === 'Active' || q.status === 'ACTIVE') where.accountStatus = 'ACTIVE';
  if (q.status === 'Blocked' || q.status === 'BLOCKED') where.accountStatus = 'BLOCKED';
  if (q.q) where.OR = [{ fullName: { contains: q.q } }, { email: { contains: q.q } }, ...(/^\d+$/.test(q.q) ? [{ id: Number(q.q) }] : [])];
  if (q.subscription === 'Active') where.subscriptions = { some: { subscriptionStatus: 'ACTIVE', startDate: { lte: now }, endDate: { gt: now } } };
  if (q.subscription === 'None') where.subscriptions = { none: {} };
  if (q.subscription === 'Expired') where.AND = [{ subscriptions: { some: {} } }, { subscriptions: { none: { subscriptionStatus: 'ACTIVE', endDate: { gt: now } } } }];

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: {
        _count: { select: { purchases: { where: { purchaseStatus: 'ACTIVE' } } } },
        subscriptions: { where: { subscriptionStatus: 'ACTIVE', startDate: { lte: now }, endDate: { gt: now } }, take: 1 },
        freeTrial: true,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.user.count({ where }),
  ]);
  const spent = await prisma.transaction.groupBy({
    by: ['userId'],
    where: { userId: { in: rows.map((r) => r.id) }, transactionType: { in: ['PREDICTION', 'SUBSCRIPTION'] }, paymentStatus: { in: ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
    _sum: { amount: true, refundedAmount: true },
  });
  const spentBy = Object.fromEntries(spent.map((s) => [s.userId, toDecimal(s._sum.amount).minus(s._sum.refundedAmount ?? 0)]));
  ok(res, {
    items: rows.map((u) => ({
      ...S.user(u),
      subscription: u.subscriptions.length ? 'Active' : 'None',
      purchases: u._count.purchases,
      spent: money(spentBy[u.id] ?? 0),
      trial: u.freeTrial ? 'Used' : 'Available',
    })),
    pagination: meta(total),
  });
}

export async function userDetails(req, res) {
  const id = req.valid.params.id;
  const u = await prisma.user.findUnique({
    where: { id },
    include: {
      purchases: { include: { match: { include: S.MATCH_INCLUDE } }, orderBy: { purchasedAt: 'desc' } },
      subscriptions: { include: { plan: true }, orderBy: { startDate: 'desc' } },
      freeTrial: { include: { match: { include: S.MATCH_INCLUDE } } },
      transactions: { include: { match: { include: { teamA: true, teamB: true } }, plan: true }, orderBy: { createdAt: 'desc' }, take: 50 },
    },
  });
  if (!u) throw ApiError.notFound('User not found');
  ok(res, {
    user: S.user(u),
    purchases: u.purchases.map((p) => ({ match: S.match(p.match), amount: money(p.amount), status: p.purchaseStatus, date: p.purchasedAt })),
    subscriptions: u.subscriptions.map(S.subscription),
    trial: u.freeTrial ? { status: u.freeTrial.trialStatus, activatedAt: u.freeTrial.activatedAt, match: S.match(u.freeTrial.match) } : null,
    transactions: u.transactions.map(S.transaction),
    walletBalance: money(await payments.walletBalance(u.id)),
  });
}

export async function setUserStatus(req, res) {
  const id = req.valid.params.id;
  const status = req.valid.body.status;
  if (id === req.admin.id) throw ApiError.badRequest('You cannot block your own account.');
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw ApiError.notFound('User not found');
  if (target.role === 'ADMIN') throw ApiError.forbidden('Administrator accounts cannot be blocked here.');
  await prisma.user.update({ where: { id }, data: { accountStatus: status } });
  if (status === 'BLOCKED') await revokeAllSessions(id); // signs the user out everywhere
  await adminLog(req, status === 'BLOCKED' ? 'USER_BLOCKED' : 'USER_UNBLOCKED', `${status === 'BLOCKED' ? 'Blocked' : 'Unblocked'} ${target.email}`, { entityType: 'user', entityId: id });
  ok(res, { id, status: status === 'ACTIVE' ? 'Active' : 'Blocked' }, `User ${status === 'BLOCKED' ? 'blocked' : 'unblocked'}`);
}

// ----------------------------------------------------------------------------- transactions

const TXN_STATUS = { Success: 'CAPTURED', Pending: 'CREATED', Failed: 'FAILED', Refunded: 'REFUNDED', 'Partially refunded': 'PARTIALLY_REFUNDED' };
const TXN_TYPE = { prediction: 'PREDICTION', subscription: 'SUBSCRIPTION', wallet: 'WALLET_TOPUP' };

export async function listTransactions(req, res) {
  const q = req.valid.query;
  const { skip, take, meta } = paginate(q, { defaultLimit: 50 });
  const where = {};
  if (TXN_STATUS[q.status]) where.paymentStatus = TXN_STATUS[q.status];
  if (TXN_TYPE[q.type]) where.transactionType = TXN_TYPE[q.type];
  if (q.q) where.OR = [{ transactionReference: { contains: q.q } }, { gatewayPaymentId: { contains: q.q } }, { user: { fullName: { contains: q.q } } }, { user: { email: { contains: q.q } } }];
  const [rows, total, summary] = await Promise.all([
    prisma.transaction.findMany({ where, include: { user: true, match: { include: { teamA: true, teamB: true } }, plan: true, refunds: true }, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.transaction.count({ where }),
    prisma.transaction.groupBy({ by: ['paymentStatus'], _count: true }),
  ]);
  ok(res, {
    items: rows.map((t) => ({ ...S.transaction(t), refunds: t.refunds.map((r) => ({ id: r.id, amount: money(r.amount), status: r.refundStatus, reason: r.reason, date: r.createdAt })) })),
    pagination: meta(total),
    counts: Object.fromEntries(summary.map((s) => [s.paymentStatus, s._count])),
  });
}

export async function refund(req, res) {
  const id = req.valid.params.id;
  const result = await payments.refundTransaction(req.admin.id, id, req.valid.body);
  await adminLog(req, 'REFUND_ISSUED', `Refunded ₹${result.refunded} on transaction #${id}: ${req.valid.body.reason}`, { entityType: 'transaction', entityId: id });
  ok(res, result, 'Refund issued');
}

// ----------------------------------------------------------------------------- subscriptions & plans

export async function listSubscriptions(req, res) {
  const q = req.valid.query;
  const { skip, take, meta } = paginate(q, { defaultLimit: 50 });
  await subs.expireLapsed();
  const map = { Active: 'ACTIVE', Expired: 'EXPIRED', Cancelled: 'CANCELLED' };
  const where = map[q.status] ? { subscriptionStatus: map[q.status] } : {};
  const [rows, total, counts, revenueAgg] = await Promise.all([
    prisma.userSubscription.findMany({ where, include: { user: true, plan: true, transaction: true }, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.userSubscription.count({ where }),
    prisma.userSubscription.groupBy({ by: ['subscriptionStatus'], _count: true }),
    prisma.transaction.aggregate({ where: { transactionType: 'SUBSCRIPTION', paymentStatus: { in: ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, _sum: { amount: true, refundedAmount: true } }),
  ]);
  const perPlan = await prisma.userSubscription.groupBy({ by: ['planId'], _count: true });
  ok(res, {
    items: rows.map((s) => ({ ...S.subscription(s), customer: s.user.fullName, email: s.user.email, planName: s.plan.planName, amount: money(s.transaction.amount), reference: s.transaction.transactionReference })),
    pagination: meta(total),
    counts: Object.fromEntries(counts.map((c) => [c.subscriptionStatus, c._count])),
    perPlan: Object.fromEntries(perPlan.map((p) => [p.planId, p._count])),
    revenue: { gross: money(revenueAgg._sum.amount ?? 0), refunds: money(revenueAgg._sum.refundedAmount ?? 0), net: money(toDecimal(revenueAgg._sum.amount).minus(revenueAgg._sum.refundedAmount ?? 0)) },
  });
}

export async function listPlans(_req, res) {
  ok(res, { plans: await subs.listPlans({ includeInactive: true }) });
}

async function writePlan(req, id) {
  const { sportIds, ...data } = req.valid.body;
  const planData = { ...data, sports: { deleteMany: id ? {} : undefined, create: data.allSports ? [] : sportIds.map((sportId) => ({ sportId })) } };
  if (!id) delete planData.sports.deleteMany;
  if (!data.allSports && !sportIds.length) throw ApiError.validation([{ field: 'sportIds', message: 'Pick at least one sport, or allow all sports' }]);
  return id
    ? prisma.subscriptionPlan.update({ where: { id }, data: planData, include: { sports: { include: { sport: true } } } })
    : prisma.subscriptionPlan.create({ data: planData, include: { sports: { include: { sport: true } } } });
}

export async function createPlan(req, res) {
  const plan = await writePlan(req);
  await adminLog(req, 'PLAN_CREATED', `Created plan ${plan.planName} (₹${money(plan.price)}/${plan.durationDays}d)`, { entityType: 'plan', entityId: plan.id });
  created(res, { plan: S.plan(plan) }, 'Plan created');
}

export async function updatePlan(req, res) {
  const id = req.valid.params.id;
  const plan = await writePlan(req, id);
  await adminLog(req, 'PLAN_UPDATED', `Updated plan ${plan.planName} (₹${money(plan.price)}/${plan.durationDays}d, ${plan.status})`, { entityType: 'plan', entityId: id });
  ok(res, { plan: S.plan(plan) }, 'Plan updated');
}

// ----------------------------------------------------------------------------- audit log & integrations

export async function adminLogs(req, res) {
  const { skip, take, meta } = paginate(req.query, { defaultLimit: 50 });
  const [rows, total] = await Promise.all([
    prisma.adminLog.findMany({ include: { admin: { select: { fullName: true, email: true } } }, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.adminLog.count(),
  ]);
  ok(res, { items: rows.map((l) => ({ id: l.id, admin: l.admin.fullName, action: l.action, description: l.description, entityType: l.entityType, entityId: l.entityId, ip: l.ipAddress, date: l.createdAt })), pagination: meta(total) });
}

export async function integrationStatus(_req, res) {
  ok(res, integrations.integrationStatus());
}

export async function importNews(req, res) {
  const result = await integrations.importNews();
  await adminLog(req, 'NEWS_IMPORT', `News import from ${result.provider}: ${result.imported} imported, ${result.skipped} skipped`);
  ok(res, result, result.message || 'Import finished');
}
