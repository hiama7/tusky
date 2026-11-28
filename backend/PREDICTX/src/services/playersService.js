// Squads and this season's scoring figures for the two teams of a football match,
// from football-data.org (same key, credit line and rate limit as the league tables).
// The free plan lists only a competition's leading scorers, so for everyone else the
// figures are unknown (null), which is not the same as zero. Dates of birth are not
// passed on; only the age is.
import { env } from '../config/env.js';
import { ATTRIBUTION, competitionCode, findTeam } from './standingsService.js';

const TTL_MS = 6 * 60 * 60_000;
const ERROR_TTL_MS = 60_000;
const SCORER_LIMIT = 100;
const cache = new Map(); // path → { expires, value: Promise }

export const clearPlayersCache = () => cache.clear();

function cached(path) {
  const hit = cache.get(path);
  if (hit && hit.expires > Date.now()) return hit.value;
  const entry = { expires: Date.now() + TTL_MS };
  entry.value = fetch(`https://api.football-data.org/v4/competitions/${path}`, {
    headers: { 'X-Auth-Token': env.FOOTBALL_DATA_API_KEY },
    signal: AbortSignal.timeout(8000),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`football-data.org answered ${res.status}`);
      return res.json();
    })
    .catch((e) => {
      entry.expires = Date.now() + ERROR_TTL_MS;
      console.warn(`[players] ${path}: ${e.message}`);
      return null;
    });
  cache.set(path, entry);
  return entry.value;
}

export function ageOn(dateOfBirth, now = new Date()) {
  const born = new Date(dateOfBirth || '');
  if (Number.isNaN(born.getTime())) return null;
  const beforeBirthday = now.getUTCMonth() < born.getUTCMonth() || (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate());
  return now.getUTCFullYear() - born.getUTCFullYear() - (beforeBirthday ? 1 : 0);
}

const figures = (s) => ({
  played: s?.playedMatches ?? null,
  goals: s?.goals ?? null,
  // inside a listed scorer's row, a missing assist or penalty count means none
  assists: s ? (s.assists ?? 0) : null,
  penalties: s ? (s.penalties ?? 0) : null,
});

const player = (p, scorer) => ({
  id: p.id,
  name: p.name,
  position: p.position || p.section || null,
  nationality: p.nationality || null,
  age: ageOn(p.dateOfBirth),
  ...figures(scorer),
});

function squadWithFigures(team, scorers) {
  const listed = new Map(scorers.filter((s) => s.team?.id === team.id).map((s) => [s.player.id, s]));
  const players = (team.squad || []).map((p) => player(p, listed.get(p.id)));
  // a scorer missing from the squad list (a late signing, say) still belongs here
  const known = new Set(players.map((p) => p.id));
  for (const [id, s] of listed) if (!known.has(id)) players.push(player(s.player, s));
  return players.sort((a, b) => (b.goals ?? -1) - (a.goals ?? -1) || (b.assists ?? -1) - (a.assists ?? -1) || a.name.localeCompare(b.name));
}

export async function playersFor({ sport, tournament, teamA, teamB }) {
  const code = competitionCode(sport, tournament);
  if (!env.FOOTBALL_DATA_API_KEY || !code) return { available: false };
  const [squads, top] = await Promise.all([cached(`${code}/teams`), cached(`${code}/scorers?limit=${SCORER_LIMIT}`)]);
  if (!squads?.teams?.length) return { available: false };

  const rows = squads.teams.map((t) => ({ names: [t.shortName, t.name].filter(Boolean) }));
  const teams = [['A', teamA], ['B', teamB]].flatMap(([side, name]) => {
    const team = squads.teams[findTeam(rows, name)];
    return team ? [{ side, name, players: squadWithFigures(team, top?.scorers || []) }] : [];
  });
  if (!teams.length) return { available: false };
  return { available: true, attribution: ATTRIBUTION, hasFigures: Boolean(top?.scorers?.length), teams };
}
