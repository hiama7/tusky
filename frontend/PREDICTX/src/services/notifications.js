// =========================================================
// notifications.js — per-user notifications + activity timeline (demo).
// Stage 2: GET/POST /api/notifications.php, GET /api/activity.php
// =========================================================
import { simulate } from './api';
import { update, table } from './db';
import { uid } from './storage';

const WELCOME = [
  { id: 'NW1', title: 'India vs Australia prediction is live', body: 'Unlock the full T20 analysis before the toss.', type: 'info', read: false },
  { id: 'NW2', title: 'Free trial available', body: 'Your first prediction is on us — activate it anytime.', type: 'success', read: false },
];

export function addNotification(userId, { title, body, type = 'info' }) {
  update('notifications', (all) => {
    const list = all[userId] || [...WELCOME];
    all[userId] = [{ id: uid('N'), title, body, type, read: false, date: new Date().toISOString() }, ...list].slice(0, 30);
    return all;
  });
}

export function getNotifications(userId) {
  return simulate(() => {
    const list = table('notifications')[userId];
    return (list || WELCOME.map((n) => ({ ...n, date: new Date().toISOString() })));
  }, 80);
}

export function markAllRead(userId) {
  return simulate(() => {
    update('notifications', (all) => {
      all[userId] = (all[userId] || WELCOME).map((n) => ({ ...n, read: true }));
      return all;
    });
  }, 50);
}

export function logActivity(userId, text, kind = 'info') {
  update('activity', (all) => {
    all[userId] = [{ id: uid('A'), text, kind, date: new Date().toISOString() }, ...(all[userId] || [])].slice(0, 50);
    return all;
  });
}

export function getActivity(userId) {
  return simulate(() => table('activity')[userId] || [], 80);
}
