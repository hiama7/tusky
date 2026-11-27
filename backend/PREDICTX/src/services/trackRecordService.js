// Public track record: what was published before each match, against what happened.
//
// Nothing here can be tuned after the fact. For every finished match it takes the
// last version published BEFORE kick-off (an immutable snapshot), whether or not
// the prediction was later changed, unpublished or the match archived. Misses
// are counted exactly like hits.
import { prisma } from '../config/database.js';

const OUTCOMES = ['TEAM_A', 'DRAW', 'TEAM_B'];
const BANDS = [[0, 40, 'under 40%'], [40, 50, '40–50%'], [50, 60, '50–60%'], [60, 70, '60–70%'], [70, 101, '70% and over']];

export function outcomeOf(result, match) {
  if (result.isDraw) return 'DRAW';
  if (result.winningTeamId === match.teamAId) return 'TEAM_A';
  return result.winningTeamId === match.teamBId ? 'TEAM_B' : null; // abandoned or no result
}

/** The snapshot that was live at kick-off, or null if nothing was published in time. */
export function versionAtStart(versions, startsAt) {
  return versions
    .filter((v) => new Date(v.publishedAt) < new Date(startsAt))
    .sort((a, b) => b.version - a.version)[0] || null;
}

/** rows: [{ probA, probDraw, probB, predicted, actual }] with probabilities in percent. */
export function summarise(rows) {
  if (!rows.length) return { matches: 0, correct: 0, accuracy: null, homeBaseline: null, brier: null, calibration: [] };
  const share = (n) => Math.round((n / rows.length) * 1000) / 10;
  const correct = rows.filter((r) => r.predicted === r.actual).length;
  const brier = rows.reduce((total, r) => total + OUTCOMES.reduce((s, o) => {
    const p = ({ TEAM_A: r.probA, DRAW: r.probDraw ?? 0, TEAM_B: r.probB }[o]) / 100;
    return s + (p - (r.actual === o ? 1 : 0)) ** 2;
  }, 0), 0) / rows.length;
  const calibration = BANDS.map(([low, high, label]) => {
    const inBand = rows.map((r) => ({ top: Math.max(r.probA, r.probB, r.probDraw ?? 0), hit: r.predicted === r.actual })).filter((r) => r.top >= low && r.top < high);
    return inBand.length ? {
      band: label,
      matches: inBand.length,
      predicted: Math.round(inBand.reduce((s, r) => s + r.top, 0) / inBand.length),
      happened: Math.round((inBand.filter((r) => r.hit).length / inBand.length) * 100),
    } : null;
  }).filter(Boolean);
  return {
    matches: rows.length,
    correct,
    accuracy: share(correct),
    homeBaseline: share(rows.filter((r) => r.actual === 'TEAM_A').length),
    brier: Math.round(brier * 1000) / 1000,
    calibration,
  };
}

export async function trackRecord({ sport, limit = 50 } = {}) {
  const matches = await prisma.match.findMany({
    where: {
      isDemo: false,
      startsAt: { lt: new Date() },
      status: { not: 'CANCELLED' },
      prediction: { versions: { some: {} } },
      ...(sport ? { sport: { slug: sport } } : {}),
    },
    include: { sport: true, tournament: true, teamA: true, teamB: true, result: true, prediction: { include: { versions: true } } },
    orderBy: { startsAt: 'desc' },
  });

  const rows = [];
  let awaiting = 0;
  for (const m of matches) {
    const version = versionAtStart(m.prediction.versions, m.startsAt);
    if (!version) continue; // published after kick-off: never counted
    const actual = m.result ? outcomeOf(m.result, m) : null;
    if (!actual) {
      if (!m.result) awaiting += 1;
      continue;
    }
    const s = version.snapshot;
    rows.push({
      matchId: m.id,
      startsAt: m.startsAt,
      sport: m.sport.name,
      tournament: m.tournament.name,
      teamA: m.teamA.name,
      teamB: m.teamB.name,
      score: m.result.scoreSummary,
      probA: Number(s.probA),
      probDraw: s.probDraw === null || s.probDraw === undefined ? null : Number(s.probDraw),
      probB: Number(s.probB),
      predicted: s.predictedOutcome,
      actual,
      correct: s.predictedOutcome === actual,
      publishedAt: version.publishedAt,
    });
  }
  return { summary: summarise(rows), awaitingResult: awaiting, items: rows.slice(0, limit) };
}
