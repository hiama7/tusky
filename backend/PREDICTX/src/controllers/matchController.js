// Public sports / tournaments / matches endpoints. Only published, non-archived
// matches are visible. Each match carries the viewer's unlock status but never
// any prediction content.
import { prisma } from '../config/database.js';
import { newsFor } from '../services/matchNewsService.js';
import { playersFor } from '../services/playersService.js';
import { standingsFor } from '../services/standingsService.js';
import { ApiError, ok, paginate } from '../utils/apiResponse.js';
import { accessMap } from '../services/predictionService.js';
import * as S from '../services/serializers.js';

export async function listSports(_req, res) {
  const now = new Date();
  const [sports, counts] = await Promise.all([
    prisma.sport.findMany({ where: { status: 'ACTIVE' }, orderBy: { id: 'asc' } }),
    prisma.match.groupBy({ by: ['sportId'], where: { published: true, archivedAt: null, startsAt: { gt: now }, status: { in: ['UPCOMING', 'POSTPONED'] } }, _count: true }),
  ]);
  const bySport = Object.fromEntries(counts.map((c) => [c.sportId, c._count]));
  ok(res, { sports: sports.map((s) => S.sport(s, { upcomingMatches: bySport[s.id] || 0 })) });
}

export async function sportDetails(req, res) {
  const sport = await prisma.sport.findFirst({ where: { slug: req.params.slug, status: 'ACTIVE' }, include: { tournaments: { where: { status: 'ACTIVE' } } } });
  if (!sport) throw ApiError.notFound('Sport not found');
  ok(res, { sport: { ...S.sport(sport), tournaments: sport.tournaments.map((t) => ({ id: t.id, name: t.name, season: t.season })) } });
}

export async function listTournaments(req, res) {
  const where = { status: 'ACTIVE', matches: { some: { published: true, archivedAt: null } } };
  if (req.query.sport) where.sport = { slug: String(req.query.sport) };
  const rows = await prisma.tournament.findMany({ where, include: { sport: true }, orderBy: { name: 'asc' } });
  ok(res, { tournaments: rows.map((t) => ({ id: t.id, name: t.name, season: t.season, sport: t.sport.slug })) });
}

export function buildMatchWhere(q, { includeUnpublished = false } = {}) {
  const where = includeUnpublished ? {} : { published: true, archivedAt: null };
  if (q.sport && q.sport !== 'all') where.sport = { slug: q.sport };
  if (q.tournament) where.tournamentId = q.tournament;
  if (q.status) where.status = q.status;
  if (q.from || q.to || q.upcoming) {
    where.startsAt = {};
    if (q.from) where.startsAt.gte = q.from;
    if (q.to) where.startsAt.lte = q.to;
    // "upcoming" keeps matches that started in the last 3 hours (likely still live)
    if (q.upcoming) where.startsAt.gte = new Date(Math.max(q.from?.getTime() || 0, Date.now() - 3 * 3600_000));
  }
  if (q.upcoming) where.status = { in: ['UPCOMING', 'LIVE', 'POSTPONED'] };
  if (q.featured !== undefined) where.featured = q.featured;
  if (q.q) {
    where.OR = [
      { teamA: { name: { contains: q.q } } },
      { teamB: { name: { contains: q.q } } },
      { tournament: { name: { contains: q.q } } },
      { venue: { contains: q.q } },
    ];
  }
  return where;
}

export async function listMatches(req, res) {
  const q = req.valid.query;
  const { skip, take, meta } = paginate(q, { defaultLimit: 50 });
  const where = buildMatchWhere(q);
  const [rows, total] = await Promise.all([
    prisma.match.findMany({ where, include: S.MATCH_INCLUDE, orderBy: { startsAt: q.status === 'COMPLETED' ? 'desc' : 'asc' }, skip, take }),
    prisma.match.count({ where }),
  ]);
  const access = await accessMap(req.user?.id, rows);
  ok(res, { items: rows.map((m) => S.match(m, access.get(m.id))), pagination: meta(total) });
}

export async function matchDetails(req, res) {
  const m = await prisma.match.findFirst({ where: { id: req.valid.params.id, published: true, archivedAt: null }, include: S.MATCH_INCLUDE });
  if (!m) throw ApiError.notFound('Match not found');
  const access = await accessMap(req.user?.id, [m]);
  ok(res, { match: S.match(m, access.get(m.id)) });
}

/** The published match's sport, competition and team names. */
async function fixtureOf(req) {
  const m = await prisma.match.findFirst({
    where: { id: req.valid.params.id, published: true, archivedAt: null },
    include: { sport: true, tournament: true, teamA: true, teamB: true },
  });
  if (!m) throw ApiError.notFound('Match not found');
  return { sport: m.sport.slug, tournament: m.tournament.name, teamA: m.teamA.name, teamB: m.teamB.name };
}

/** GET /api/matches/:id/standings — the competition's league table, if available. */
export async function matchStandings(req, res) {
  ok(res, await standingsFor(await fixtureOf(req)));
}

/** GET /api/matches/:id/players — both squads with this season's scoring figures. */
export async function matchPlayers(req, res) {
  ok(res, await playersFor(await fixtureOf(req)));
}

/** GET /api/matches/:id/news — recent published articles naming either team. */
export async function matchNews(req, res) {
  ok(res, { items: await newsFor(await fixtureOf(req)) });
}

export async function matchResults(req, res) {
  const { skip, take, meta } = paginate(req.query);
  const where = { published: true, archivedAt: null, result: { isNot: null } };
  if (req.query.sport) where.sport = { slug: String(req.query.sport) };
  const [rows, total] = await Promise.all([
    prisma.match.findMany({ where, include: S.MATCH_INCLUDE, orderBy: { startsAt: 'desc' }, skip, take }),
    prisma.match.count({ where }),
  ]);
  ok(res, { items: rows.map((m) => S.match(m)), pagination: meta(total) });
}
