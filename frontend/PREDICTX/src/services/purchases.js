// =========================================================
// purchases.js — per-match unlocks, demo payments, wallet, subscriptions.
//
// RULE: each match has an independent purchase record keyed by
// purchases[userId][matchId]. Buying one match never unlocks another.
// (An active subscription is a separate, explicit "unlock all" flag.)
//
// Stage 2 endpoints:
//   POST /api/payments/create-order.php → real gateway (Razorpay/Stripe…)
//   POST /api/payments/verify.php       → server records purchase
//   GET  /api/purchases.php   GET/POST /api/wallet.php   POST /api/subscriptions.php
// =========================================================
import { simulate, DemoError } from './api';
import { table, update } from './db';
import { uid } from './storage';
import { planById } from '../data/demo/plans';
import { addNotification, logActivity } from './notifications';
import { getTrialSync } from './trial';

/* ---------- Subscription ---------- */
export function getSubscriptionSync(userId) {
  const sub = table('userSubs')[userId];
  if (!sub) return null;
  const expired = new Date(sub.end).getTime() < Date.now();
  return { ...sub, status: sub.status === 'Active' && expired ? 'Expired' : sub.status };
}
export const getSubscription = (userId) => simulate(() => getSubscriptionSync(userId), 80);

/* ---------- Unlock check (single source of truth) ---------- */
export function unlockReason(userId, matchId) {
  if (!userId) return null;
  if (table('purchases')[userId]?.[matchId]) return 'purchase';
  const trial = getTrialSync(userId);
  if (trial.status === 'used' && trial.matchId === matchId) return 'trial';
  if (getSubscriptionSync(userId)?.status === 'Active') return 'subscription';
  return null;
}
export const isUnlocked = (userId, matchId) => unlockReason(userId, matchId) !== null;

/* ---------- Purchases ---------- */
export function getPurchases(userId) {
  return simulate(() => {
    const mine = table('purchases')[userId] || {};
    const matches = table('matches');
    const trial = getTrialSync(userId);
    const list = Object.values(mine).map((p) => ({ ...p, match: matches.find((m) => m.id === p.matchId) }));
    if (trial.status === 'used' && !mine[trial.matchId]) {
      list.push({ matchId: trial.matchId, amount: 0, method: 'Free Trial', date: trial.activatedAt, txnId: 'TRIAL', match: matches.find((m) => m.id === trial.matchId) });
    }
    return list.filter((p) => p.match).sort((a, b) => new Date(b.date) - new Date(a.date));
  }, 150);
}

function recordTransaction(user, { type, item, matchId = null, amount, method }) {
  const txn = {
    id: `TXN${uid()}`.slice(0, 14),
    userId: user.id,
    customer: user.name,
    email: user.email,
    type,
    item,
    matchId,
    amount,
    method,
    date: new Date().toISOString(),
    status: 'Success',
    demo: true,
  };
  update('transactions', (rows) => [txn, ...rows]);
  return txn;
}

/**
 * DEMO payment: always succeeds after a short delay (unless wallet balance is low).
 * No money moves and no card data is collected.
 */
export function purchaseMatch(user, match, method) {
  return simulate(() => {
    if (table('purchases')[user.id]?.[match.id]) throw new DemoError('You already unlocked this prediction.');
    if (method === 'Wallet') debitWallet(user.id, match.price);
    const txn = recordTransaction(user, { type: 'prediction', item: `${match.teamA.name} vs ${match.teamB.name}`, matchId: match.id, amount: match.price, method });
    update('purchases', (all) => {
      all[user.id] = { ...(all[user.id] || {}), [match.id]: { matchId: match.id, amount: match.price, method, date: txn.date, txnId: txn.id } };
      return all;
    });
    addNotification(user.id, { title: 'Prediction unlocked', body: `${match.teamA.name} vs ${match.teamB.name} is now available in My Purchases.`, type: 'success' });
    logActivity(user.id, `Unlocked ${match.teamA.name} vs ${match.teamB.name} (₹${match.price}, ${method})`, 'purchase');
    return txn;
  }, 1400);
}

/* ---------- Wallet ---------- */
export const getWalletSync = (userId) => table('wallets')[userId] ?? 0;
export const getWallet = (userId) => simulate(() => getWalletSync(userId), 80);

function debitWallet(userId, amount) {
  const bal = getWalletSync(userId);
  if (bal < amount) throw new DemoError(`Insufficient demo wallet balance (₹${bal}). Top up your wallet first.`);
  update('wallets', (w) => ({ ...w, [userId]: bal - amount }));
}

export function topUpWallet(user, amount, method = 'UPI') {
  return simulate(() => {
    const value = Number(amount);
    if (!(value >= 10 && value <= 10000)) throw new DemoError('Enter an amount between ₹10 and ₹10,000.');
    update('wallets', (w) => ({ ...w, [user.id]: (w[user.id] ?? 0) + value }));
    recordTransaction(user, { type: 'wallet', item: 'Wallet top-up', amount: value, method });
    addNotification(user.id, { title: 'Wallet topped up', body: `₹${value} demo credit added to your wallet.`, type: 'success' });
    logActivity(user.id, `Added ₹${value} to wallet`, 'wallet');
    return getWalletSync(user.id);
  }, 900);
}

export function getUserTransactions(userId) {
  return simulate(() => table('transactions').filter((t) => t.userId === userId), 150);
}

/* ---------- Subscriptions ---------- */
export function subscribe(user, planId, method) {
  return simulate(() => {
    const plan = planById(planId);
    if (!plan) throw new DemoError('Unknown plan.');
    if (getSubscriptionSync(user.id)?.status === 'Active') throw new DemoError('You already have an active subscription.');
    if (method === 'Wallet') debitWallet(user.id, plan.price);
    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + plan.days);
    const sub = { planId, start: start.toISOString(), end: end.toISOString(), status: 'Active' };
    update('userSubs', (s) => ({ ...s, [user.id]: sub }));
    recordTransaction(user, { type: 'subscription', item: `${plan.name} subscription`, amount: plan.price, method });
    addNotification(user.id, { title: `${plan.name} activated`, body: 'All predictions are unlocked while your plan is active.', type: 'success' });
    logActivity(user.id, `Subscribed to ${plan.name} (₹${plan.price})`, 'subscription');
    return sub;
  }, 1400);
}

export function cancelSubscription(user) {
  return simulate(() => {
    update('userSubs', (s) => ({ ...s, [user.id]: { ...s[user.id], status: 'Cancelled', cancelledAt: new Date().toISOString() } }));
    logActivity(user.id, 'Cancelled subscription', 'subscription');
    addNotification(user.id, { title: 'Subscription cancelled', body: 'Individual purchases and your trial unlock remain available.', type: 'warning' });
  }, 600);
}
