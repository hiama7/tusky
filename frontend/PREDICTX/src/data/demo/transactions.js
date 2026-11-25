// SAMPLE DEMONSTRATION DATA — historical transactions for the admin view.
// New demo purchases made in the app are appended at runtime by services/purchases.js.
import { DEMO_USERS } from './users';
import { DEMO_MATCHES } from './matches';

const STATUSES = ['Success', 'Success', 'Success', 'Success', 'Pending', 'Failed', 'Refunded'];
const METHODS = ['UPI', 'Card', 'Net Banking', 'Wallet'];

export const DEMO_TRANSACTIONS = Array.from({ length: 30 }, (_, i) => {
  const u = DEMO_USERS[(i * 7) % DEMO_USERS.length];
  const isSub = i % 5 === 0;
  const m = DEMO_MATCHES[(i * 3) % DEMO_MATCHES.length];
  const d = new Date();
  d.setHours(d.getHours() - i * 9 - 1);
  return {
    id: `TXN${String(880100 + i * 37)}`,
    userId: u.id,
    customer: u.name,
    email: u.email,
    type: isSub ? 'subscription' : 'prediction',
    item: isSub ? 'Pro Monthly subscription' : `${m.teamA.name} vs ${m.teamB.name}`,
    matchId: isSub ? null : m.id,
    amount: isSub ? 599 : m.price,
    method: METHODS[i % METHODS.length],
    date: d.toISOString(),
    status: STATUSES[i % STATUSES.length],
    sample: true,
  };
});

/** Sample subscription records for the admin Subscriptions page. */
export const DEMO_SUBSCRIPTIONS = DEMO_USERS.filter((u) => u.subscription !== 'None').map((u, i) => {
  const start = new Date(u.registeredAt);
  const plan = ['weekly', 'monthly', 'yearly'][i % 3];
  const days = { weekly: 7, monthly: 30, yearly: 365 }[plan];
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  const status = u.subscription === 'Trial' ? 'Active' : u.subscription;
  return { id: `SUB${3000 + i}`, userId: u.id, customer: u.name, plan, start: start.toISOString(), end: end.toISOString(), status, amount: { weekly: 199, monthly: 599, yearly: 4999 }[plan] };
});
