// /api/admin — every route requires an admin-scope token AND role = ADMIN in MySQL.
import { Router } from 'express';
import * as a from '../controllers/adminController.js';
import * as c from '../controllers/adminContentController.js';
import { requireAdmin } from '../middleware/adminMiddleware.js';
import { validate } from '../middleware/validationMiddleware.js';
import { imageUpload } from '../middleware/uploadMiddleware.js';
import * as v from '../validators/index.js';

const r = Router();
r.use(requireAdmin);
const list = validate({ query: v.adminList });
const byId = validate({ params: v.idParam });

// dashboard & analytics
r.get('/dashboard', a.dashboard);
r.get('/analytics/revenue', validate({ query: v.analyticsQuery }), a.revenue);
r.get('/analytics/overview', a.analyticsOverview);
r.get('/logs', a.adminLogs);
r.get('/system-health', a.health);
r.get('/model-report', a.modelReport);
r.get('/page-views', a.pageViews);

// users
r.get('/users', list, a.listUsers);
r.get('/users/:id', byId, a.userDetails);
r.patch('/users/:id/status', byId, validate({ body: v.userStatus }), a.setUserStatus);

// catalogue
r.get('/catalogue', c.listCatalogue);
r.post('/sports', imageUpload('image', 'sports'), validate({ body: v.sportBody }), c.createSport);
r.put('/sports/:id', byId, imageUpload('image', 'sports'), validate({ body: v.sportBody }), c.updateSport);
r.post('/teams', imageUpload('logo', 'teams'), validate({ body: v.teamBody }), c.createTeam);
r.put('/teams/:id', byId, imageUpload('logo', 'teams'), validate({ body: v.teamBody }), c.updateTeam);
r.delete('/teams/:id', byId, c.deleteTeam);
r.post('/tournaments', validate({ body: v.tournamentBody }), c.createTournament);
r.put('/tournaments/:id', byId, validate({ body: v.tournamentBody }), c.updateTournament);

// matches
r.get('/matches', list, c.listMatches);
r.post('/matches', imageUpload('image', 'matches'), validate({ body: v.matchBody }), c.createMatch);
r.put('/matches/:id', byId, imageUpload('image', 'matches'), validate({ body: v.matchBody }), c.updateMatch);
r.patch('/matches/:id', byId, validate({ body: v.matchPatch }), c.patchMatch);
r.delete('/matches/:id', byId, c.deleteMatch);
r.put('/matches/:id/result', byId, validate({ body: v.matchResult }), c.setResult);

// predictions
r.get('/predictions', list, c.listPredictions);
r.get('/predictions/:id', byId, c.predictionDetails);
r.post('/predictions', validate({ body: v.predictionBody }), c.createPrediction);
r.put('/predictions/:id', byId, validate({ body: v.predictionBody }), c.updatePrediction);
r.post('/predictions/:id/publish', byId, c.publishPrediction);
r.post('/predictions/:id/unpublish', byId, c.unpublishPrediction);
r.delete('/predictions/:id', byId, c.deletePrediction);

// news
r.get('/news', list, c.listNews);
r.post('/news', imageUpload('image', 'news'), validate({ body: v.newsBody }), c.createNews);
r.put('/news/:id', byId, imageUpload('image', 'news'), validate({ body: v.newsBody }), c.updateNews);
r.patch('/news/:id/status', byId, c.setNewsStatus);
r.delete('/news/:id', byId, c.deleteNews);

// payments, subscriptions, plans
r.get('/transactions', list, a.listTransactions);
r.post('/transactions/:id/refund', byId, validate({ body: v.refundBody }), a.refund);
r.get('/subscriptions', list, a.listSubscriptions);
r.get('/plans', a.listPlans);
r.post('/plans', validate({ body: v.planBody }), a.createPlan);
r.put('/plans/:id', byId, validate({ body: v.planBody }), a.updatePlan);

// external data integrations
r.get('/integrations', a.integrationStatus);
r.post('/integrations/news/import', a.importNews);
r.post('/integrations/ml/sync', validate({ body: v.mlSyncBody }), a.syncMl);

export default r;
