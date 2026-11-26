// Payment endpoints: create order, verify checkout, webhook, wallet pay, failure report.
import * as payments from '../services/paymentService.js';
import { ApiError, ok } from '../utils/apiResponse.js';

export async function createOrder(req, res) {
  ok(res, { order: await payments.createOrder(req.user, req.valid.body) }, 'Payment order created', 201);
}

export async function verify(req, res) {
  const b = req.valid.body;
  const result = await payments.verifyPayment(req.user, { orderId: b.razorpay_order_id, paymentId: b.razorpay_payment_id, signature: b.razorpay_signature });
  ok(res, result, result.duplicate ? 'Payment received — you already owned this item, so it will be refunded.' : 'Payment verified');
}

export async function failure(req, res) {
  ok(res, await payments.reportFailure(req.user, req.valid.body), 'Payment marked as failed');
}

export async function walletPay(req, res) {
  ok(res, await payments.payWithWallet(req.user, req.valid.body), 'Paid from wallet');
}

/** Raw-body webhook (mounted before express.json). */
export async function webhook(req, res) {
  if (!Buffer.isBuffer(req.body)) throw ApiError.badRequest('Expected raw body');
  const result = await payments.handleWebhook(req.body, req.get('x-razorpay-signature'), req.get('x-razorpay-event-id'));
  ok(res, result, result.duplicate ? 'Event already processed' : 'Event processed');
}
