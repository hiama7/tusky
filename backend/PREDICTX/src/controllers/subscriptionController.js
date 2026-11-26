// Subscription plans (public), status/history/cancel (user), purchase → payment order.
import * as subs from '../services/subscriptionService.js';
import * as payments from '../services/paymentService.js';
import { ok } from '../utils/apiResponse.js';

export async function plans(_req, res) {
  ok(res, { plans: await subs.listPlans() });
}

export async function status(req, res) {
  ok(res, await subs.userSubscriptionStatus(req.user.id));
}

export async function purchase(req, res) {
  ok(res, { order: await payments.createOrder(req.user, { type: 'SUBSCRIPTION', planId: req.valid.body.planId }) }, 'Payment order created', 201);
}

export async function cancel(req, res) {
  ok(res, await subs.cancel(req.user), 'Subscription cancelled');
}
