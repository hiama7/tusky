// /api/payments — Razorpay orders, verification, wallet payments.
// The webhook is mounted separately in app.js because it needs the RAW body.
import { Router } from 'express';
import * as c from '../controllers/paymentController.js';
import { requireUser } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validationMiddleware.js';
import { paymentLimiter } from '../middleware/rateLimitMiddleware.js';
import { createOrder, paymentFailure, verifyPayment, walletPay } from '../validators/index.js';

const r = Router();
r.use(paymentLimiter, requireUser);
r.post('/orders', validate({ body: createOrder }), c.createOrder);
r.post('/verify', validate({ body: verifyPayment }), c.verify);
r.post('/failure', validate({ body: paymentFailure }), c.failure);
r.post('/wallet', validate({ body: walletPay }), c.walletPay);

export default r;
