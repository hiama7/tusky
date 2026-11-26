// /api/news — published articles only.
import { Router } from 'express';
import * as c from '../controllers/newsController.js';
import { validate } from '../middleware/validationMiddleware.js';
import { newsQuery } from '../validators/index.js';

const r = Router();
r.get('/', validate({ query: newsQuery }), c.list);
r.get('/categories', c.categories);
r.get('/:idOrSlug', c.details);

export default r;
