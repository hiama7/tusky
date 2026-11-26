// Maps database rows to the JSON shapes the React app consumes.
// Keeping this in one place guarantees protected fields (password hashes, locked
// prediction content) are never serialized by accident.
import { money } from '../utils/money.js';

export const MATCH_INCLUDE = {
  sport: { select: { id: true, slug: true, name: true, color: true, outcomeFormat: true } },
  tournament: { select: { id: true, name: true, season: true } },
  teamA: { select: { id: true, name: true, shortName: true, color: true, logo: true, country: true } },
  teamB: { select: { id: true, name: true, shortName: true, color: true, logo: true, country: true } },
  prediction: { select: { id: true, publicationStatus: true } },
  result: true,
};

const team = (t) => t && { id: t.id, name: t.name, short: t.shortName, color: t.color || '#386BFF', logo: t.logo, country: t.country };

export function user(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.fullName,
    email: u.email,
    phone: u.phone,
    role: u.role,
    status: u.accountStatus === 'ACTIVE' ? 'Active' : 'Blocked',
    emailVerified: Boolean(u.emailVerifiedAt),
    registeredAt: u.createdAt,
    favourites: u.favouriteSports ? u.favouriteSports.map((f) => f.sport?.slug).filter(Boolean) : undefined,
  };
}

export function sport(s, extra = {}) {
  return {
    id: s.slug,
    dbId: s.id,
    name: s.name,
    description: s.description,
    image: s.image,
    color: s.color,
    outcomeFormat: s.outcomeFormat,
    status: s.status,
    ...extra,
  };
}

export function match(m, access = undefined) {
  return {
    id: m.id,
    sport: m.sport?.slug,
    sportId: m.sportId,
    sportName: m.sport?.name,
    sportColor: m.sport?.color || '#386BFF',
    outcomeFormat: m.sport?.outcomeFormat,
    tournament: m.tournament?.name,
    tournamentId: m.tournamentId,
    season: m.tournament?.season || null,
    teamA: team(m.teamA),
    teamB: team(m.teamB),
    venue: m.venue,
    conditions: m.conditions,
    image: m.image,
    date: m.startsAt,
    price: money(m.predictionPrice),
    status: m.status,
    published: m.published,
    featured: m.featured,
    archived: Boolean(m.archivedAt),
    isDemo: m.isDemo,
    hasPrediction: m.prediction?.publicationStatus === 'PUBLISHED',
    result: m.result
      ? { winningTeamId: m.result.winningTeamId, isDraw: m.result.isDraw, score: m.result.scoreSummary, description: m.result.resultDescription, completedAt: m.result.matchCompletedAt }
      : null,
    ...(access !== undefined ? { unlocked: Boolean(access), unlockReason: access } : {}),
  };
}

const CONF = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' };
const num = (v) => (v === null || v === undefined ? null : Number(v));

/** FULL prediction — only call after the server has confirmed an entitlement (or for admins). */
export function prediction(p) {
  const ta = p.teamAnalysis || {};
  const rf = p.recentForm || {};
  return {
    id: p.id,
    matchId: p.matchId,
    outcomeFormat: p.outcomeFormat,
    probA: num(p.teamAProbability),
    probB: num(p.teamBProbability),
    probDraw: num(p.drawProbability),
    predictedOutcome: p.predictedOutcome,
    confidence: CONF[p.confidenceLevel],
    confidenceLevel: p.confidenceLevel,
    summary: p.summary,
    teamA: { form: rf.teamA || [], strengths: ta.teamA?.strengths || [], weaknesses: ta.teamA?.weaknesses || [] },
    teamB: { form: rf.teamB || [], strengths: ta.teamB?.strengths || [], weaknesses: ta.teamB?.weaknesses || [] },
    players: p.playerAnalysis || [],
    h2h: { played: 0, aWins: 0, bWins: 0, draws: 0, ...(p.headToHead || {}) },
    insights: p.keyFactors || [],
    pitch: p.pitchAnalysis,
    weather: p.weatherAnalysis,
    source: p.source,
    modelVersion: p.modelVersion,
    status: p.publicationStatus,
    version: p.version,
    publishedAt: p.publishedAt,
    updatedAt: p.updatedAt,
    isDemo: p.isDemo,
  };
}

/** LOCKED preview — contains no probabilities, outcome, confidence or analysis. */
export function lockedPrediction(m, { available }) {
  return {
    locked: true,
    matchId: m.id,
    price: money(m.predictionPrice),
    available, // a published prediction exists and can be bought
  };
}

export function news(n, { full = false } = {}) {
  return {
    id: n.id,
    slug: n.slug,
    title: n.title,
    excerpt: n.description,
    ...(full ? { body: n.content } : {}),
    image: n.image,
    category: n.category,
    author: n.author?.fullName || 'TUSKY Desk',
    date: n.publishedAt || n.createdAt,
    publishedAt: n.publishedAt,
    status: n.publicationStatus,
    scheduled: n.publicationStatus === 'PUBLISHED' && n.publishedAt && new Date(n.publishedAt) > new Date(),
    featured: n.featured,
    trending: n.trending,
    views: n.views,
    source: n.source,
    sourceUrl: /^https?:\/\//i.test(n.externalUrl || '') ? n.externalUrl : null,
    isDemo: n.isDemo,
  };
}

export function plan(p) {
  return {
    id: p.id,
    code: p.code,
    name: p.planName,
    description: p.description,
    price: money(p.price),
    days: p.durationDays,
    period: p.durationDays <= 7 ? 'week' : p.durationDays <= 31 ? 'month' : p.durationDays >= 360 ? 'year' : `${p.durationDays} days`,
    features: p.features || [],
    allSports: p.allSports,
    sports: p.sports ? p.sports.map((s) => s.sport?.slug).filter(Boolean) : [],
    popular: p.popular,
    status: p.status,
  };
}

export function subscription(s) {
  const expired = s.subscriptionStatus === 'ACTIVE' && new Date(s.endDate) <= new Date();
  return {
    id: s.id,
    planId: s.planId,
    plan: s.plan ? plan(s.plan) : undefined,
    start: s.startDate,
    end: s.endDate,
    status: expired ? 'Expired' : { ACTIVE: 'Active', EXPIRED: 'Expired', CANCELLED: 'Cancelled' }[s.subscriptionStatus],
    upcoming: s.subscriptionStatus === 'ACTIVE' && new Date(s.startDate) > new Date(),
    cancelledAt: s.cancelledAt,
    createdAt: s.createdAt,
  };
}

const TXN_STATUS = { CREATED: 'Pending', CAPTURED: 'Success', FAILED: 'Failed', REFUNDED: 'Refunded', PARTIALLY_REFUNDED: 'Partially refunded' };
const TXN_TYPE = { PREDICTION: 'prediction', SUBSCRIPTION: 'subscription', WALLET_TOPUP: 'wallet' };
const METHOD = { upi: 'UPI', card: 'Card', netbanking: 'Net Banking', wallet: 'Wallet (app)', emi: 'EMI', WALLET: 'TUSKY Wallet' };

export function transaction(t) {
  let item = 'Payment';
  if (t.transactionType === 'WALLET_TOPUP') item = 'Wallet top-up';
  else if (t.transactionType === 'SUBSCRIPTION') item = `${t.plan?.planName || 'Plan'} subscription`;
  else if (t.match) item = `${t.match.teamA?.name} vs ${t.match.teamB?.name}`;
  return {
    id: t.transactionReference,
    dbId: t.id,
    userId: t.userId,
    customer: t.user?.fullName,
    email: t.user?.email,
    type: TXN_TYPE[t.transactionType],
    item,
    matchId: t.matchId,
    planId: t.planId,
    amount: money(t.amount),
    refundedAmount: money(t.refundedAmount),
    currency: t.currency,
    method: METHOD[t.paymentMethod] || t.paymentMethod || '—',
    status: TXN_STATUS[t.paymentStatus],
    rawStatus: t.paymentStatus,
    gatewayOrderId: t.gatewayOrderId,
    gatewayPaymentId: t.gatewayPaymentId,
    isDuplicate: t.isDuplicate,
    failureReason: t.failureReason,
    date: t.capturedAt || t.createdAt,
    createdAt: t.createdAt,
  };
}

export function notification(n) {
  return { id: n.id, title: n.title, body: n.message, type: n.notificationType.toLowerCase(), read: n.isRead, date: n.createdAt };
}
