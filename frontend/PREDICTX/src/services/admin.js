// =========================================================
// admin.js — admin reads: users, transactions, subscriptions, revenue.
// Figures combine SAMPLE data (clearly flagged) with live DEMO purchases
// made in this browser, so admins can see their test purchases appear.
// Stage 2: /api/admin/users.php, /transactions.php, /subscriptions.php, /analytics.php
// =========================================================
import { simulate } from './api';
import { table, update } from './db';
import { read, write } from './storage';
import { ADMIN_SAMPLE_STATS, DAILY_REVENUE, HOURLY_TODAY } from '../data/demo/analytics';
import { planById } from '../data/demo/plans';

/** Sample users + accounts registered in this browser. */
export function getUsers() {
  return simulate(() => {
    const blocked = read('blockedUsers') || [];
    const txns = table('transactions');
    const subs = table('userSubs');
    const registered = table('accounts').map((a) => {
      const mine = txns.filter((t) => t.userId === a.id && t.status === 'Success' && t.type !== 'wallet');
      const sub = subs[a.id];
      return {
        id: a.id, name: a.name, email: a.email, phone: a.phone, registeredAt: a.registeredAt,
        subscription: sub ? sub.status : 'None',
        purchases: mine.filter((t) => t.type === 'prediction').length,
        spent: mine.reduce((s, t) => s + t.amount, 0),
        status: 'Active',
        registeredHere: true,
      };
    });
    return [...registered, ...table('sampleUsers')].map((u) => ({ ...u, status: blocked.includes(u.id) ? 'Blocked' : u.status }));
  }, 300);
}

export function setUserBlocked(userId, blocked) {
  return simulate(() => {
    const list = new Set(read('blockedUsers') || []);
    if (blocked) list.add(userId);
    else list.delete(userId);
    write('blockedUsers', [...list]);
    // sample rows store their own status, so keep them in sync
    update('sampleUsers', (rows) => rows.map((u) => (u.id === userId ? { ...u, status: blocked ? 'Blocked' : 'Active' } : u)));
  }, 200);
}

export const getTransactions = () => simulate(() => [...table('transactions')].sort((a, b) => new Date(b.date) - new Date(a.date)), 300);

export function getSubscriptions() {
  return simulate(() => {
    const accounts = table('accounts');
    const live = Object.entries(table('userSubs')).map(([userId, s]) => ({
      id: `SUB-${userId}`, userId, customer: accounts.find((a) => a.id === userId)?.name || userId,
      plan: s.planId, start: s.start, end: s.end, amount: planById(s.planId)?.price || 0,
      status: s.status === 'Active' && new Date(s.end) < new Date() ? 'Expired' : s.status, demo: true,
    }));
    return [...live, ...table('subscriptions')];
  }, 300);
}

/** Revenue from purchases made in this browser during the demo. */
export function demoRevenueSync() {
  const today = new Date().toISOString().slice(0, 10);
  const live = table('transactions').filter((t) => t.demo && t.status === 'Success' && t.type !== 'wallet');
  return {
    total: live.reduce((s, t) => s + t.amount, 0),
    today: live.filter((t) => t.date.slice(0, 10) === today).reduce((s, t) => s + t.amount, 0),
    count: live.length,
  };
}

export function getAdminStats() {
  return simulate(() => {
    const demo = demoRevenueSync();
    return {
      ...ADMIN_SAMPLE_STATS,
      totalRevenue: ADMIN_SAMPLE_STATS.totalRevenue + demo.total,
      todayRevenue: ADMIN_SAMPLE_STATS.todayRevenue + demo.today,
      liveMatches: table('matches').length,
      livePredictions: table('predictions').filter((p) => p.status === 'published').length,
      demo,
    };
  }, 350);
}

/**
 * Revenue series for charts. range: 'today' | '7d' | '30d' | '90d'
 * Returns labels + prediction/subscription arrays; today's live demo revenue is added to the last point.
 */
export function getRevenueSeries(range = '30d') {
  return simulate(() => {
    const demo = demoRevenueSync();
    if (range === 'today') {
      // live demo purchases made today are added to the current hour
      const hour = new Date().getHours();
      const rows = HOURLY_TODAY.map((h, i) => {
        const subscriptions = Math.round(h.total * 0.4);
        const predictions = h.total - subscriptions + (i === hour ? demo.today : 0);
        return { ...h, predictions, subscriptions, total: predictions + subscriptions };
      });
      return { labels: rows.map((h) => h.hour), total: rows.map((h) => h.total), predictions: rows.map((h) => h.predictions), subscriptions: rows.map((h) => h.subscriptions), demoToday: demo.today };
    }
    const days = { '7d': 7, '30d': 30, '90d': 90 }[range] || 30;
    const slice = DAILY_REVENUE.slice(-days).map((d) => ({ ...d }));
    slice[slice.length - 1].total += demo.today;
    slice[slice.length - 1].predictions += demo.today;
    const fmt = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    return {
      labels: slice.map((d) => fmt(d.date)),
      total: slice.map((d) => d.total),
      predictions: slice.map((d) => d.predictions),
      subscriptions: slice.map((d) => d.subscriptions),
      newSubs: slice.map((d) => d.newSubs),
      demoToday: demo.today,
    };
  }, 300);
}

/** Weekly (last 12 weeks), monthly (last 12 months) and yearly aggregates. */
export function getRevenueAggregates() {
  return simulate(() => {
    const weeks = [];
    for (let i = 0; i < 12; i++) {
      const chunk = DAILY_REVENUE.slice(-(i + 1) * 7, DAILY_REVENUE.length - i * 7 || undefined);
      weeks.unshift({ label: `W-${i}`, total: chunk.reduce((s, d) => s + d.total, 0) });
    }
    weeks[weeks.length - 1].label = 'This wk';
    const months = {};
    DAILY_REVENUE.forEach((d) => {
      const key = d.date.slice(0, 7);
      months[key] = (months[key] || 0) + d.total;
    });
    const monthList = Object.entries(months).slice(-12).map(([k, v]) => ({ label: new Date(`${k}-01`).toLocaleDateString('en-IN', { month: 'short' }), total: v }));
    const thisYear = new Date().getFullYear();
    const yearly = [
      { label: String(thisYear - 3), total: 410000 },
      { label: String(thisYear - 2), total: 780000 },
      { label: String(thisYear - 1), total: 1320000 },
      { label: String(thisYear), total: DAILY_REVENUE.reduce((s, d) => s + d.total, 0) },
    ];
    let cum = 1100;
    const subGrowth = monthList.map((m, i) => ({ label: m.label, total: (cum += 40 + i * 9) }));
    return { weeks, months: monthList, yearly, subGrowth };
  }, 300);
}
