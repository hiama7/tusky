// One-time free trial — enforced by the server and MySQL, not the browser.
import { get, post } from './api';

/** → { status: 'available' | 'used', matchId, activatedAt, match } */
export const getTrial = () => get('/trial/status');
export const activateTrial = (matchId) => post('/trial/activate', { matchId });
