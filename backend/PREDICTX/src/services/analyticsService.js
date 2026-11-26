// =============================================================================
// Admin statistics and revenue analytics — all computed in MySQL.
//
// Revenue rules
//  * Sales = prediction + subscription transactions whose payment was CAPTURED
//    (including ones later refunded), dated by capture time. Each transaction is
//    one row with a UNIQUE gateway payment id, so a payment can't be counted twice.
//  * Refunds = PROCESSED refunds on those transactions, dated by processing time.
//  * Net revenue = sales − refunds.
//  * Wallet top-ups are customer credit (a liability), NOT revenue; revenue is
//    recognised when wallet credit is spent on a prediction or plan.
// =============================================================================
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { money, toDecimal } from '../utils/money.js';

const SALE_TYPES = ['PREDICTION', 'SUBSCRIPTION'];
const PAID = ['CAPTURED', 'REFUNDED', 'PARTIALLY_REFUNDED'];
const OFFSET = env.REPORT_TZ_OFFSET_MINUTES;

/** Start of the local day/week/month/year, returned as a UTC Date. */
function localStart(unit, now = new Date()) {
  const local = new Date(now.getTime() + OFFSET * 60_000);
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  if (unit === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday
  if (unit === 'month') d.setUTCDate(1);
  if (unit === 'year') { d.setUTCMonth(0); d.setUTCDate(1); }
  return new Date(d.getTime() - OFFSET * 60_000);
}

async function revenueBetween(from, to = new Date(), types = SALE_TYPES) {
  const range = { gte: from, lt: to };
  const [sales, refunds] = await Promise.all([
    prisma.transaction.aggregate({ where: { transactionType: { in: types }, paymentStatus: { in: PAID }, capturedAt: range }, _sum: { amount: true }, _count: true }),
    prisma.refund.aggregate({ where: { refundStatus: 'PROCESSED', processedAt: range, transaction: { transactionType: { in: types } } }, _sum: { amount: true } }),
  ]);
  const gross = toDecimal(sales._sum.amount);
  const refunded = toDecimal(refunds._sum.amount);
  return { gross: money(gross), refunds: money(refunded), net: money(gross.minus(refunded)), count: sales._count };
}

export async function dashboardStats() {
  const now = new Date();
  const epoch = new Date(0);
  const [
    totalUsers, activeUsers, blockedUsers, totalSubscribers, activeSubscribers,
    matchesByStatus, totalMatches, publishedMatches, totalPredictions, publishedPredictions,
    successfulPurchases, txnByStatus, refundAgg, walletTopups,
    allTime, today, week, month, year, subscriptionRevenue, predictionRevenue,
  ] = await Promise.all([
    prisma.user.count({ where: { role: 'USER' } }),
    prisma.user.count({ where: { role: 'USER', accountStatus: 'ACTIVE' } }),
    prisma.user.count({ where: { role: 'USER', accountStatus: 'BLOCKED' } }),
    prisma.userSubscription.groupBy({ by: ['userId'] }).then((r) => r.length),
    prisma.userSubscription.groupBy({ by: ['userId'], where: { subscriptionStatus: 'ACTIVE', startDate: { lte: now }, endDate: { gt: now } } }).then((r) => r.length),
    prisma.match.groupBy({ by: ['status'], where: { archivedAt: null }, _count: true }),
    prisma.match.count({ where: { archivedAt: null } }),
    prisma.match.count({ where: { archivedAt: null, published: true } }),
    prisma.prediction.count(),
    prisma.prediction.count({ where: { publicationStatus: 'PUBLISHED' } }),
    prisma.purchase.count({ where: { purchaseStatus: 'ACTIVE' } }),
    prisma.transaction.groupBy({ by: ['paymentStatus'], _count: true }),
    prisma.refund.aggregate({ where: { refundStatus: 'PROCESSED' }, _sum: { amount: true }, _count: true }),
    prisma.transaction.aggregate({ where: { transactionType: 'WALLET_TOPUP', paymentStatus: { in: PAID } }, _sum: { amount: true } }),
    revenueBetween(epoch),
    revenueBetween(localStart('day')),
    revenueBetween(localStart('week')),
    revenueBetween(localStart('month')),
    revenueBetween(localStart('year')),
    revenueBetween(epoch, now, ['SUBSCRIPTION']),
    revenueBetween(epoch, now, ['PREDICTION']),
  ]);
  const byStatus = Object.fromEntries(matchesByStatus.map((r) => [r.status, r._count]));
  const txn = Object.fromEntries(txnByStatus.map((r) => [r.paymentStatus, r._count]));
  return {
    users: { total: totalUsers, active: activeUsers, blocked: blockedUsers },
    subscribers: { total: totalSubscribers, active: activeSubscribers },
    matches: {
      total: totalMatches, published: publishedMatches,
      upcoming: byStatus.UPCOMING || 0, live: byStatus.LIVE || 0, completed: byStatus.COMPLETED || 0,
      cancelled: byStatus.CANCELLED || 0, postponed: byStatus.POSTPONED || 0,
    },
    predictions: { total: totalPredictions, published: publishedPredictions },
    purchases: { successful: successfulPurchases },
    transactions: {
      total: Object.values(txn).reduce((a, b) => a + b, 0),
      successful: (txn.CAPTURED || 0) + (txn.PARTIALLY_REFUNDED || 0) + (txn.REFUNDED || 0),
      failed: txn.FAILED || 0,
      pending: txn.CREATED || 0,
      refunded: txn.REFUNDED || 0,
    },
    refunds: { count: refundAgg._count, amount: money(refundAgg._sum.amount ?? 0) },
    walletTopups: money(walletTopups._sum.amount ?? 0),
    revenue: { allTime, today, week, month, year, subscription: subscriptionRevenue, prediction: predictionRevenue },
  };
}

// ----------------------------------------------------------------------------- time series

const BUCKETS = {
  hour: { fmt: '%Y-%m-%d %H', stepMs: 3_600_000 },
  day: { fmt: '%Y-%m-%d', stepMs: 86_400_000 },
  month: { fmt: '%Y-%m' },
  year: { fmt: '%Y' },
};

function bucketKeys(unit, from, count) {
  const keys = [];
  const localFrom = new Date(from.getTime() + OFFSET * 60_000);
  for (let i = 0; i < count; i += 1) {
    const d = new Date(localFrom);
    if (unit === 'hour') d.setUTCHours(d.getUTCHours() + i);
    if (unit === 'day') d.setUTCDate(d.getUTCDate() + i);
    if (unit === 'month') d.setUTCMonth(d.getUTCMonth() + i);
    if (unit === 'year') d.setUTCFullYear(d.getUTCFullYear() + i);
    const iso = d.toISOString();
    keys.push(unit === 'hour' ? `${iso.slice(0, 10)} ${iso.slice(11, 13)}` : unit === 'day' ? iso.slice(0, 10) : unit === 'month' ? iso.slice(0, 7) : iso.slice(0, 4));
  }
  return keys;
}

async function grouped(unit, from, to) {
  const fmt = BUCKETS[unit].fmt;
  const sales = await prisma.$queryRaw(Prisma.sql`
    SELECT DATE_FORMAT(DATE_ADD(capturedAt, INTERVAL ${OFFSET} MINUTE), ${fmt}) AS bucket,
           transactionType AS type, SUM(amount) AS total, COUNT(*) AS cnt
    FROM transactions
    WHERE transactionType IN ('PREDICTION','SUBSCRIPTION')
      AND paymentStatus IN ('CAPTURED','REFUNDED','PARTIALLY_REFUNDED')
      AND capturedAt >= ${from} AND capturedAt < ${to}
    GROUP BY bucket, type`);
  const refunds = await prisma.$queryRaw(Prisma.sql`
    SELECT DATE_FORMAT(DATE_ADD(r.processedAt, INTERVAL ${OFFSET} MINUTE), ${fmt}) AS bucket, SUM(r.amount) AS total
    FROM refunds r JOIN transactions t ON t.id = r.transactionId
    WHERE r.refundStatus = 'PROCESSED' AND t.transactionType IN ('PREDICTION','SUBSCRIPTION')
      AND r.processedAt >= ${from} AND r.processedAt < ${to}
    GROUP BY bucket`);
  const failed = await prisma.$queryRaw(Prisma.sql`
    SELECT DATE_FORMAT(DATE_ADD(updatedAt, INTERVAL ${OFFSET} MINUTE), ${fmt}) AS bucket, COUNT(*) AS cnt
    FROM transactions WHERE paymentStatus = 'FAILED' AND updatedAt >= ${from} AND updatedAt < ${to}
    GROUP BY bucket`);
  const subs = await prisma.$queryRaw(Prisma.sql`
    SELECT DATE_FORMAT(DATE_ADD(createdAt, INTERVAL ${OFFSET} MINUTE), ${fmt}) AS bucket, COUNT(*) AS cnt
    FROM user_subscriptions WHERE createdAt >= ${from} AND createdAt < ${to}
    GROUP BY bucket`);
  return { sales, refunds, failed, subs };
}

/**
 * Revenue series.
 * range: today (hourly) | 7d | 30d | 90d (daily) | 12w (weekly) | 12m (monthly) | 5y (yearly)
 */
export async function revenueSeries(range = '30d') {
  const now = new Date();
  let unit;
  let count;
  let from;
  if (range === 'today') { unit = 'hour'; count = 24; from = localStart('day'); }
  else if (['7d', '30d', '90d'].includes(range)) { unit = 'day'; count = Number.parseInt(range, 10); from = new Date(localStart('day').getTime() - (count - 1) * 86_400_000); }
  else if (range === '12w') { unit = 'day'; count = 84; from = new Date(localStart('week').getTime() - 11 * 7 * 86_400_000); }
  else if (range === '12m') { unit = 'month'; count = 12; const s = localStart('month'); const d = new Date(s.getTime() + OFFSET * 60_000); d.setUTCMonth(d.getUTCMonth() - 11); from = new Date(d.getTime() - OFFSET * 60_000); }
  else { unit = 'year'; count = 5; const s = localStart('year'); const d = new Date(s.getTime() + OFFSET * 60_000); d.setUTCFullYear(d.getUTCFullYear() - 4); from = new Date(d.getTime() - OFFSET * 60_000); }

  const keys = bucketKeys(unit, from, count);
  const { sales, refunds, failed, subs } = await grouped(unit, from, now);
  const empty = () => Object.fromEntries(keys.map((k) => [k, toDecimal(0)]));
  const pred = empty();
  const sub = empty();
  const ref = empty();
  const fail = Object.fromEntries(keys.map((k) => [k, 0]));
  const newSubs = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of sales) if (r.bucket in pred) (r.type === 'PREDICTION' ? pred : sub)[r.bucket] = toDecimal(r.total);
  for (const r of refunds) if (r.bucket in ref) ref[r.bucket] = toDecimal(r.total);
  for (const r of failed) if (r.bucket in fail) fail[r.bucket] = Number(r.cnt);
  for (const r of subs) if (r.bucket in newSubs) newSubs[r.bucket] = Number(r.cnt);

  let labels = keys;
  let rows = keys.map((k) => ({ predictions: pred[k], subscriptions: sub[k], refunds: ref[k], failed: fail[k], newSubs: newSubs[k] }));
  if (range === '12w') {
    // fold 84 days into 12 Monday-based weeks
    labels = [];
    const folded = [];
    for (let w = 0; w < 12; w += 1) {
      const chunk = rows.slice(w * 7, w * 7 + 7);
      labels.push(`Wk of ${keys[w * 7]}`);
      folded.push(chunk.reduce((a, r) => ({
        predictions: a.predictions.plus(r.predictions), subscriptions: a.subscriptions.plus(r.subscriptions), refunds: a.refunds.plus(r.refunds), failed: a.failed + r.failed, newSubs: a.newSubs + r.newSubs,
      }), { predictions: toDecimal(0), subscriptions: toDecimal(0), refunds: toDecimal(0), failed: 0, newSubs: 0 }));
    }
    rows = folded;
  }
  return {
    range,
    unit: range === '12w' ? 'week' : unit,
    labels,
    predictions: rows.map((r) => money(r.predictions)),
    subscriptions: rows.map((r) => money(r.subscriptions)),
    gross: rows.map((r) => money(r.predictions.plus(r.subscriptions))),
    refunds: rows.map((r) => money(r.refunds)),
    net: rows.map((r) => money(r.predictions.plus(r.subscriptions).minus(r.refunds))),
    failedPayments: rows.map((r) => r.failed),
    newSubscriptions: rows.map((r) => r.newSubs),
  };
}

/** Running count of active subscribers at the end of each of the last 12 months. */
export async function subscriberGrowth() {
  const points = [];
  const startMonth = localStart('month');
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(startMonth.getTime() + OFFSET * 60_000);
    d.setUTCMonth(d.getUTCMonth() - i + 1);
    const end = new Date(Math.min(Date.now(), d.getTime() - OFFSET * 60_000));
    const active = await prisma.userSubscription.groupBy({
      by: ['userId'],
      where: { startDate: { lte: end }, endDate: { gt: end }, OR: [{ cancelledAt: null }, { cancelledAt: { gt: end } }] },
    });
    const label = new Date(d.getTime() - 86_400_000).toISOString().slice(0, 7);
    points.push({ label, active: active.length });
  }
  return points;
}

/**
 * Prediction accuracy: compares the LAST published snapshot taken before kick-off
 * with the verified result. Only real, verified results are counted.
 */
export async function predictionPerformance() {
  const matches = await prisma.match.findMany({
    where: { result: { verifiedAt: { not: null } }, prediction: { isNot: null } },
    include: { result: true, prediction: { include: { versions: { orderBy: { version: 'desc' } } } }, sport: true },
  });
  let evaluated = 0;
  let correct = 0;
  const bySport = {};
  for (const m of matches) {
    const snap = m.prediction.versions.find((v) => v.publishedAt <= m.startsAt);
    if (!snap) continue; // no prediction was published before the match started
    const actual = m.result.isDraw ? 'DRAW' : m.result.winningTeamId === m.teamAId ? 'TEAM_A' : m.result.winningTeamId === m.teamBId ? 'TEAM_B' : null;
    if (!actual) continue;
    const hit = snap.snapshot.predictedOutcome === actual;
    evaluated += 1;
    correct += hit ? 1 : 0;
    bySport[m.sport.name] = bySport[m.sport.name] || { evaluated: 0, correct: 0 };
    bySport[m.sport.name].evaluated += 1;
    bySport[m.sport.name].correct += hit ? 1 : 0;
  }
  return {
    evaluated,
    correct,
    accuracy: evaluated ? Number(((correct / evaluated) * 100).toFixed(1)) : null,
    bySport,
    note: 'Only matches with a verified result and a prediction published before kick-off are evaluated.',
  };
}

export async function salesBySport() {
  const rows = await prisma.$queryRaw`
    SELECT s.name AS sport, COUNT(t.id) AS cnt, COALESCE(SUM(t.amount),0) AS total
    FROM transactions t JOIN matches m ON m.id = t.matchId JOIN sports s ON s.id = m.sportId
    WHERE t.transactionType = 'PREDICTION' AND t.paymentStatus IN ('CAPTURED','REFUNDED','PARTIALLY_REFUNDED')
    GROUP BY s.name ORDER BY total DESC`;
  return rows.map((r) => ({ sport: r.sport, count: Number(r.cnt), total: money(r.total) }));
}
