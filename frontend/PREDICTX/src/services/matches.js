// =========================================================
// matches.js — fixtures + predictions (read for users, CRUD for admin).
// Stage 2 endpoints:
//   GET  /api/matches.php?sport=&q=&status=     GET /api/matches.php?id=
//   GET  /api/predictions.php?match_id=          (only returned if unlocked!)
//   POST/PUT/DELETE /api/admin/matches.php, /api/admin/predictions.php
// NOTE: in Stage 2 the server must never send prediction numbers for a
// locked match — the blur here is presentation only.
// =========================================================
import { simulate, DemoError } from './api';
import { table, save, update } from './db';
import { uid } from './storage';

/** Users only see published matches; admin sees everything. */
export function getMatches({ sport = 'all', q = '', tournament = 'all', includeDrafts = false, upcomingOnly = false } = {}) {
  return simulate(() => {
    const term = q.trim().toLowerCase();
    const now = Date.now();
    return table('matches')
      .filter((m) => includeDrafts || m.status === 'published')
      .filter((m) => sport === 'all' || m.sport === sport)
      .filter((m) => tournament === 'all' || m.tournament === tournament)
      .filter((m) => !upcomingOnly || new Date(m.date).getTime() > now - 3 * 3600e3)
      .filter((m) => !term || `${m.teamA.name} ${m.teamB.name} ${m.tournament} ${m.venue} ${m.sport}`.toLowerCase().includes(term))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
  });
}

export function getMatch(id) {
  return simulate(() => {
    const m = table('matches').find((x) => x.id === id);
    if (!m) throw new DemoError('Match not found.');
    return m;
  });
}

export function getPrediction(matchId, { includeDrafts = false } = {}) {
  return simulate(() => table('predictions').find((p) => p.matchId === matchId && (includeDrafts || p.status === 'published')) || null);
}

export function getPredictions() {
  return simulate(() => table('predictions'));
}

/* ---------------- Admin: matches ---------------- */
export function saveMatch(match) {
  return simulate(() => {
    if (!match.teamA?.name || !match.teamB?.name) throw new DemoError('Both team names are required.');
    const rows = table('matches');
    if (match.id) {
      save('matches', rows.map((m) => (m.id === match.id ? { ...m, ...match } : m)));
      return match;
    }
    const created = { ...match, id: uid('M'), status: match.status || 'draft' };
    save('matches', [created, ...rows]);
    return created;
  }, 300);
}

export function deleteMatch(id) {
  return simulate(() => {
    update('matches', (rows) => rows.filter((m) => m.id !== id));
    update('predictions', (rows) => rows.filter((p) => p.matchId !== id));
  });
}

export function setMatchStatus(id, status) {
  return simulate(() => update('matches', (rows) => rows.map((m) => (m.id === id ? { ...m, status } : m))));
}

/* ---------------- Admin: predictions ---------------- */
export function savePrediction(pred) {
  return simulate(() => {
    const probA = Number(pred.probA);
    if (!(probA >= 0 && probA <= 100)) throw new DemoError('Probability must be between 0 and 100.');
    const clean = { ...pred, probA, probB: 100 - probA };
    const rows = table('predictions');
    const existing = rows.find((p) => p.id === pred.id || (!pred.id && p.matchId === pred.matchId));
    if (existing) {
      save('predictions', rows.map((p) => (p.id === existing.id ? { ...existing, ...clean, id: existing.id } : p)));
      return { ...existing, ...clean };
    }
    const created = {
      teamA: { form: [], strengths: [], weaknesses: [] },
      teamB: { form: [], strengths: [], weaknesses: [] },
      players: [],
      h2h: { played: 0, aWins: 0, bWins: 0, draws: 0 },
      insights: [],
      status: 'draft',
      ...clean,
      id: uid('P'),
    };
    save('predictions', [created, ...rows]);
    return created;
  }, 300);
}

export function deletePrediction(id) {
  return simulate(() => update('predictions', (rows) => rows.filter((p) => p.id !== id)));
}

export function setPredictionStatus(id, status) {
  return simulate(() => update('predictions', (rows) => rows.map((p) => (p.id === id ? { ...p, status } : p))));
}
