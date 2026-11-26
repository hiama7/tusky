// =============================================================================
// ML sync: copies the TUSKY ML service's pre-match predictions into PREDICTX.
//
//  * Reads the ML service's Postgres (read-only) and writes MySQL through Prisma.
//  * Only upcoming matches are imported or updated: nothing changes once a match
//    has started, so a stored prediction is always a pre-match one.
//  * An admin's work is never overwritten: a MANUAL prediction, a MANUAL result,
//    an unpublished prediction, and a match's price/published/featured flags stay.
//  * New predictions are DRAFTS unless `publish` is asked for; a live prediction
//    is only changed when `publish` is asked for (as a new, audited version).
//  * Only measured data is written. The model has no player, injury or line-up
//    information, so those sections stay empty rather than being invented.
// =============================================================================
import pg from 'pg';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/apiResponse.js';
import { publishInTx } from './predictionService.js';
import { shortCode } from './slug.js';

const SPORTS = ['football', 'basketball', 'cricket']; // ML sport code = PREDICTX sport slug
const COLORS = ['#386BFF', '#8657FF', '#20D9A0', '#FFB547', '#FF5263', '#38BDF8'];

// ----------------------------------------------------------------------------- pure mapping

/** Percentages with two decimals that total exactly 100 (largest remainder). */
export function toPercentages(probs) {
  const total = probs.reduce((a, b) => a + b, 0);
  if (!(total > 0) || probs.some((p) => !Number.isFinite(p) || p < 0)) throw new Error(`invalid probabilities ${probs}`);
  const exact = probs.map((p) => (p / total) * 10_000);
  const units = exact.map(Math.floor);
  const order = exact.map((v, i) => [v - units[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0, left = 10_000 - units.reduce((a, b) => a + b, 0); k < left; k += 1) units[order[k][1]] += 1;
  return units.map((u) => u / 100);
}

/** A label for how decisive the probabilities are. It is NOT a statement about accuracy. */
export function confidenceFor(maxPercent, threeWay) {
  const [high, medium] = threeWay ? [60, 45] : [70, 58];
  if (maxPercent >= high) return 'HIGH';
  return maxPercent >= medium ? 'MEDIUM' : 'LOW';
}

const pct = (v) => `${Math.round(v * 100)}%`;

/** Turns one ML row into the fields of a PREDICTX Prediction. */
export function toPrediction(row) {
  const threeWay = row.sport === 'football' || row.pDraw >= 0.005;
  const [a, draw, b] = threeWay
    ? toPercentages([row.pHome, row.pDraw, row.pAway])
    : (([x, y]) => [x, null, y])(toPercentages([row.pHome, row.pAway]));
  const best = Math.max(a, b, draw ?? 0);
  const predictedOutcome = best === a ? 'TEAM_A' : best === b ? 'TEAM_B' : 'DRAW';

  const f = row.features || {};
  const d = row.details || {};
  const factors = [];
  if (Number.isFinite(f.h_elo) && Number.isFinite(f.a_elo)) factors.push(`Strength rating (Elo): ${row.home} ${Math.round(f.h_elo)}, ${row.away} ${Math.round(f.a_elo)}.`);
  if (Number.isFinite(f.h_rest) && Number.isFinite(f.a_rest)) factors.push(`Days since the last match: ${row.home} ${Math.round(f.h_rest)}, ${row.away} ${Math.round(f.a_rest)}.`);
  const over = d.over_under?.['2.5']?.over;
  if (Number.isFinite(over)) factors.push(`Model estimate of over 2.5 goals: ${pct(over)}.`);
  if (Number.isFinite(d.btts)) factors.push(`Model estimate that both teams score: ${pct(d.btts)}.`);
  const top = d.top_scores?.[0];
  if (top) factors.push(`Single most likely scoreline: ${top.home}-${top.away} (${pct(top.p)}).`);

  const expected = row.expHome !== null && row.expAway !== null ? ` Expected score: ${row.expHome.toFixed(1)} - ${row.expAway.toFixed(1)}.` : '';
  const summary =
    `Statistical model estimate: ${row.home} ${a}%${threeWay ? `, draw ${draw}%` : ''}, ${row.away} ${b}%.${expected} ` +
    'Based on past results only: the model does not know about injuries, line-ups or team news. Probabilities are not a guarantee of any result.';

  return {
    outcomeFormat: threeWay ? 'THREE_WAY' : 'TWO_WAY',
    teamAProbability: a.toFixed(2),
    teamBProbability: b.toFixed(2),
    drawProbability: threeWay ? draw.toFixed(2) : null,
    predictedOutcome,
    confidenceLevel: confidenceFor(best, threeWay),
    summary,
    teamAnalysis: { teamA: { strengths: [], weaknesses: [] }, teamB: { strengths: [], weaknesses: [] } },
    recentForm: { teamA: row.formHome, teamB: row.formAway },
    playerAnalysis: [],
    headToHead: row.headToHead,
    keyFactors: factors,
    source: 'MODEL',
    modelVersion: String(row.modelVersion).slice(0, 60),
  };
}

// ----------------------------------------------------------------------------- ML database (read-only)

const letter = (mine, theirs) => (mine > theirs ? 'W' : mine < theirs ? 'L' : 'D');

export function postgresSource(url = env.ML_DATABASE_URL) {
  const withClient = async (fn) => {
    if (!url) throw ApiError.badRequest('ML sync is not configured: set ML_DATABASE_URL in the backend .env');
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000, options: '-c default_transaction_read_only=on' });
    try {
      await client.connect();
    } catch (err) {
      throw ApiError.badRequest(`Cannot reach the ML database (${err.code || err.message}). Is it running? docker compose up -d postgres`);
    }
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  };

  return {
    /** Latest stored prediction of every match starting within `days`. */
    upcoming: ({ days }) =>
      withClient(async (client) => {
        const { rows } = await client.query(
          `select distinct on (m.id) m.id, s.code as sport, m.start_time, m.venue, m.city, c.name as competition,
                  m.home_team_id, m.away_team_id, h.name as home, a.name as away,
                  p.model_version, p.p_home, p.p_draw, p.p_away, p.exp_home_score, p.exp_away_score, p.details, p.features
             from predictions p
             join matches m on m.id = p.match_id
             join sports s on s.id = m.sport_id
             join teams h on h.id = m.home_team_id
             join teams a on a.id = m.away_team_id
             left join competitions c on c.id = m.competition_id
            where m.status = 'scheduled' and m.start_time > now() and m.start_time <= now() + make_interval(days => $1)
              and s.code = any($2)
            order by m.id, p.updated_at desc`,
          [days, SPORTS],
        );
        const out = [];
        for (const r of rows) {
          const past = await client.query(
            `select home_team_id, away_team_id, home_score, away_score from matches
              where status = 'completed' and home_score is not null and away_score is not null and start_time < now()
                and (home_team_id in ($1, $2) or away_team_id in ($1, $2))
              order by start_time desc`,
            [r.home_team_id, r.away_team_id],
          );
          const form = (team) =>
            past.rows
              .filter((x) => x.home_team_id === team || x.away_team_id === team)
              .slice(0, 5)
              .map((x) => (x.home_team_id === team ? letter(x.home_score, x.away_score) : letter(x.away_score, x.home_score)))
              .reverse(); // oldest first, newest last
          const h2h = { played: 0, aWins: 0, bWins: 0, draws: 0 };
          for (const x of past.rows) {
            const pair = [x.home_team_id, x.away_team_id];
            if (!pair.includes(r.home_team_id) || !pair.includes(r.away_team_id)) continue;
            const mine = x.home_team_id === r.home_team_id ? [x.home_score, x.away_score] : [x.away_score, x.home_score];
            h2h.played += 1;
            h2h[{ W: 'aWins', L: 'bWins', D: 'draws' }[letter(...mine)]] += 1;
          }
          out.push({
            id: r.id, sport: r.sport, startsAt: r.start_time, venue: [r.venue, r.city].filter(Boolean).join(', ') || null,
            competition: r.competition, home: r.home, away: r.away, modelVersion: r.model_version,
            pHome: r.p_home, pDraw: r.p_draw, pAway: r.p_away, expHome: r.exp_home_score, expAway: r.exp_away_score,
            details: r.details, features: r.features, formHome: form(r.home_team_id), formAway: form(r.away_team_id), headToHead: h2h,
          });
        }
        return out;
      }),

    /** Outcome of previously imported matches (by ML match id). */
    results: (ids) =>
      withClient(async (client) => {
        const { rows } = await client.query(
          'select id, status::text, start_time, home_score, away_score from matches where id = any($1::int[])',
          [ids],
        );
        return rows.map((r) => ({ id: r.id, status: r.status, startsAt: r.start_time, homeScore: r.home_score, awayScore: r.away_score }));
      }),
  };
}

// ----------------------------------------------------------------------------- writing

async function importMatch(db, row, sport) {
  const externalId = `ml:${row.id}`;
  const venue = (row.venue || 'Venue to be confirmed').slice(0, 160);
  const existing = await db.match.findUnique({ where: { externalId }, include: { prediction: true } });
  if (existing) return { match: existing, created: false, venue };

  const name = (row.competition || `${sport.name} fixtures`).slice(0, 120);
  const tournament = await db.tournament.upsert({
    where: { sportId_name_season: { sportId: sport.id, name, season: '' } },
    update: {},
    create: { sportId: sport.id, name },
  });
  const team = (full) => {
    const teamName = full.slice(0, 100);
    return db.team.upsert({
      where: { sportId_name: { sportId: sport.id, name: teamName } },
      update: {},
      create: { sportId: sport.id, name: teamName, shortName: shortCode(teamName).slice(0, 5), color: COLORS[teamName.length % COLORS.length] },
    });
  };
  const [teamA, teamB] = [await team(row.home), await team(row.away)];
  const match = await db.match.create({
    data: {
      externalId, sportId: sport.id, tournamentId: tournament.id, teamAId: teamA.id, teamBId: teamB.id,
      startsAt: row.startsAt, venue, predictionPrice: env.ML_PREDICTION_PRICE.toFixed(2), published: false,
    },
    include: { prediction: true },
  });
  return { match, created: true, venue };
}

const comparable = (p) =>
  JSON.stringify([
    p.outcomeFormat, Number(p.teamAProbability), Number(p.teamBProbability), p.drawProbability === null ? null : Number(p.drawProbability),
    p.modelVersion, p.recentForm?.teamA, p.recentForm?.teamB, p.headToHead?.played, p.headToHead?.aWins, p.headToHead?.bWins,
  ]);

async function syncOne(row, sport, publish, adminId, stats) {
  await prisma.$transaction(async (db) => {
    const { match, created, venue } = await importMatch(db, row, sport);
    if (created) stats.matchesCreated += 1;
    else if (match.archivedAt) {
      stats.skippedArchived += 1;
      return;
    } else if (new Date(match.startsAt).getTime() !== new Date(row.startsAt).getTime() || (row.venue && match.venue !== venue)) {
      await db.match.update({ where: { id: match.id }, data: { startsAt: row.startsAt, ...(row.venue ? { venue } : {}) } });
      stats.matchesRescheduled += 1;
    }
    // Publishing a prediction is pointless if the match itself stays hidden.
    if (publish && !match.published) await db.match.update({ where: { id: match.id }, data: { published: true } });

    const data = toPrediction(row);
    const current = match.prediction;
    if (!current) {
      const p = await db.prediction.create({ data: { matchId: match.id, ...data } });
      stats.predictionsCreated += 1;
      if (publish) {
        await publishInTx(db, p.id, adminId);
        stats.published += 1;
      }
      return;
    }
    if (current.source !== 'MODEL') {
      stats.keptManual += 1;
      return;
    }
    const changed = comparable(current) !== comparable(data);
    if (current.publicationStatus === 'PUBLISHED') {
      if (!changed) stats.unchanged += 1;
      else if (!publish) stats.liveNotUpdated += 1;
      else {
        await db.prediction.update({ where: { id: current.id }, data });
        await publishInTx(db, current.id, adminId);
        stats.predictionsUpdated += 1;
        stats.published += 1;
      }
      return;
    }
    if (changed) {
      await db.prediction.update({ where: { id: current.id }, data });
      stats.predictionsUpdated += 1;
    } else stats.unchanged += 1;
    // A prediction an admin took down (UNPUBLISHED) is not put back by a sync.
    if (publish && current.publicationStatus === 'DRAFT') {
      await publishInTx(db, current.id, adminId);
      stats.published += 1;
    }
  });
}

/** Marks imported matches finished/cancelled/postponed from the ML database. */
async function syncResults(source, stats) {
  const open = await prisma.match.findMany({
    where: { externalId: { startsWith: 'ml:' }, status: { in: ['UPCOMING', 'LIVE', 'POSTPONED'] }, startsAt: { lte: new Date() } },
    include: { result: true },
  });
  if (!open.length) return;
  const byId = new Map((await source.results(open.map((m) => Number(m.externalId.slice(3))))).map((r) => [r.id, r]));
  for (const m of open) {
    const r = byId.get(Number(m.externalId.slice(3)));
    if (!r || m.result?.source === 'MANUAL') continue;
    if (r.status === 'cancelled' || r.status === 'postponed') {
      await prisma.match.update({ where: { id: m.id }, data: { status: r.status.toUpperCase() } });
      continue;
    }
    if (r.status !== 'completed' || r.homeScore === null || r.awayScore === null) continue;
    const winningTeamId = r.homeScore > r.awayScore ? m.teamAId : r.awayScore > r.homeScore ? m.teamBId : null;
    const data = {
      winningTeamId,
      isDraw: winningTeamId === null,
      scoreSummary: `${r.homeScore}-${r.awayScore}`,
      resultDescription: winningTeamId === null ? `Match drawn ${r.homeScore}-${r.awayScore}` : `${winningTeamId === m.teamAId ? 'Home' : 'Away'} side won ${r.homeScore}-${r.awayScore}`,
      matchCompletedAt: new Date(r.startsAt),
      source: 'PROVIDER',
    };
    await prisma.$transaction([
      prisma.matchResult.upsert({ where: { matchId: m.id }, update: data, create: { matchId: m.id, ...data } }),
      prisma.match.update({ where: { id: m.id }, data: { status: 'COMPLETED' } }),
    ]);
    stats.resultsRecorded += 1;
  }
}

export async function syncMlPredictions({ publish = false, days = env.ML_SYNC_DAYS, adminId = null, source = postgresSource() } = {}) {
  const stats = {
    found: 0, matchesCreated: 0, matchesRescheduled: 0, predictionsCreated: 0, predictionsUpdated: 0, published: 0, unchanged: 0,
    liveNotUpdated: 0, keptManual: 0, skippedArchived: 0, skippedNoSport: 0, skippedStarted: 0, failed: 0, resultsRecorded: 0,
  };
  const rows = await source.upcoming({ days });
  stats.found = rows.length;
  const sports = new Map((await prisma.sport.findMany({ where: { slug: { in: SPORTS } } })).map((s) => [s.slug, s]));
  const errors = [];
  for (const row of rows) {
    const sport = sports.get(row.sport);
    if (!sport) stats.skippedNoSport += 1;
    else if (new Date(row.startsAt) <= new Date()) stats.skippedStarted += 1;
    else {
      try {
        await syncOne(row, sport, publish, adminId, stats);
      } catch (err) {
        stats.failed += 1; // one bad row must not stop the rest
        if (errors.length < 5) errors.push(`ml:${row.id} ${row.home} v ${row.away}: ${err.message.split('\n').pop()}`);
      }
    }
  }
  await syncResults(source, stats);
  return { ...stats, errors };
}
