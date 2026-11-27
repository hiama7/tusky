// Admin API calls. All use the separate admin session (scope 'admin').
import { del, get, patch, post, put, request, toFormData } from './api';

const A = { scope: 'admin' };

// dashboard & analytics
export const getDashboard = () => get('/admin/dashboard', A);
export const getRevenueSeries = (range) => get('/admin/analytics/revenue', { ...A, query: { range } });
export const getAnalyticsOverview = () => get('/admin/analytics/overview', A);
export const getAdminLogs = () => get('/admin/logs', { ...A, query: { limit: 50 } }).then((d) => d.items);
export const getSystemHealth = () => get('/admin/system-health', A);
export const getIntegrations = () => get('/admin/integrations', A);
/** Copies the ML model's upcoming predictions into the platform. publish=false imports drafts. */
export const syncMlPredictions = (publish) => post('/admin/integrations/ml/sync', { publish }, A);
export const importNews = () => post('/admin/integrations/news/import', undefined, A);

// users
export const getUsers = (query) => get('/admin/users', { ...A, query: { limit: 100, ...query } });
export const getUser = (id) => get(`/admin/users/${id}`, A);
export const setUserBlocked = (id, blocked) => patch(`/admin/users/${id}/status`, { status: blocked ? 'BLOCKED' : 'ACTIVE' }, A);

// catalogue
export const getCatalogue = () => get('/admin/catalogue', A);
export const createSport = (body) => post('/admin/sports', body, A);
export const updateSport = (id, body) => put(`/admin/sports/${id}`, body, A);
export const createTeam = (body) => post('/admin/teams', body, A);
export const updateTeam = (id, body) => put(`/admin/teams/${id}`, body, A);
export const deleteTeam = (id) => del(`/admin/teams/${id}`, A);
export const createTournament = (body) => post('/admin/tournaments', body, A);

// matches
export const getAdminMatches = (query) => get('/admin/matches', { ...A, query: { limit: 100, ...query } }).then((d) => d.items);
export const saveMatch = (id, fields, imageFile) =>
  request(id ? `/admin/matches/${id}` : '/admin/matches', { ...A, method: id ? 'PUT' : 'POST', form: toFormData(fields, imageFile) });
export const patchMatch = (id, body) => patch(`/admin/matches/${id}`, body, A);
export const deleteMatch = (id) => del(`/admin/matches/${id}`, A);
export const setMatchResult = (id, body) => put(`/admin/matches/${id}/result`, body, A);

// predictions
export const getAdminPredictions = (query) => get('/admin/predictions', { ...A, query: { limit: 100, ...query } }).then((d) => d.items);
export const getAdminPrediction = (id) => get(`/admin/predictions/${id}`, A);
export const savePrediction = (id, body) => (id ? put(`/admin/predictions/${id}`, body, A) : post('/admin/predictions', body, A));
export const publishPrediction = (id) => post(`/admin/predictions/${id}/publish`, undefined, A);
export const unpublishPrediction = (id) => post(`/admin/predictions/${id}/unpublish`, undefined, A);
export const deletePrediction = (id) => del(`/admin/predictions/${id}`, A);

// news
export const getAdminNews = (query) => get('/admin/news', { ...A, query: { limit: 100, ...query } }).then((d) => d.items);
export const saveNews = (id, fields, imageFile) =>
  request(id ? `/admin/news/${id}` : '/admin/news', { ...A, method: id ? 'PUT' : 'POST', form: toFormData(fields, imageFile) });
export const setNewsStatus = (id, status) => patch(`/admin/news/${id}/status`, { status }, A);
export const deleteNews = (id) => del(`/admin/news/${id}`, A);

// payments, subscriptions, plans
export const getTransactions = (query) => get('/admin/transactions', { ...A, query: { limit: 100, ...query } });
export const refundTransaction = (id, body) => post(`/admin/transactions/${id}/refund`, body, A);
export const getSubscriptions = (query) => get('/admin/subscriptions', { ...A, query: { limit: 100, ...query } });
export const getPlans = () => get('/admin/plans', A).then((d) => d.plans);
export const savePlan = (id, body) => (id ? put(`/admin/plans/${id}`, body, A) : post('/admin/plans', body, A));
