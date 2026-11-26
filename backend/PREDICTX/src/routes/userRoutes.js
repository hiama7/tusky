// /api/users/me/* and /api/trial — everything is scoped to the logged-in user.
import { Router } from 'express';
import * as c from '../controllers/userController.js';
import { requireUser } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validationMiddleware.js';
import { favourites, trialActivate } from '../validators/index.js';

const r = Router();
r.use(requireUser);
r.get('/me/dashboard', c.dashboard);
r.get('/me/purchases', c.purchases);
r.get('/me/transactions', c.transactions);
r.get('/me/wallet', c.wallet);
r.get('/me/activity', c.activityTimeline);
r.put('/me/favourites', validate({ body: favourites }), c.setFavourites);
export default r;

export const trialRoutes = Router();
trialRoutes.use(requireUser);
trialRoutes.get('/status', c.trialStatus);
trialRoutes.post('/activate', validate({ body: trialActivate }), c.activateTrial);
