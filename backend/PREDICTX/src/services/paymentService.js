// =============================================================================
// Payments: orders, verification, webhooks, wallet payments, refunds.
//
// Security model
//  * Prices always come from MySQL (match.predictionPrice / plan.price). The only
//    client-chosen amount is a wallet top-up, validated to a fixed range.
//  * Content unlocks only inside fulfil(), which runs after BOTH a valid Razorpay
//    signature AND a server-side fetch of the payment from Razorpay confirming
//    status, order id, amount and currency — or after a verified webhook.
//  * fulfil() locks the transaction row (SELECT … FOR UPDATE) and is idempotent:
//    the checkout callback and the webhook can both arrive, in any order, any
//    number of times, and the entitlement is created exactly once.
// =============================================================================
import { prisma } from '../config/database.js';
import { ApiError } from '../utils/apiResponse.js';
import { transactionReference } from '../utils/generateToken.js';
import { logger } from '../utils/logger.js';
import { money, toDecimal, toPaise } from '../utils/money.js';
import * as gateway from './paymentGateway.js';
import { activity, notify } from './notificationService.js';
import { accessFor, activeSubscriptions } from './predictionService.js';
import * as S from './serializers.js';

export const WALLET_TOPUP_MIN = 10;
export const WALLET_TOPUP_MAX = 10000;
const SELLABLE_MATCH_STATUSES = ['UPCOMING', 'LIVE', 'POSTPONED'];

// ----------------------------------------------------------------------------- item resolution

/** Validates what is being bought and returns { amount, matchId, planId, label }. */
async function resolveItem(user, { type, matchId, planId, amount }, db = prisma) {
  if (type === 'PREDICTION') {
    const match = await db.match.findFirst({
      where: { id: matchId, published: true, archivedAt: null },
      include: { prediction: true, teamA: true, teamB: true },
    });
    if (!match) throw ApiError.notFound('Match not found');
    if (match.prediction?.publicationStatus !== 'PUBLISHED') throw ApiError.badRequest('This match has no published prediction to buy yet.');
    if (!SELLABLE_MATCH_STATUSES.includes(match.status)) throw ApiError.badRequest('Predictions for this match are no longer on sale.');
    const reason = await accessFor(user.id, match, db);
    if (reason === 'subscription') throw ApiError.conflict('This prediction is already included in your subscription.');
    if (reason) throw ApiError.conflict('You already have access to this prediction.');
    return { amount: match.predictionPrice, matchId: match.id, label: `${match.teamA.name} vs ${match.teamB.name}`, match };
  }
  if (type === 'SUBSCRIPTION') {
    const plan = await db.subscriptionPlan.findFirst({ where: { id: planId, status: 'ACTIVE' } });
    if (!plan) throw ApiError.notFound('Subscription plan not found');
    return { amount: plan.price, planId: plan.id, label: `${plan.planName} subscription`, plan };
  }
  if (type === 'WALLET_TOPUP') {
    const value = toDecimal(amount);
    if (!value.isInteger() || value.lt(WALLET_TOPUP_MIN) || value.gt(WALLET_TOPUP_MAX)) {
      throw ApiError.validation([{ field: 'amount', message: `Top-up must be a whole amount between ₹${WALLET_TOPUP_MIN} and ₹${WALLET_TOPUP_MAX}` }]);
    }
    return { amount: value, label: 'Wallet top-up' };
  }
  throw ApiError.badRequest('Unknown payment type');
}

// ----------------------------------------------------------------------------- create order

export async function createOrder(user, input) {
  if (!gateway.isConfigured()) throw ApiError.unavailable('Online payments are not configured on this server (missing Razorpay keys).');
  const item = await resolveItem(user, input);

  const txn = await prisma.transaction.create({
    data: {
      transactionReference: transactionReference(),
      userId: user.id,
      transactionType: input.type,
      amount: item.amount,
      matchId: item.matchId ?? null,
      planId: item.planId ?? null,
    },
  });

  let order;
  try {
    order = await gateway.createOrder({
      amountPaise: toPaise(item.amount),
      receipt: txn.transactionReference,
      notes: { transaction_id: String(txn.id), user_id: String(user.id), type: input.type },
    });
  } catch (err) {
    await prisma.transaction.update({ where: { id: txn.id }, data: { paymentStatus: 'FAILED', failureReason: 'Could not create payment order' } });
    logger.error({ err: err?.error || err }, 'Razorpay order creation failed');
    throw ApiError.unavailable('Could not start the payment. Please try again.');
  }
  await prisma.transaction.update({ where: { id: txn.id }, data: { gatewayOrderId: order.id } });

  return {
    transactionId: txn.id,
    reference: txn.transactionReference,
    orderId: order.id,
    amount: money(item.amount),
    amountPaise: order.amount,
    currency: order.currency,
    keyId: gateway.publicKeyId(),
    description: item.label,
    prefill: { name: user.fullName, email: user.email, contact: user.phone || '' },
  };
}

// ----------------------------------------------------------------------------- fulfilment (idempotent)

/**
 * Marks the transaction captured and grants the entitlement — exactly once.
 * `payment` = { id, method } as confirmed by Razorpay (or { method: 'WALLET' }).
 */
async function fulfil(transactionId, payment, db) {
  await db.$queryRaw`SELECT id FROM transactions WHERE id = ${transactionId} FOR UPDATE`;
  const txn = await db.transaction.findUnique({ where: { id: transactionId }, include: { match: { include: { teamA: true, teamB: true, prediction: true } }, plan: true } });
  if (['CAPTURED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(txn.paymentStatus)) {
    return { txn, alreadyProcessed: true };
  }

  const now = new Date();
  let updated = await db.transaction.update({
    where: { id: txn.id },
    data: { paymentStatus: 'CAPTURED', gatewayPaymentId: payment.id ?? null, paymentMethod: payment.method ?? null, capturedAt: now, failureReason: null },
  });

  if (txn.transactionType === 'PREDICTION') {
    const label = `${txn.match.teamA.name} vs ${txn.match.teamB.name}`;
    const existing = await db.purchase.findUnique({ where: { userId_matchId: { userId: txn.userId, matchId: txn.matchId } } });
    if (existing?.purchaseStatus === 'ACTIVE') {
      // Paid twice for the same match (e.g. two tabs). Keep the money visible for a refund; don't double-grant.
      updated = await db.transaction.update({ where: { id: txn.id }, data: { isDuplicate: true } });
      await notify(txn.userId, { title: 'Duplicate payment received', message: `You already owned ${label}. This extra payment will be refunded by our team.`, type: 'WARNING' }, db);
    } else if (existing) {
      await db.purchase.update({ where: { id: existing.id }, data: { purchaseStatus: 'ACTIVE', revokedAt: null, transactionId: txn.id, amount: txn.amount, purchasedAt: now, predictionId: txn.match.prediction?.id ?? null } });
    } else {
      await db.purchase.create({ data: { userId: txn.userId, matchId: txn.matchId, predictionId: txn.match.prediction?.id ?? null, transactionId: txn.id, amount: txn.amount } });
    }
    if (!existing || existing.purchaseStatus !== 'ACTIVE') {
      await notify(txn.userId, { title: 'Prediction unlocked', message: `${label} is now available in My Purchases.`, type: 'SUCCESS' }, db);
      await activity(txn.userId, 'purchase', `Unlocked ${label} (₹${money(txn.amount)})`, db);
    }
  } else if (txn.transactionType === 'SUBSCRIPTION') {
    // Renewals stack: a new period starts when the latest active one ends.
    const latest = await db.userSubscription.findFirst({
      where: { userId: txn.userId, subscriptionStatus: 'ACTIVE', endDate: { gt: now } },
      orderBy: { endDate: 'desc' },
    });
    const start = latest ? latest.endDate : now;
    const end = new Date(start.getTime() + txn.plan.durationDays * 86_400_000);
    await db.userSubscription.create({ data: { userId: txn.userId, planId: txn.planId, transactionId: txn.id, startDate: start, endDate: end } });
    await notify(txn.userId, { title: `${txn.plan.planName} activated`, message: latest ? `Your plan was extended until ${end.toDateString()}.` : `Enjoy your plan until ${end.toDateString()}.`, type: 'SUCCESS' }, db);
    await activity(txn.userId, 'subscription', `${latest ? 'Renewed' : 'Subscribed to'} ${txn.plan.planName} (₹${money(txn.amount)})`, db);
  } else if (txn.transactionType === 'WALLET_TOPUP') {
    await db.walletEntry.create({ data: { userId: txn.userId, entryType: 'TOPUP', amount: txn.amount, transactionId: txn.id, note: 'Wallet top-up' } });
    await notify(txn.userId, { title: 'Wallet topped up', message: `₹${money(txn.amount)} was added to your wallet.`, type: 'SUCCESS' }, db);
    await activity(txn.userId, 'wallet', `Added ₹${money(txn.amount)} to wallet`, db);
  }
  return { txn: updated, alreadyProcessed: false };
}

async function markFailed(transactionId, reason) {
  await prisma.transaction.updateMany({
    where: { id: transactionId, paymentStatus: 'CREATED' },
    data: { paymentStatus: 'FAILED', failureReason: String(reason || 'Payment failed').slice(0, 255) },
  });
}

/** Confirms with Razorpay that the payment really is paid, for this order and amount. */
async function confirmWithGateway(txn, paymentId) {
  let payment = await gateway.fetchPayment(paymentId);
  const expectedPaise = toPaise(txn.amount);
  if (payment.order_id !== txn.gatewayOrderId) throw ApiError.badRequest('Payment does not belong to this order.');
  if (Number(payment.amount) !== expectedPaise || payment.currency !== txn.currency) {
    throw ApiError.badRequest('Payment amount does not match the order.');
  }
  if (payment.status === 'authorized') payment = await gateway.capturePayment(paymentId, expectedPaise);
  if (payment.status === 'failed') {
    await markFailed(txn.id, payment.error_description);
    throw new ApiError(402, payment.error_description || 'The payment failed. No money was taken.');
  }
  if (payment.status !== 'captured') throw new ApiError(402, `Payment is not complete yet (status: ${payment.status}).`);
  return payment;
}

/** Called by the React app after Razorpay Checkout returns. Never trusted on its own. */
export async function verifyPayment(user, { orderId, paymentId, signature }) {
  const txn = await prisma.transaction.findUnique({ where: { gatewayOrderId: orderId } });
  if (!txn || txn.userId !== user.id) throw ApiError.notFound('Order not found');
  if (!gateway.verifyCheckoutSignature({ orderId, paymentId, signature })) {
    throw ApiError.badRequest('Payment signature verification failed.');
  }
  if (txn.gatewayPaymentId && txn.gatewayPaymentId !== paymentId) throw ApiError.conflict('This order was already paid with a different payment.');

  const payment = await confirmWithGateway(txn, paymentId);
  const { txn: done, alreadyProcessed } = await prisma.$transaction((db) => fulfil(txn.id, { id: payment.id, method: payment.method }, db));
  return { ...(await describeResult(done)), alreadyProcessed };
}

/** Records a checkout the user closed or that the gateway declined. */
export async function reportFailure(user, { orderId, reason }) {
  const txn = await prisma.transaction.findUnique({ where: { gatewayOrderId: orderId } });
  if (!txn || txn.userId !== user.id) throw ApiError.notFound('Order not found');
  await markFailed(txn.id, reason || 'Payment cancelled by user');
  return { status: 'Failed' };
}

async function describeResult(txn) {
  const full = await prisma.transaction.findUnique({ where: { id: txn.id }, include: { match: { include: { teamA: true, teamB: true } }, plan: true, user: true } });
  return { transaction: S.transaction(full), matchId: full.matchId, planId: full.planId, duplicate: full.isDuplicate };
}

// ----------------------------------------------------------------------------- webhook

/**
 * Razorpay webhook. Signature is checked against the RAW body. Events are recorded
 * in payment_events so retries/duplicates are acknowledged without re-processing.
 */
export async function handleWebhook(rawBody, signature, eventIdHeader) {
  if (!gateway.verifyWebhookSignature(rawBody, signature)) throw ApiError.badRequest('Invalid webhook signature');
  const event = JSON.parse(rawBody.toString('utf8'));
  const eventId = eventIdHeader || `${event.event}:${event.payload?.payment?.entity?.id || event.payload?.refund?.entity?.id || event.created_at}`;

  if (await prisma.paymentEvent.findUnique({ where: { eventId } })) return { duplicate: true };

  const payment = event.payload?.payment?.entity;
  switch (event.event) {
    case 'payment.captured':
    case 'order.paid': {
      const txn = payment && (await prisma.transaction.findUnique({ where: { gatewayOrderId: payment.order_id } }));
      if (txn && Number(payment.amount) === toPaise(txn.amount) && payment.status === 'captured') {
        await prisma.$transaction((db) => fulfil(txn.id, { id: payment.id, method: payment.method }, db));
      } else if (txn) {
        logger.warn({ eventId, orderId: payment?.order_id }, 'Webhook payment did not match transaction');
      }
      break;
    }
    case 'payment.failed': {
      const txn = payment && (await prisma.transaction.findUnique({ where: { gatewayOrderId: payment.order_id } }));
      if (txn) await markFailed(txn.id, payment.error_description);
      break;
    }
    case 'refund.processed':
    case 'refund.failed': {
      const refund = event.payload?.refund?.entity;
      if (refund?.id) {
        await prisma.refund.updateMany({
          where: { gatewayRefundId: refund.id },
          data: { refundStatus: event.event === 'refund.processed' ? 'PROCESSED' : 'FAILED', processedAt: new Date() },
        });
      }
      break;
    }
    default:
      break; // acknowledged but not used
  }

  try {
    await prisma.paymentEvent.create({ data: { eventId, eventType: event.event, payload: event } });
  } catch (err) {
    if (err.code !== 'P2002') throw err; // a concurrent delivery already recorded it
  }
  return { processed: true, event: event.event };
}

// ----------------------------------------------------------------------------- wallet

export async function walletBalance(userId, db = prisma) {
  const agg = await db.walletEntry.aggregate({ where: { userId }, _sum: { amount: true } });
  return toDecimal(agg._sum.amount ?? 0);
}

/** Pays for a prediction or plan from the wallet in one locked DB transaction. */
export async function payWithWallet(user, input) {
  try {
    const done = await prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
      const item = await resolveItem(user, input, db);
      const balance = await walletBalance(user.id, db);
      if (balance.lt(item.amount)) {
        throw new ApiError(402, `Insufficient wallet balance (₹${money(balance)}). Top up your wallet or choose another payment method.`);
      }
      const txn = await db.transaction.create({
        data: {
          transactionReference: transactionReference(),
          userId: user.id,
          transactionType: input.type,
          amount: item.amount,
          matchId: item.matchId ?? null,
          planId: item.planId ?? null,
        },
      });
      await db.walletEntry.create({ data: { userId: user.id, entryType: 'PURCHASE', amount: toDecimal(item.amount).neg(), transactionId: txn.id, note: item.label } });
      const { txn: captured } = await fulfil(txn.id, { method: 'WALLET' }, db);
      return captured;
    });
    return describeResult(done);
  } catch (err) {
    if (err.code === 'P2002') throw ApiError.conflict('You already have access to this prediction.');
    throw err;
  }
}

export async function walletOverview(userId) {
  const [balance, entries] = await Promise.all([
    walletBalance(userId),
    prisma.walletEntry.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);
  const sum = (type) => entries.filter((e) => e.entryType === type).reduce((s, e) => s.plus(e.amount), toDecimal(0));
  return {
    balance: money(balance),
    totalAdded: money(sum('TOPUP')),
    totalSpent: money(sum('PURCHASE').abs()),
    entries: entries.map((e) => ({ id: e.id, type: e.entryType, amount: money(e.amount), note: e.note, date: e.createdAt })),
  };
}

// ----------------------------------------------------------------------------- refunds (admin)

/**
 * Refunds (all or part of) a captured transaction. Gateway payments are refunded
 * through Razorpay; wallet payments are credited back to the wallet.
 * A full refund revokes the entitlement that the payment granted.
 */
export async function refundTransaction(adminId, transactionId, { amount, reason }) {
  // Phase 1 — under row locks: validate against FRESH state and reserve the amount, so two
  // concurrent refunds can never exceed what was paid and the wallet cannot go negative.
  const reserved = await prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT id FROM transactions WHERE id = ${transactionId} FOR UPDATE`;
    const txn = await db.transaction.findUnique({ where: { id: transactionId } });
    if (!txn) throw ApiError.notFound('Transaction not found');
    if (!['CAPTURED', 'PARTIALLY_REFUNDED'].includes(txn.paymentStatus)) throw ApiError.badRequest('Only successful payments can be refunded.');
    const remaining = toDecimal(txn.amount).minus(txn.refundedAmount);
    const value = amount === undefined || amount === null ? remaining : toDecimal(amount);
    if (value.lte(0) || value.gt(remaining)) throw ApiError.validation([{ field: 'amount', message: `Refund must be between ₹0.01 and ₹${money(remaining)}` }]);
    const isWalletPayment = txn.paymentMethod === 'WALLET';
    if (!isWalletPayment && !txn.gatewayPaymentId) throw ApiError.badRequest('This payment has no gateway payment id to refund.');

    if (txn.transactionType === 'WALLET_TOPUP') {
      await db.$queryRaw`SELECT id FROM users WHERE id = ${txn.userId} FOR UPDATE`;
      const balance = await walletBalance(txn.userId, db);
      if (balance.lt(value)) throw ApiError.conflict(`The user has already spent this credit (wallet balance ₹${money(balance)}).`);
      await db.walletEntry.create({ data: { userId: txn.userId, entryType: 'ADJUSTMENT', amount: value.neg(), transactionId: txn.id, note: `Top-up refunded ${txn.transactionReference}` } });
    }

    const refunded = toDecimal(txn.refundedAmount).plus(value);
    const full = refunded.gte(txn.amount);
    const refund = await db.refund.create({
      data: {
        transactionId: txn.id,
        amount: value,
        reason,
        createdById: adminId,
        refundStatus: isWalletPayment ? 'PROCESSED' : 'PENDING',
        processedAt: isWalletPayment ? new Date() : null,
      },
    });
    await db.transaction.update({ where: { id: txn.id }, data: { refundedAmount: refunded, paymentStatus: full ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
    if (isWalletPayment) {
      await db.walletEntry.create({ data: { userId: txn.userId, entryType: 'REFUND', amount: value, transactionId: txn.id, note: `Refund ${txn.transactionReference}` } });
      await applyRefundEffects(db, txn, full, value, true);
    }
    return { txn, value, full, isWalletPayment, refundId: refund.id, prevStatus: txn.paymentStatus, prevRefunded: txn.refundedAmount };
  });

  const { txn, value, full, isWalletPayment, refundId } = reserved;
  if (isWalletPayment) return { refunded: money(value), status: full ? 'Refunded' : 'Partially refunded' };

  // Phase 2 — call the gateway; undo the reservation only if it clearly refused the refund.
  let gatewayRefund;
  try {
    gatewayRefund = await gateway.refundPayment(txn.gatewayPaymentId, toPaise(value), { transaction: txn.transactionReference, reason: reason || '', refund_id: String(refundId) });
  } catch (err) {
    // Only a 4xx answer proves no money moved. After a timeout or server error the refund
    // may have gone through, so the amount stays reserved and cannot be sent a second time.
    if (!(err?.statusCode >= 400 && err.statusCode < 500)) {
      logger.error({ err: err?.error || err, refundId }, 'Razorpay refund unconfirmed; amount left reserved');
      throw ApiError.unavailable(`Razorpay did not confirm the refund, so it is held as pending (refund #${refundId}). Check the Razorpay dashboard before doing anything else.`);
    }
    await prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM transactions WHERE id = ${txn.id} FOR UPDATE`;
      const cur = await db.transaction.findUnique({ where: { id: txn.id } });
      const back = toDecimal(cur.refundedAmount).minus(value);
      await db.transaction.update({ where: { id: txn.id }, data: { refundedAmount: back, paymentStatus: back.gt(0) ? 'PARTIALLY_REFUNDED' : 'CAPTURED' } });
      await db.refund.update({ where: { id: refundId }, data: { refundStatus: 'FAILED' } });
      if (txn.transactionType === 'WALLET_TOPUP') {
        await db.walletEntry.create({ data: { userId: txn.userId, entryType: 'ADJUSTMENT', amount: value, transactionId: txn.id, note: `Top-up refund reversed ${txn.transactionReference}` } });
      }
    });
    logger.error({ err: err?.error || err, refundId }, 'Razorpay refund failed; reservation released');
    throw ApiError.badRequest('Razorpay rejected the refund. Nothing was changed.');
  }

  // Phase 3 — record the gateway result and revoke the entitlement.
  const processed = gatewayRefund?.status === 'processed';
  await prisma.$transaction(async (db) => {
    await db.refund.update({ where: { id: refundId }, data: { gatewayRefundId: gatewayRefund?.id ?? null, refundStatus: processed ? 'PROCESSED' : 'PENDING', processedAt: processed ? new Date() : null } });
    await applyRefundEffects(db, txn, full, value, false);
  });
  return { refunded: money(value), status: full ? 'Refunded' : 'Partially refunded' };
}

async function applyRefundEffects(db, txn, full, value, toWallet) {
  if (full && !txn.isDuplicate) {
    if (txn.transactionType === 'PREDICTION') {
      await db.purchase.updateMany({ where: { transactionId: txn.id }, data: { purchaseStatus: 'REVOKED', revokedAt: new Date() } });
    } else if (txn.transactionType === 'SUBSCRIPTION') {
      await db.userSubscription.updateMany({ where: { transactionId: txn.id }, data: { subscriptionStatus: 'CANCELLED', cancelledAt: new Date() } });
    }
  }
  await notify(txn.userId, { title: 'Refund issued', message: `₹${money(value)} for ${txn.transactionReference} has been refunded${toWallet ? ' to your wallet' : ''}.`, type: 'INFO' }, db);
}

export { activeSubscriptions };
