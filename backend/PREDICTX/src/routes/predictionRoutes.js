// /api/predictions — lists with lock state, gated detail, purchase.
import { Router } from 'express';
import * as c from '../controllers/predictionController.js';
import { optionalUser, requireUser } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validationMiddleware.js';
import { paymentLimiter } from '../middleware/rateLimitMiddleware.js';
import { idParam } from '../validators/index.js';

const r = Router();
r.get('/', optionalUser, c.listPredictions);
// :id is the MATCH id — every match has at most one prediction.
r.get('/:id', optionalUser, validate({ params: idParam }), c.getPrediction);
r.post('/:id/purchase', paymentLimiter, requireUser, validate({ params: idParam }), c.purchase);

export default r;
