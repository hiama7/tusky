// League tables from football-data.org (https://www.football-data.org).
// Needs FOOTBALL_DATA_API_KEY. The free plan allows 10 requests a minute, so each
// competition's table is cached; failures are remembered briefly too.
import { env } from '../config/env.js';

export const ATTRIBUTION = 'Football data provided by the Football-Data.org API';

// our competition names → football-data.org codes (free plan competitions)
const CODES = {
  'premier league': 'PL',
  'la liga': 'PD',
  'serie a': 'SA',
  bundesliga: 'BL1',
  'ligue 1': 'FL1',
  'champions league': 'CL',
  'uefa champions league': 'CL',
  eredivisie: 'DED',
  'primeira liga': 'PPL',
  championship: 'ELC',
};

const TTL_MS = 60 * 60_000;
const ERROR_TTL_MS = 60_000;
const cache = new Map(); // code → { expires, value: Promise }

export const clearStandingsCache = () => cache.clear();

// words that clubs' names carry in one source but not another
const NOISE = new Set(['fc', 'cf', 'afc', 'sc', 'sv', 'ac', 'as', 'rc', 'cd', 'ud', 'ssc', 'us', 'ss', 'club', 'de', 'calcio', 'estac']);
// clubs whose names differ by more than those words
const ALIASES = { rennes: 'stade rennais' };

export function teamKey(name) {
  const key = String(name || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !NOISE.has(w) && !/^\d+$/.test(w))
    .join(' ');
  return ALIASES[key] || key;
}

/** Index of the one row that is clearly this team, or -1 when unsure. */
export function findTeam(rows, name) {
  const key = teamKey(name);
  if (!key) return -1;
  const exact = rows.findIndex((r) => r.names.some((n) => teamKey(n) === key));
  if (exact >= 0) return exact;
  const close = rows.flatMap((r, i) => (r.names.some((n) => ` ${teamKey(n)} `.includes(` ${key} `)) ? [i] : []));
  return close.length === 1 ? close[0] : -1;
}

async function fetchTable(code) {
  const res = await fetch(`https://api.football-data.org/v4/competitions/${code}/standings`, {
    headers: { 'X-Auth-Token': env.FOOTBALL_DATA_API_KEY },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`football-data.org answered ${res.status}`);
  const data = await res.json();
  const table = data.standings?.find((s) => s.type === 'TOTAL')?.table;
  if (!table?.length) return null;
  return {
    competition: data.competition?.name || code,
    rows: table.map((r) => ({
      names: [r.team?.shortName, r.team?.name].filter(Boolean),
      position: r.position,
      team: r.team?.shortName || r.team?.name,
      played: r.playedGames,
      won: r.won,
      drawn: r.draw,
      lost: r.lost,
      goalDifference: r.goalDifference,
      points: r.points,
    })),
  };
}

function cached(code) {
  const hit = cache.get(code);
  if (hit && hit.expires > Date.now()) return hit.value;
  const entry = { expires: Date.now() + TTL_MS };
  entry.value = fetchTable(code).catch((e) => {
    entry.expires = Date.now() + ERROR_TTL_MS;
    console.warn(`[standings] ${code}: ${e.message}`);
    return null;
  });
  cache.set(code, entry);
  return entry.value;
}

/** Table for a match's competition, with the two playing teams marked. */
export async function standingsFor({ sport, tournament, teamA, teamB }) {
  const code = sport === 'football' ? CODES[String(tournament).trim().toLowerCase()] : undefined;
  if (!env.FOOTBALL_DATA_API_KEY || !code) return { available: false };
  const table = await cached(code);
  if (!table) return { available: false };
  const a = findTeam(table.rows, teamA);
  const b = findTeam(table.rows, teamB);
  // both teams must be recognisable as this league's, or it may be a different competition of the same name
  if (a < 0 && b < 0) return { available: false };
  return {
    available: true,
    competition: table.competition,
    attribution: ATTRIBUTION,
    rows: table.rows.map(({ names: _names, ...row }, i) => ({ ...row, side: i === a ? 'A' : i === b ? 'B' : null })),
  };
}
