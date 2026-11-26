// Thin wrapper around the Razorpay API + signature helpers.
// Everything that talks to Razorpay goes through here, so it is the single
// place automated tests replace (vi.mock) — the verification logic itself is real.
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { getRazorpay } from '../config/razorpay.js';
import { ApiError } from '../utils/apiResponse.js';

function client() {
  const rzp = getRazorpay();
  if (!rzp) throw ApiError.unavailable('Online payments are not configured on this server (missing Razorpay keys).');
  return rzp;
}

export const isConfigured = () => env.razorpayEnabled;
export const publicKeyId = () => env.RAZORPAY_KEY_ID;

export function createOrder({ amountPaise, receipt, notes }) {
  return client().orders.create({ amount: amountPaise, currency: 'INR', receipt, notes });
}

export const fetchPayment = (paymentId) => client().payments.fetch(paymentId);
export const capturePayment = (paymentId, amountPaise) => client().payments.capture(paymentId, amountPaise, 'INR');
export const refundPayment = (paymentId, amountPaise, notes) => client().payments.refund(paymentId, { amount: amountPaise, notes });

/** Constant-time comparison of two hex HMACs. */
function safeEqualHex(expected, received) {
  if (typeof received !== 'string' || !/^[a-f0-9]+$/i.test(received)) return false;
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(received, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Checkout signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  if (!env.RAZORPAY_KEY_SECRET) return false;
  const expected = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
}

/** Webhook signature: HMAC_SHA256(raw request body, webhook_secret). */
export function verifyWebhookSignature(rawBody, signature) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}
