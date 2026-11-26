// /api/sports, /api/tournaments, /api/matches — public catalogue (optional login).
import { Router } from 'express';
import * as c from '../controllers/matchController.js';
import * as p from '../controllers/predictionController.js';
import { optionalUser } from '../middleware/authMiddleware.js';
import { validate } from '../middleware/validationMiddleware.js';
import { idParam, matchQuery } from '../validators/index.js';

export const sportRoutes = Router();
sportRoutes.get('/', c.listSports);
sportRoutes.get('/:slug', c.sportDetails);

export const tournamentRoutes = Router();
tournamentRoutes.get('/', c.listTournaments);

const r = Router();
r.get('/', optionalUser, validate({ query: matchQuery }), c.listMatches);
r.get('/results', c.matchResults);
r.get('/:id', optionalUser, validate({ params: idParam }), c.matchDetails);
r.get('/:id/standings', validate({ params: idParam }), c.matchStandings);
r.get('/:id/prediction', optionalUser, validate({ params: idParam }), p.getPrediction);

export default r;
