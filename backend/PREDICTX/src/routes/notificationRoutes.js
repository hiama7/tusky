// /api/notifications — the logged-in user's notifications only.
import { Router } from 'express';
import * as c from '../controllers/notificationController.js';
import { requireUser } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validationMiddleware.js';
import { idParam } from '../validators/index.js';

const r = Router();
r.use(requireUser);
r.get('/', c.list);
r.post('/read-all', c.markAllRead);
r.post('/:id/read', validate({ params: idParam }), c.markRead);

export default r;
