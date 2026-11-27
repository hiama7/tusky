// Sports, matches and predictions (public + user). Prediction content is only
// returned by the server when the logged-in user is entitled to it.
import { get } from './api';

export const getTrackRecord = () => get('/track-record');
export const getSports = () => get('/sports').then((d) => d.sports);
export const getTournaments = (sport) => get('/tournaments', { query: { sport } }).then((d) => d.tournaments);

/** filters: { sport, tournament, status, from, to, q, featured, upcoming, page, limit } */
export const getMatches = (filters = {}) => get('/matches', { query: { limit: 100, ...filters } }).then((d) => d.items);
export const getMatchPage = (filters = {}) => get('/matches', { query: filters });
export const getMatch = (id) => get(`/matches/${id}`).then((d) => d.match);

/** → { available: false } or { available: true, competition, rows, attribution } */
export const getStandings = (matchId) => get(`/matches/${matchId}/standings`);

/** → { locked: true, price, available } or { locked: false, unlockReason, prediction } */
export const getPrediction = (matchId) => get(`/matches/${matchId}/prediction`);
export const getPredictions = () => get('/predictions', { query: { limit: 100 } }).then((d) => d.items);
