// =========================================================
// db.js — demo "tables" kept in localStorage, seeded from src/data/demo.
// Mirrors the MySQL tables planned for Stage 2:
//   users, matches, predictions, news, purchases, transactions,
//   subscriptions, trials, wallets, notifications, activity
// =========================================================
import { collection, write } from './storage';
import { DEMO_MATCHES } from '../data/demo/matches';
import { DEMO_PREDICTIONS } from '../data/demo/predictions';
import { DEMO_NEWS } from '../data/demo/news';
import { DEMO_USERS, DEMO_ACCOUNT } from '../data/demo/users';
import { DEMO_TRANSACTIONS, DEMO_SUBSCRIPTIONS } from '../data/demo/transactions';
import { demoHash } from './hash';

const SEEDS = {
  matches: () => DEMO_MATCHES,
  predictions: () => DEMO_PREDICTIONS,
  news: () => DEMO_NEWS,
  // registered accounts that can log in (the built-in demo user + anyone who registers)
  accounts: () => [{ ...stripPassword(DEMO_ACCOUNT), passwordHash: demoHash(DEMO_ACCOUNT.password) }],
  // sample people shown in the admin Users table
  sampleUsers: () => DEMO_USERS,
  transactions: () => DEMO_TRANSACTIONS,
  subscriptions: () => DEMO_SUBSCRIPTIONS,
  purchases: () => ({}), // { [userId]: { [matchId]: purchase } }
  trials: () => ({}), // { [userId]: { status, matchId, activatedAt } }
  wallets: () => ({}), // { [userId]: balance }
  userSubs: () => ({}), // { [userId]: { planId, start, end, status } }
  notifications: () => ({}), // { [userId]: [...] }
  activity: () => ({}), // { [userId]: [...] }
};

function stripPassword({ password, ...rest }) { // eslint-disable-line no-unused-vars
  return rest;
}

/** Returns a table's current rows (seeding on first use). */
export const table = (name) => collection(name, SEEDS[name]);

/** Replaces a table's contents. */
export const save = (name, value) => write(name, value);

/** Convenience: mutate a table with a function and save it. */
export function update(name, fn) {
  const next = fn(structuredClone(table(name)));
  save(name, next);
  return next;
}
