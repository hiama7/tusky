// =========================================================
// trial.js — one free prediction per user (DEMO).
// localStorage only demonstrates the flow; clearing browser data resets it.
// Real one-time enforcement happens in Stage 2 with PHP + MySQL
// (e.g. a UNIQUE(user_id) row in a `free_trials` table):
//   GET  /api/trial.php     POST /api/trial/activate.php { match_id }
// =========================================================
import { simulate, DemoError } from './api';
import { table, update } from './db';
import { addNotification, logActivity } from './notifications';

/** status: 'available' | 'used' */
export function getTrialSync(userId) {
  return table('trials')[userId] || { status: 'available', matchId: null, activatedAt: null };
}
export const getTrial = (userId) => simulate(() => getTrialSync(userId), 80);

export function activateTrial(user, match) {
  return simulate(() => {
    if (getTrialSync(user.id).status === 'used') throw new DemoError('Your free trial has already been used.');
    if (table('purchases')[user.id]?.[match.id]) throw new DemoError('You already own this prediction — pick a locked match instead.');
    const record = { status: 'used', matchId: match.id, activatedAt: new Date().toISOString() };
    update('trials', (t) => ({ ...t, [user.id]: record }));
    addNotification(user.id, { title: 'Free trial activated', body: `${match.teamA.name} vs ${match.teamB.name} has been unlocked for free.`, type: 'success' });
    logActivity(user.id, `Used free trial on ${match.teamA.name} vs ${match.teamB.name}`, 'trial');
    return record;
  }, 900);
}
