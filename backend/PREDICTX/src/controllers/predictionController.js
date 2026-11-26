// Prediction endpoints for users. Locked content is filtered on the SERVER:
// without an entitlement only { locked, price, available } is returned.
import { prisma } from '../config/database.js';
import { ok, paginate } from '../utils/apiResponse.js';
import { accessMap, predictionForViewer } from '../services/predictionService.js';
import * as payments from '../services/paymentService.js';
import * as S from '../services/serializers.js';

/** GET /api/matches/:id/prediction (also /api/predictions/:matchId) */
export async function getPrediction(req, res) {
  const id = req.valid.params.id;
  const result = await predictionForViewer(id, req.user?.id);
  ok(res, result, result.locked ? 'Prediction is locked' : 'Prediction unlocked');
}

/**
 * GET /api/predictions — published predictions with lock state.
 * A compact preview (winner + probability) is included ONLY for unlocked rows.
 */
export async function listPredictions(req, res) {
  const { skip, take, meta } = paginate(req.query, { defaultLimit: 50 });
  const where = { publicationStatus: 'PUBLISHED', match: { published: true, archivedAt: null } };
  const [rows, total] = await Promise.all([
    prisma.prediction.findMany({ where, include: { match: { include: S.MATCH_INCLUDE } }, orderBy: { match: { startsAt: 'asc' } }, skip, take }),
    prisma.prediction.count({ where }),
  ]);
  const access = await accessMap(req.user?.id, rows.map((r) => r.match));
  const items = rows.map((p) => {
    const reason = access.get(p.matchId);
    const full = reason ? S.prediction(p) : null;
    return {
      matchId: p.matchId,
      match: S.match(p.match, reason),
      unlocked: Boolean(reason),
      unlockReason: reason,
      preview: full && { probA: full.probA, probB: full.probB, probDraw: full.probDraw, predictedOutcome: full.predictedOutcome, confidence: full.confidence },
    };
  });
  ok(res, { items, pagination: meta(total) });
}

/** POST /api/predictions/:id/purchase — starts a Razorpay order for that match. */
export async function purchase(req, res) {
  const order = await payments.createOrder(req.user, { type: 'PREDICTION', matchId: req.valid.params.id });
  ok(res, { order }, 'Payment order created', 201);
}
