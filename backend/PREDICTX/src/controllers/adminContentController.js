// Admin content management: sports, teams, tournaments, matches (+ results),
// predictions (with versioning) and news. Every change is written to admin_logs.
import { prisma } from '../config/database.js';
import { ApiError, created, ok, paginate } from '../utils/apiResponse.js';
import { money } from '../utils/money.js';
import { removeUpload } from '../middleware/uploadMiddleware.js';
import { adminLog } from '../services/notificationService.js';
import { publishInTx, validateProbabilities } from '../services/predictionService.js';
import { uniqueNewsSlug } from '../services/sportsDataService.js';
import { shortCode, slugify } from '../services/slug.js';
import { buildMatchWhere } from './matchController.js';
import * as S from '../services/serializers.js';

// ============================================================================= sports / teams / tournaments

export async function listCatalogue(_req, res) {
  const [sports, teams, tournaments] = await Promise.all([
    prisma.sport.findMany({ orderBy: { id: 'asc' }, include: { _count: { select: { matches: true, teams: true } } } }),
    prisma.team.findMany({ include: { sport: true }, orderBy: [{ sportId: 'asc' }, { name: 'asc' }] }),
    prisma.tournament.findMany({ include: { sport: true }, orderBy: [{ sportId: 'asc' }, { name: 'asc' }] }),
  ]);
  ok(res, {
    sports: sports.map((s) => S.sport(s, { matches: s._count.matches, teams: s._count.teams })),
    teams: teams.map((t) => ({ id: t.id, sportId: t.sportId, sport: t.sport.slug, name: t.name, short: t.shortName, color: t.color, country: t.country, logo: t.logo })),
    tournaments: tournaments.map((t) => ({ id: t.id, sportId: t.sportId, sport: t.sport.slug, name: t.name, season: t.season, status: t.status })),
  });
}

export async function createSport(req, res) {
  const b = req.valid.body;
  const sport = await prisma.sport.create({ data: { ...b, slug: slugify(b.name), image: req.uploadedFile || b.image || null } });
  await adminLog(req, 'SPORT_CREATED', `Added sport ${sport.name}`, { entityType: 'sport', entityId: sport.id });
  created(res, { sport: S.sport(sport) }, 'Sport added');
}

export async function updateSport(req, res) {
  const id = req.valid.params.id;
  const b = req.valid.body;
  const sport = await prisma.sport.update({ where: { id }, data: { ...b, ...(req.uploadedFile ? { image: req.uploadedFile } : {}) } });
  await adminLog(req, 'SPORT_UPDATED', `Updated sport ${sport.name}`, { entityType: 'sport', entityId: id });
  ok(res, { sport: S.sport(sport) }, 'Sport updated');
}

export async function createTeam(req, res) {
  const b = req.valid.body;
  const team = await prisma.team.create({ data: { ...b, shortName: (b.shortName || shortCode(b.name)).toUpperCase(), color: b.color || '#386BFF', logo: req.uploadedFile || null } });
  await adminLog(req, 'TEAM_CREATED', `Added team ${team.name}`, { entityType: 'team', entityId: team.id });
  created(res, { team }, 'Team added');
}

export async function updateTeam(req, res) {
  const id = req.valid.params.id;
  const b = req.valid.body;
  const team = await prisma.team.update({ where: { id }, data: { ...b, shortName: b.shortName ? b.shortName.toUpperCase() : undefined, ...(req.uploadedFile ? { logo: req.uploadedFile } : {}) } });
  await adminLog(req, 'TEAM_UPDATED', `Updated team ${team.name}`, { entityType: 'team', entityId: id });
  ok(res, { team }, 'Team updated');
}

export async function deleteTeam(req, res) {
  const id = req.valid.params.id;
  const team = await prisma.team.delete({ where: { id } }); // FK RESTRICT → 409 if used by matches
  await removeUpload(team.logo);
  await adminLog(req, 'TEAM_DELETED', `Deleted team ${team.name}`, { entityType: 'team', entityId: id });
  ok(res, {}, 'Team deleted');
}

export async function createTournament(req, res) {
  const t = await prisma.tournament.create({ data: req.valid.body });
  await adminLog(req, 'TOURNAMENT_CREATED', `Added tournament ${t.name} ${t.season}`.trim(), { entityType: 'tournament', entityId: t.id });
  created(res, { tournament: t }, 'Tournament added');
}

export async function updateTournament(req, res) {
  const id = req.valid.params.id;
  const t = await prisma.tournament.update({ where: { id }, data: req.valid.body });
  await adminLog(req, 'TOURNAMENT_UPDATED', `Updated tournament ${t.name}`, { entityType: 'tournament', entityId: id });
  ok(res, { tournament: t }, 'Tournament updated');
}

// ============================================================================= matches

export async function listMatches(req, res) {
  const q = req.valid.query;
  const { skip, take, meta } = paginate(q, { defaultLimit: 50 });
  const where = buildMatchWhere({ q: q.q, sport: q.sport }, { includeUnpublished: true });
  if (q.status === 'published') where.published = true;
  else if (q.status === 'draft') where.published = false;
  else if (q.status === 'archived') where.archivedAt = { not: null };
  if (q.status !== 'archived') where.archivedAt = null;
  const [rows, total] = await Promise.all([
    prisma.match.findMany({ where, include: { ...S.MATCH_INCLUDE, _count: { select: { purchases: true } } }, orderBy: { startsAt: 'asc' }, skip, take }),
    prisma.match.count({ where }),
  ]);
  ok(res, { items: rows.map((m) => ({ ...S.match(m), purchases: m._count.purchases, predictionStatus: m.prediction?.publicationStatus || null })), pagination: meta(total) });
}

/** Resolves team/tournament ids, creating them by name inside the chosen sport when needed. */
async function resolveRefs(b, db) {
  const sport = await db.sport.findUnique({ where: { id: b.sportId } });
  if (!sport) throw ApiError.validation([{ field: 'sportId', message: 'Unknown sport' }]);
  const team = async (id, name, field) => {
    if (id) {
      const t = await db.team.findUnique({ where: { id } });
      if (!t || t.sportId !== sport.id) throw ApiError.validation([{ field, message: 'Team does not belong to this sport' }]);
      return t.id;
    }
    const t = await db.team.upsert({
      where: { sportId_name: { sportId: sport.id, name } },
      update: {},
      create: { sportId: sport.id, name, shortName: shortCode(name), color: ['#386BFF', '#8657FF', '#20D9A0', '#FFB547', '#FF5263', '#38BDF8'][name.length % 6] },
    });
    return t.id;
  };
  let tournamentId = b.tournamentId;
  if (tournamentId) {
    const t = await db.tournament.findUnique({ where: { id: tournamentId } });
    if (!t || t.sportId !== sport.id) throw ApiError.validation([{ field: 'tournamentId', message: 'Tournament does not belong to this sport' }]);
  } else {
    const t = await db.tournament.upsert({
      where: { sportId_name_season: { sportId: sport.id, name: b.tournamentName, season: '' } },
      update: {},
      create: { sportId: sport.id, name: b.tournamentName },
    });
    tournamentId = t.id;
  }
  const teamAId = await team(b.teamAId, b.teamAName, 'teamAName');
  const teamBId = await team(b.teamBId, b.teamBName, 'teamBName');
  if (teamAId === teamBId) throw ApiError.validation([{ field: 'teamBName', message: 'Teams must be different' }]);
  return { sportId: sport.id, tournamentId, teamAId, teamBId };
}

function matchData(b, refs) {
  return {
    ...refs,
    startsAt: b.startsAt,
    venue: b.venue,
    conditions: b.conditions ?? null,
    predictionPrice: b.predictionPrice,
    status: b.status,
    ...(b.published !== undefined ? { published: b.published } : {}),
    ...(b.featured !== undefined ? { featured: b.featured } : {}),
  };
}

export async function createMatch(req, res) {
  const b = req.valid.body;
  const m = await prisma.$transaction(async (db) => {
    const refs = await resolveRefs(b, db);
    return db.match.create({ data: { ...matchData(b, refs), image: req.uploadedFile || null }, include: S.MATCH_INCLUDE });
  });
  await adminLog(req, 'MATCH_CREATED', `Created ${m.teamA.name} vs ${m.teamB.name} (₹${money(m.predictionPrice)})`, { entityType: 'match', entityId: m.id });
  created(res, { match: S.match(m) }, m.published ? 'Match created and published' : 'Match saved as a draft');
}

export async function updateMatch(req, res) {
  const id = req.valid.params.id;
  const b = req.valid.body;
  const before = await prisma.match.findUnique({ where: { id } });
  if (!before) throw ApiError.notFound('Match not found');
  const m = await prisma.$transaction(async (db) => {
    const refs = await resolveRefs(b, db);
    const image = req.uploadedFile ? req.uploadedFile : b.removeImage ? null : undefined;
    return db.match.update({ where: { id }, data: { ...matchData(b, refs), ...(image !== undefined ? { image } : {}) }, include: S.MATCH_INCLUDE });
  });
  if (before.image && (req.uploadedFile || b.removeImage)) await removeUpload(before.image);
  const priceNote = money(before.predictionPrice) !== money(m.predictionPrice) ? ` price ₹${money(before.predictionPrice)} → ₹${money(m.predictionPrice)}` : '';
  await adminLog(req, 'MATCH_UPDATED', `Edited ${m.teamA.name} vs ${m.teamB.name}${priceNote}`, { entityType: 'match', entityId: id });
  ok(res, { match: S.match(m) }, 'Match updated');
}

/** Quick actions: publish/unpublish, status, featured, price. */
export async function patchMatch(req, res) {
  const id = req.valid.params.id;
  const b = req.valid.body;
  const m = await prisma.match.update({ where: { id }, data: b, include: S.MATCH_INCLUDE });
  const parts = Object.entries(b).map(([k, v]) => `${k}=${v}`).join(', ');
  await adminLog(req, 'MATCH_UPDATED', `${m.teamA.name} vs ${m.teamB.name}: ${parts}`, { entityType: 'match', entityId: id });
  ok(res, { match: S.match(m) }, 'Match updated');
}

/** Deletes a match with no sales history; otherwise archives (unpublishes) it to keep records intact. */
export async function deleteMatch(req, res) {
  const id = req.valid.params.id;
  const m = await prisma.match.findUnique({ where: { id }, include: { teamA: true, teamB: true, _count: { select: { purchases: true, freeTrials: true, transactions: true } } } });
  if (!m) throw ApiError.notFound('Match not found');
  const label = `${m.teamA.name} vs ${m.teamB.name}`;
  if (m._count.purchases || m._count.freeTrials || m._count.transactions) {
    await prisma.match.update({ where: { id }, data: { archivedAt: new Date(), published: false, featured: false } });
    await adminLog(req, 'MATCH_ARCHIVED', `Archived ${label} (has sales history)`, { entityType: 'match', entityId: id });
    return ok(res, { archived: true }, 'Match has purchases, so it was archived and unpublished instead of deleted');
  }
  await prisma.match.delete({ where: { id } });
  await removeUpload(m.image);
  await adminLog(req, 'MATCH_DELETED', `Deleted ${label}`, { entityType: 'match', entityId: id });
  ok(res, { deleted: true }, 'Match deleted');
}

export async function setResult(req, res) {
  const id = req.valid.params.id;
  const b = req.valid.body;
  const m = await prisma.match.findUnique({ where: { id }, include: { teamA: true, teamB: true } });
  if (!m) throw ApiError.notFound('Match not found');
  const winningTeamId = b.outcome === 'TEAM_A' ? m.teamAId : b.outcome === 'TEAM_B' ? m.teamBId : null;
  const data = {
    winningTeamId,
    isDraw: b.outcome === 'DRAW',
    scoreSummary: b.scoreSummary ?? null,
    resultDescription: b.resultDescription,
    matchCompletedAt: b.completedAt || new Date(),
    verifiedAt: b.verified ? new Date() : null,
    source: 'MANUAL',
  };
  await prisma.$transaction([
    prisma.matchResult.upsert({ where: { matchId: id }, update: data, create: { matchId: id, ...data } }),
    prisma.match.update({ where: { id }, data: { status: 'COMPLETED' } }),
  ]);
  await adminLog(req, 'MATCH_RESULT', `Result for ${m.teamA.name} vs ${m.teamB.name}: ${b.resultDescription}`, { entityType: 'match', entityId: id });
  ok(res, {}, 'Result saved and match marked completed');
}

// ============================================================================= predictions

export async function listPredictions(req, res) {
  const q = req.valid.query;
  const { skip, take, meta } = paginate(q, { defaultLimit: 50 });
  const where = {};
  if (q.status === 'published') where.publicationStatus = 'PUBLISHED';
  if (q.status === 'draft') where.publicationStatus = { in: ['DRAFT', 'UNPUBLISHED'] };
  if (q.q) where.match = { OR: [{ teamA: { name: { contains: q.q } } }, { teamB: { name: { contains: q.q } } }] };
  const [rows, total] = await Promise.all([
    prisma.prediction.findMany({ where, include: { match: { include: S.MATCH_INCLUDE }, _count: { select: { versions: true } } }, orderBy: { match: { startsAt: 'asc' } }, skip, take }),
    prisma.prediction.count({ where }),
  ]);
  ok(res, { items: rows.map((p) => ({ ...S.prediction(p), match: S.match(p.match), versions: p._count.versions })), pagination: meta(total) });
}

export async function predictionDetails(req, res) {
  const p = await prisma.prediction.findUnique({ where: { id: req.valid.params.id }, include: { match: { include: S.MATCH_INCLUDE }, versions: { orderBy: { version: 'desc' }, include: { publishedBy: { select: { fullName: true } } } } } });
  if (!p) throw ApiError.notFound('Prediction not found');
  ok(res, { prediction: { ...S.prediction(p), match: S.match(p.match) }, versions: p.versions.map((v) => ({ version: v.version, publishedAt: v.publishedAt, publishedBy: v.publishedBy?.fullName, snapshot: v.snapshot })) });
}

function predictionData(b, match) {
  const outcomeFormat = b.outcomeFormat || match.sport.outcomeFormat;
  const probs = validateProbabilities({ ...b, outcomeFormat });
  return {
    outcomeFormat,
    ...probs,
    confidenceLevel: b.confidenceLevel,
    summary: b.summary,
    teamAnalysis: { teamA: { strengths: b.teamA.strengths, weaknesses: b.teamA.weaknesses }, teamB: { strengths: b.teamB.strengths, weaknesses: b.teamB.weaknesses } },
    recentForm: { teamA: b.teamA.form, teamB: b.teamB.form },
    playerAnalysis: b.players,
    headToHead: b.headToHead,
    keyFactors: b.keyFactors,
    pitchAnalysis: b.pitchAnalysis ?? null,
    weatherAnalysis: b.weatherAnalysis ?? null,
    source: b.source,
    modelVersion: b.source === 'MODEL' ? b.modelVersion ?? null : null,
  };
}

export async function createPrediction(req, res) {
  const b = req.valid.body;
  const match = await prisma.match.findUnique({ where: { id: b.matchId }, include: { sport: true, prediction: true, teamA: true, teamB: true } });
  if (!match) throw ApiError.validation([{ field: 'matchId', message: 'Match not found' }]);
  if (match.prediction) throw ApiError.conflict('This match already has a prediction — edit it instead.');
  const p = await prisma.$transaction(async (db) => {
    const row = await db.prediction.create({ data: { matchId: match.id, ...predictionData(b, match), createdById: req.admin.id } });
    return b.publish ? publishInTx(db, row.id, req.admin.id) : row;
  });
  await adminLog(req, b.publish ? 'PREDICTION_PUBLISHED' : 'PREDICTION_CREATED', `${b.publish ? 'Created and published' : 'Created draft'} prediction for ${match.teamA.name} vs ${match.teamB.name}`, { entityType: 'prediction', entityId: p.id });
  created(res, { prediction: S.prediction(p) }, b.publish ? 'Prediction published' : 'Prediction saved as draft');
}

export async function updatePrediction(req, res) {
  const id = req.valid.params.id;
  const b = req.valid.body;
  const existing = await prisma.prediction.findUnique({ where: { id }, include: { match: { include: { sport: true, teamA: true, teamB: true } } } });
  if (!existing) throw ApiError.notFound('Prediction not found');
  if (existing.matchId !== b.matchId) throw ApiError.validation([{ field: 'matchId', message: 'A prediction cannot be moved to another match' }]);
  const wasPublished = existing.publicationStatus === 'PUBLISHED';
  const p = await prisma.$transaction(async (db) => {
    await db.prediction.update({ where: { id }, data: predictionData(b, existing.match) });
    // Editing a live prediction publishes a new version so the change is audited.
    if (b.publish || (wasPublished && b.publish !== false)) return publishInTx(db, id, req.admin.id);
    if (b.publish === false && wasPublished) return db.prediction.update({ where: { id }, data: { publicationStatus: 'UNPUBLISHED' } });
    return db.prediction.findUnique({ where: { id } });
  });
  await adminLog(req, 'PREDICTION_UPDATED', `Edited prediction for ${existing.match.teamA.name} vs ${existing.match.teamB.name} (v${p.version})`, { entityType: 'prediction', entityId: id });
  ok(res, { prediction: S.prediction(p) }, 'Prediction updated');
}

export async function publishPrediction(req, res) {
  const id = req.valid.params.id;
  const p = await prisma.$transaction((db) => publishInTx(db, id, req.admin.id));
  await adminLog(req, 'PREDICTION_PUBLISHED', `Published prediction #${id} (v${p.version})`, { entityType: 'prediction', entityId: id });
  ok(res, { prediction: S.prediction(p) }, 'Prediction published');
}

export async function unpublishPrediction(req, res) {
  const id = req.valid.params.id;
  const p = await prisma.prediction.update({ where: { id }, data: { publicationStatus: 'UNPUBLISHED' } });
  await adminLog(req, 'PREDICTION_UNPUBLISHED', `Unpublished prediction #${id}`, { entityType: 'prediction', entityId: id });
  ok(res, { prediction: S.prediction(p) }, 'Prediction unpublished');
}

export async function deletePrediction(req, res) {
  const id = req.valid.params.id;
  const p = await prisma.prediction.findUnique({ where: { id }, include: { match: { include: { _count: { select: { purchases: true, freeTrials: true } } } } } });
  if (!p) throw ApiError.notFound('Prediction not found');
  if (p.match._count.purchases || p.match._count.freeTrials) {
    throw ApiError.conflict('Customers have unlocked this prediction. Unpublish it instead of deleting so their access and the audit trail are kept.');
  }
  await prisma.prediction.delete({ where: { id } });
  await adminLog(req, 'PREDICTION_DELETED', `Deleted prediction #${id} for match #${p.matchId}`, { entityType: 'prediction', entityId: id });
  ok(res, {}, 'Prediction deleted');
}

// ============================================================================= news

export async function listNews(req, res) {
  const q = req.valid.query;
  const { skip, take, meta } = paginate(q, { defaultLimit: 50 });
  const where = {};
  if (q.category && q.category !== 'All') where.category = q.category;
  if (q.status) where.publicationStatus = q.status.toUpperCase();
  if (q.q) where.OR = [{ title: { contains: q.q } }, { description: { contains: q.q } }];
  const [rows, total] = await Promise.all([
    prisma.news.findMany({ where, include: { author: { select: { fullName: true } } }, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.news.count({ where }),
  ]);
  ok(res, { items: rows.map((n) => S.news(n, { full: true })), pagination: meta(total) });
}

function newsData(b, existing) {
  let publishedAt = b.publishedAt ?? existing?.publishedAt ?? null;
  if (b.status === 'PUBLISHED' && !publishedAt) publishedAt = new Date();
  return {
    title: b.title,
    description: b.description,
    content: b.content,
    category: b.category,
    publicationStatus: b.status,
    publishedAt,
    ...(b.featured !== undefined ? { featured: b.featured } : {}),
    ...(b.trending !== undefined ? { trending: b.trending } : {}),
  };
}

export async function createNews(req, res) {
  const b = req.valid.body;
  const n = await prisma.news.create({ data: { ...newsData(b), slug: await uniqueNewsSlug(b.title), image: req.uploadedFile || null, authorId: req.admin.id } });
  await adminLog(req, 'NEWS_CREATED', `${b.status === 'PUBLISHED' ? 'Published' : 'Drafted'} "${n.title}"`, { entityType: 'news', entityId: n.id });
  created(res, { article: S.news(n, { full: true }) }, 'Article saved');
}

export async function updateNews(req, res) {
  const id = req.valid.params.id;
  const b = req.valid.body;
  const before = await prisma.news.findUnique({ where: { id } });
  if (!before) throw ApiError.notFound('Article not found');
  const image = req.uploadedFile ? req.uploadedFile : b.removeImage ? null : undefined;
  const n = await prisma.news.update({
    where: { id },
    data: { ...newsData(b, before), ...(b.title !== before.title ? { slug: await uniqueNewsSlug(b.title, id) } : {}), ...(image !== undefined ? { image } : {}) },
  });
  if (before.image && image !== undefined) await removeUpload(before.image);
  await adminLog(req, 'NEWS_UPDATED', `Edited "${n.title}" (${n.publicationStatus})`, { entityType: 'news', entityId: id });
  ok(res, { article: S.news(n, { full: true }) }, 'Article updated');
}

export async function setNewsStatus(req, res) {
  const id = req.valid.params.id;
  const status = String(req.body?.status || '').toUpperCase();
  if (!['PUBLISHED', 'UNPUBLISHED', 'DRAFT'].includes(status)) throw ApiError.validation([{ field: 'status', message: 'Invalid status' }]);
  const before = await prisma.news.findUnique({ where: { id } });
  if (!before) throw ApiError.notFound('Article not found');
  const n = await prisma.news.update({ where: { id }, data: { publicationStatus: status, ...(status === 'PUBLISHED' && !before.publishedAt ? { publishedAt: new Date() } : {}) } });
  await adminLog(req, `NEWS_${status}`, `Set "${n.title}" to ${status}`, { entityType: 'news', entityId: id });
  ok(res, { article: S.news(n) }, 'Article status updated');
}

export async function deleteNews(req, res) {
  const id = req.valid.params.id;
  const n = await prisma.news.delete({ where: { id } });
  await removeUpload(n.image);
  await adminLog(req, 'NEWS_DELETED', `Deleted "${n.title}"`, { entityType: 'news', entityId: id });
  ok(res, {}, 'Article deleted');
}
