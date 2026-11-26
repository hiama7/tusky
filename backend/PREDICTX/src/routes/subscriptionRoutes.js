// /api/subscriptions — plans (public), status/purchase/cancel (user).
import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/subscriptionController.js';
import { requireUser } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validationMiddleware.js';
import { paymentLimiter } from '../middleware/rateLimitMiddleware.js';
import { id } from '../validators/index.js';

const r = Router();
r.get('/plans', c.plans);
r.get('/me', requireUser, c.status);
r.post('/purchase', paymentLimiter, requireUser, validate({ body: z.object({ planId: id }) }), c.purchase);
r.post('/cancel', requireUser, c.cancel);

export default r;
