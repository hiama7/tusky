// Payment, purchase, wallet, subscription and refund tests.
// Only the Razorpay HTTP calls are replaced (an in-memory fake gateway below);
// checkout and webhook signatures are verified with real HMACs.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { api, auth, checkoutSignature, loginAs, makeMatch, makeSport, makeUser, prisma, uniq, webhookSignature } from './helpers.js';

const fake = vi.hoisted(() => ({ orders: new Map(), payments: new Map(), refunds: [] }));

vi.mock('../src/services/paymentGateway.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    isConfigured: () => true,
    createOrder: async ({ amountPaise, receipt }) => {
      const order = { id: `order_${crypto.randomBytes(6).toString('hex')}`, amount: amountPaise, currency: 'INR', receipt };
      fake.orders.set(order.id, order);
      return order;
    },
    fetchPayment: async (id) => {
      const p = fake.payments.get(id);
      if (!p) throw new Error('payment not found');
      return p;
    },
    capturePayment: async (id) => {
      const p = fake.payments.get(id);
      p.status = 'captured';
      return p;
    },
    refundPayment: async (paymentId, amount) => {
      const r = { id: `rfnd_${crypto.randomBytes(6).toString('hex')}`, payment_id: paymentId, amount, status: 'processed' };
      fake.refunds.push(r);
      return r;
    },
  };
});

/** Simulates the customer paying an order on Razorpay; returns checkout callback fields. */
function payOrder(order, { amount = order.amountPaise, status = 'captured', method = 'upi' } = {}) {
  const id = `pay_${crypto.randomBytes(6).toString('hex')}`;
  fake.payments.set(id, { id, order_id: order.orderId, amount, currency: 'INR', status, method });
  return { razorpay_order_id: order.orderId, razorpay_payment_id: id, razorpay_signature: checkoutSignature(order.orderId, id) };
}

async function buyer() {
  const u = await makeUser();
  const { token } = await loginAs(u);
  return { u, token };
}

beforeEach(() => fake.payments.clear());

describe('individual prediction purchase', () => {
  it('charges the database price, ignoring any price sent by the client', async () => {
    const m = await makeMatch({ price: '39.00' });
    const { token } = await buyer();
    const res = await api().post('/api/payments/orders').set(auth(token)).send({ type: 'PREDICTION', matchId: m.id, amount: 1, price: 1 });
    expect(res.status).toBe(201);
    expect(res.body.data.order.amount).toBe(39);
    expect(res.body.data.order.amountPaise).toBe(3900);
    expect(res.body.data.order.keyId).toBe('rzp_test_unit_tests');
    expect(JSON.stringify(res.body)).not.toMatch(/unit_test_key_secret/);
  });

  it('a forged signature unlocks nothing', async () => {
    const m = await makeMatch();
    const { token } = await buyer();
    const { order } = (await api().post('/api/payments/orders').set(auth(token)).send({ type: 'PREDICTION', matchId: m.id })).body.data;
    const cb = payOrder(order);
    const res = await api().post('/api/payments/verify').set(auth(token)).send({ ...cb, razorpay_signature: 'a'.repeat(64) });
    expect(res.status).toBe(400);
    expect((await api().get(`/api/matches/${m.id}/prediction`).set(auth(token))).body.data.locked).toBe(true);
  });

  it('a paid-but-underpaid or unpaid payment unlocks nothing', async () => {
    const m = await makeMatch({ price: '49.00' });
    const { token } = await buyer();
    const { order } = (await api().post('/api/payments/orders').set(auth(token)).send({ type: 'PREDICTION', matchId: m.id })).body.data;
    const under = await api().post('/api/payments/verify').set(auth(token)).send(payOrder(order, { amount: 100 }));
    expect(under.status).toBe(400);
    const failed = await api().post('/api/payments/verify').set(auth(token)).send(payOrder(order, { status: 'failed' }));
    expect(failed.status).toBe(402);
    expect((await api().get(`/api/matches/${m.id}/prediction`).set(auth(token))).body.data.locked).toBe(true);
  });

  it('verified payment unlocks only that match; repeating verification is idempotent', async () => {
    const [m1, m2] = [await makeMatch(), await makeMatch()];
    const { u, token } = await buyer();
    const { order } = (await api().post('/api/payments/orders').set(auth(token)).send({ type: 'PREDICTION', matchId: m1.id })).body.data;
    const cb = payOrder(order);
    const ok1 = await api().post('/api/payments/verify').set(auth(token)).send(cb);
    expect(ok1.status).toBe(200);
    expect(ok1.body.data.transaction.status).toBe('Success');

    const p1 = await api().get(`/api/matches/${m1.id}/prediction`).set(auth(token));
    expect(p1.body.data).toMatchObject({ locked: false, unlockReason: 'purchase' });
    expect((await api().get(`/api/matches/${m2.id}/prediction`).set(auth(token))).body.data.locked).toBe(true);

    const again = await api().post('/api/payments/verify').set(auth(token)).send(cb);
    expect(again.status).toBe(200);
    expect(again.body.data.alreadyProcessed).toBe(true);
    expect(await prisma.purchase.count({ where: { userId: u.id } })).toBe(1);
    expect(await prisma.transaction.count({ where: { userId: u.id, paymentStatus: 'CAPTURED' } })).toBe(1);

    // already owned → can't start another order
    expect((await api().post('/api/payments/orders').set(auth(token)).send({ type: 'PREDICTION', matchId: m1.id })).status).toBe(409);
  });

  it("a user cannot verify, or see, someone else's order", async () => {
    const m = await makeMatch();
    const a = await buyer();
    const b = await buyer();
    const { order } = (await api().post('/api/payments/orders').set(auth(a.token)).send({ type: 'PREDICTION', matchId: m.id })).body.data;
    const res = await api().post('/api/payments/verify').set(auth(b.token)).send(payOrder(order));
    expect(res.status).toBe(404);
    const txns = await api().get('/api/users/me/transactions').set(auth(b.token));
    expect(txns.body.data.items).toHaveLength(0);
  });

  it('cannot buy unpublished predictions or completed matches', async () => {
    const { token } = await buyer();
    const draft = await makeMatch({ predictionStatus: 'DRAFT' });
    expect((await api().post('/api/payments/orders').set(auth(token)).send({ type: 'PREDICTION', matchId: draft.id })).status).toBe(400);
    const done = await makeMatch({ status: 'COMPLETED' });
    expect((await api().post('/api/payments/orders').set(auth(token)).send({ type: 'PREDICTION', matchId: done.id })).status).toBe(400);
  });
});

describe('webhooks', () => {
  const send = (body, sig, eventId) =>
    api().post('/api/payments/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', sig).set('x-razorpay-event-id', eventId).send(body);

  it('rejects an invalid signature', async () => {
    const raw = JSON.stringify({ event: 'payment.captured', payload: {} });
    expect((await send(raw, 'deadbeef', uniq('evt'))).status).toBe(400);
  });

  it('fulfils a captured payment exactly once, even when delivered repeatedly', async () => {
    const m = await makeMatch();
    const { u, token } = await buyer();
    const { order } = (await api().post('/api/payments/orders').set(auth(token)).send({ type: 'PREDICTION', matchId: m.id })).body.data;
    const payment = { id: `pay_${uniq()}`, order_id: order.orderId, amount: order.amountPaise, currency: 'INR', status: 'captured', method: 'card' };
    const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: payment } } });
    const eventId = uniq('evt');
    const first = await send(raw, webhookSignature(raw), eventId);
    expect(first.status).toBe(200);
    const dup = await send(raw, webhookSignature(raw), eventId);
    expect(dup.body.data.duplicate).toBe(true);
    // a different event id for the same payment (order.paid) is also harmless
    const raw2 = JSON.stringify({ event: 'order.paid', payload: { payment: { entity: payment } } });
    expect((await send(raw2, webhookSignature(raw2), uniq('evt'))).status).toBe(200);

    expect(await prisma.purchase.count({ where: { userId: u.id, matchId: m.id } })).toBe(1);
    expect((await api().get(`/api/matches/${m.id}/prediction`).set(auth(token))).body.data.locked).toBe(false);
    // the browser callback arriving later is idempotent too
    fake.payments.set(payment.id, payment);
    const late = await api().post('/api/payments/verify').set(auth(token)).send({ razorpay_order_id: order.orderId, razorpay_payment_id: payment.id, razorpay_signature: checkoutSignature(order.orderId, payment.id) });
    expect(late.body.data.alreadyProcessed).toBe(true);
  });

  it('marks failed payments as failed', async () => {
    const m = await makeMatch();
    const { token } = await buyer();
    const { order } = (await api().post('/api/payments/orders').set(auth(token)).send({ type: 'PREDICTION', matchId: m.id })).body.data;
    const raw = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_f', order_id: order.orderId, error_description: 'Card declined' } } } });
    await send(raw, webhookSignature(raw), uniq('evt'));
    const t = await prisma.transaction.findUnique({ where: { gatewayOrderId: order.orderId } });
    expect(t.paymentStatus).toBe('FAILED');
  });
});

describe('wallet', () => {
  it('tops up through a verified payment and pays for a prediction', async () => {
    const m = await makeMatch({ price: '49.00' });
    const { token } = await buyer();
    expect((await api().post('/api/payments/orders').set(auth(token)).send({ type: 'WALLET_TOPUP', amount: 5 })).status).toBe(422);
    const { order } = (await api().post('/api/payments/orders').set(auth(token)).send({ type: 'WALLET_TOPUP', amount: 100 })).body.data;
    expect((await api().post('/api/payments/verify').set(auth(token)).send(payOrder(order))).status).toBe(200);
    expect((await api().get('/api/users/me/wallet').set(auth(token))).body.data.balance).toBe(100);

    const paid = await api().post('/api/payments/wallet').set(auth(token)).send({ type: 'PREDICTION', matchId: m.id });
    expect(paid.status).toBe(200);
    expect((await api().get('/api/users/me/wallet').set(auth(token))).body.data.balance).toBe(51);
    expect((await api().get(`/api/matches/${m.id}/prediction`).set(auth(token))).body.data.locked).toBe(false);
  });

  it('refuses when the balance is too low, and concurrent wallet buys cannot double-spend', async () => {
    const { u, token } = await buyer();
    const m = await makeMatch({ price: '49.00' });
    expect((await api().post('/api/payments/wallet').set(auth(token)).send({ type: 'PREDICTION', matchId: m.id })).status).toBe(402);
    await prisma.walletEntry.create({ data: { userId: u.id, entryType: 'ADJUSTMENT', amount: '60.00', note: 'test credit' } });
    const [x, y] = [await makeMatch({ price: '49.00' }), await makeMatch({ price: '49.00' })];
    const results = await Promise.all([x, y].map((mm) => api().post('/api/payments/wallet').set(auth(token)).send({ type: 'PREDICTION', matchId: mm.id })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 402]);
    const bal = (await api().get('/api/users/me/wallet').set(auth(token))).body.data.balance;
    expect(bal).toBe(11);
  });
});

describe('subscriptions', () => {
  it('grants access only to the sports a plan covers, and renewals stack', async () => {
    const covered = await makeSport();
    const other = await makeSport();
    const plan = await prisma.subscriptionPlan.create({ data: { code: uniq('plan').toLowerCase(), planName: 'Covered Only', price: '199.00', durationDays: 7, features: [], allSports: false, sports: { create: [{ sportId: covered.id }] } } });
    const mc = await makeMatch({ sport: covered });
    const mo = await makeMatch({ sport: other });
    const { u, token } = await buyer();

    const { order } = (await api().post('/api/subscriptions/purchase').set(auth(token)).send({ planId: plan.id })).body.data;
    expect(order.amount).toBe(199);
    expect((await api().post('/api/payments/verify').set(auth(token)).send(payOrder(order))).status).toBe(200);

    expect((await api().get(`/api/matches/${mc.id}/prediction`).set(auth(token))).body.data.unlockReason).toBe('subscription');
    expect((await api().get(`/api/matches/${mo.id}/prediction`).set(auth(token))).body.data.locked).toBe(true);
    expect((await api().post('/api/payments/orders').set(auth(token)).send({ type: 'PREDICTION', matchId: mc.id })).status).toBe(409);

    const { order: o2 } = (await api().post('/api/subscriptions/purchase').set(auth(token)).send({ planId: plan.id })).body.data;
    await api().post('/api/payments/verify').set(auth(token)).send(payOrder(o2));
    const status = (await api().get('/api/subscriptions/me').set(auth(token))).body.data;
    expect(status.current.plan.name).toBe('Covered Only');
    expect(status.queued).toHaveLength(1);

    expect((await api().post('/api/subscriptions/cancel').set(auth(token))).status).toBe(200);
    expect((await api().get(`/api/matches/${mc.id}/prediction`).set(auth(token))).body.data.locked).toBe(true);
    expect(await prisma.userSubscription.count({ where: { userId: u.id, subscriptionStatus: 'CANCELLED' } })).toBe(2);
  });
});

describe('refunds and revenue', () => {
  it('a full refund revokes access and is subtracted from net revenue', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const { token: adminToken } = await loginAs(admin, 'admin');
    const before = (await api().get('/api/admin/dashboard').set(auth(adminToken))).body.data.stats.revenue.allTime;

    const m = await makeMatch({ price: '59.00' });
    const { token } = await buyer();
    const { order } = (await api().post('/api/payments/orders').set(auth(token)).send({ type: 'PREDICTION', matchId: m.id })).body.data;
    await api().post('/api/payments/verify').set(auth(token)).send(payOrder(order));
    const txn = await prisma.transaction.findUnique({ where: { gatewayOrderId: order.orderId } });

    const mid = (await api().get('/api/admin/dashboard').set(auth(adminToken))).body.data.stats.revenue.allTime;
    expect(mid.gross - before.gross).toBe(59);
    expect(mid.net - before.net).toBe(59);

    // a user cannot refund themselves
    expect((await api().post(`/api/admin/transactions/${txn.id}/refund`).set(auth(token)).send({ reason: 'please' })).status).toBe(401);
    const tooMuch = await api().post(`/api/admin/transactions/${txn.id}/refund`).set(auth(adminToken)).send({ amount: 100, reason: 'too much' });
    expect(tooMuch.status).toBe(422);
    const r = await api().post(`/api/admin/transactions/${txn.id}/refund`).set(auth(adminToken)).send({ reason: 'Customer request' });
    expect(r.status).toBe(200);
    expect((await api().get(`/api/matches/${m.id}/prediction`).set(auth(token))).body.data.locked).toBe(true);

    const after = (await api().get('/api/admin/dashboard').set(auth(adminToken))).body.data.stats.revenue.allTime;
    expect(after.gross - before.gross).toBe(59); // the sale still happened…
    expect(after.refunds - before.refunds).toBe(59); // …and was refunded
    expect(after.net).toBe(before.net); // net is unchanged
    expect(await prisma.adminLog.count({ where: { action: 'REFUND_ISSUED', entityId: String(txn.id) } })).toBe(1);
  });
});
