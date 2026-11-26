import { beforeAll, describe, expect, it } from 'vitest';
import { confidenceFor, syncMlPredictions, toPercentages, toPrediction } from '../src/services/mlSyncService.js';
import { api, auth, loginAs, makeUser, prisma, uniq } from './helpers.js';

const base = 100_000_000 + Math.floor(Math.random() * 800_000_000); // unique ML ids per run
let seq = 0;

function row(over = {}) {
  seq += 1;
  return {
    id: base + seq, sport: 'football', startsAt: new Date(Date.now() + 3 * 86_400_000), venue: null, competition: uniq('League'),
    home: uniq('Home'), away: uniq('Away'), modelVersion: 'football-glm-test', pHome: 0.4567, pDraw: 0.2561, pAway: 0.2872,
    expHome: 1.52, expAway: 1.11, details: { btts: 0.56, over_under: { 2.5: { over: 0.57 } }, top_scores: [{ home: 1, away: 1, p: 0.11 }] },
    features: { h_elo: 1500.4, a_elo: 1427.9, h_rest: 5.1, a_rest: 6.2 }, formHome: ['W', 'D', 'L'], formAway: ['L', 'L', 'W'],
    headToHead: { played: 2, aWins: 1, bWins: 0, draws: 1 }, ...over,
  };
}
const source = (rows, results = []) => ({ upcoming: async () => rows, results: async () => results });
const find = (r) => prisma.match.findUnique({ where: { externalId: `ml:${r.id}` }, include: { prediction: { include: { versions: true } }, result: true } });

beforeAll(async () => {
  await prisma.sport.upsert({ where: { slug: 'football' }, update: {}, create: { slug: 'football', name: 'Football', outcomeFormat: 'THREE_WAY' } });
});

describe('mapping', () => {
  it('percentages always total exactly 100', () => {
    for (const p of [[1 / 3, 1 / 3, 1 / 3], [0.4567, 0.2561, 0.2872], [0.005, 0.99, 0.005], [2, 1]]) {
      expect(toPercentages(p).reduce((a, b) => a + Math.round(b * 100), 0)).toBe(10_000);
    }
    expect(() => toPercentages([0, 0])).toThrow();
    expect(() => toPercentages([NaN, 1])).toThrow();
  });

  it('writes only measured data and labels how decisive the numbers are', () => {
    const p = toPrediction(row({ home: 'Alpha', away: 'Beta' }));
    expect(p).toMatchObject({ outcomeFormat: 'THREE_WAY', teamAProbability: '45.67', drawProbability: '25.61', teamBProbability: '28.72', predictedOutcome: 'TEAM_A', confidenceLevel: 'MEDIUM', source: 'MODEL' });
    expect(p.playerAnalysis).toEqual([]);
    expect(p.teamAnalysis.teamA.strengths).toEqual([]);
    expect(p.summary).toContain('does not know about injuries');
    expect(p.keyFactors[0]).toContain('Alpha 1500');
    const two = toPrediction(row({ sport: 'basketball', pHome: 0.72, pDraw: 0, pAway: 0.28, details: {}, features: null }));
    expect(two).toMatchObject({ outcomeFormat: 'TWO_WAY', drawProbability: null, confidenceLevel: 'HIGH', keyFactors: [] });
    expect([confidenceFor(61, true), confidenceFor(45, true), confidenceFor(44, true)]).toEqual(['HIGH', 'MEDIUM', 'LOW']);
  });
});

describe('sync', () => {
  it('imports drafts once, publishes only when asked, and versions later changes', async () => {
    const r = row();
    const first = await syncMlPredictions({ source: source([r]) });
    expect(first).toMatchObject({ matchesCreated: 1, predictionsCreated: 1, published: 0, failed: 0 });
    let m = await find(r);
    expect(m.published).toBe(false);
    expect(m.prediction.publicationStatus).toBe('DRAFT');
    expect((await api().get(`/api/matches/${m.id}`)).status).toBe(404);

    expect(await syncMlPredictions({ source: source([r]) })).toMatchObject({ matchesCreated: 0, predictionsCreated: 0, unchanged: 1 });

    expect(await syncMlPredictions({ source: source([r]), publish: true })).toMatchObject({ published: 1, matchesCreated: 0 });
    m = await find(r);
    expect(m.published).toBe(true);
    expect(m.prediction).toMatchObject({ publicationStatus: 'PUBLISHED', version: 1 });

    // a viewer without an entitlement gets no probabilities
    const preview = await api().get(`/api/matches/${m.id}/prediction`);
    expect(JSON.stringify(preview.body)).not.toContain('45.67');

    const moved = { ...r, pHome: 0.5, pDraw: 0.25, pAway: 0.25 };
    expect(await syncMlPredictions({ source: source([moved]) })).toMatchObject({ liveNotUpdated: 1 });
    expect(Number((await find(r)).prediction.teamAProbability)).toBe(45.67);
    expect(await syncMlPredictions({ source: source([moved]), publish: true })).toMatchObject({ predictionsUpdated: 1 });
    m = await find(r);
    expect(Number(m.prediction.teamAProbability)).toBe(50);
    expect(m.prediction.versions.map((v) => v.version).sort()).toEqual([1, 2]);
  });

  it('never overwrites an admin: manual predictions, prices and unpublished ones stay', async () => {
    const manual = row();
    const down = row();
    await syncMlPredictions({ source: source([manual, down]), publish: true });
    const a = await find(manual);
    const b = await find(down);
    await prisma.prediction.update({ where: { id: a.prediction.id }, data: { source: 'MANUAL', teamAProbability: '10.00' } });
    await prisma.prediction.update({ where: { id: b.prediction.id }, data: { publicationStatus: 'UNPUBLISHED' } });
    await prisma.match.update({ where: { id: a.id }, data: { predictionPrice: '99.00' } });

    const stats = await syncMlPredictions({ source: source([manual, down]), publish: true });
    expect(stats).toMatchObject({ keptManual: 1, published: 0 });
    expect(Number((await find(manual)).prediction.teamAProbability)).toBe(10);
    expect(Number((await find(manual)).predictionPrice)).toBe(99);
    expect((await find(down)).prediction.publicationStatus).toBe('UNPUBLISHED');
  });

  it('does not import a match that has started, and records an imported match’s result later', async () => {
    const late = row({ startsAt: new Date(Date.now() - 3_600_000) });
    expect(await syncMlPredictions({ source: source([late]) })).toMatchObject({ skippedStarted: 1, matchesCreated: 0 });

    const r = row();
    await syncMlPredictions({ source: source([r]), publish: true });
    const m = await find(r);
    await prisma.match.update({ where: { id: m.id }, data: { startsAt: new Date(Date.now() - 7_200_000) } });
    await syncMlPredictions({ source: source([], [{ id: r.id, status: 'completed', startsAt: new Date(), homeScore: 1, awayScore: 1 }]) });
    const done = await find(r);
    expect(done.status).toBe('COMPLETED');
    expect(done.result).toMatchObject({ isDraw: true, winningTeamId: null, scoreSummary: '1-1', source: 'PROVIDER' });
  });

  it('one bad row is reported, rolled back, and does not stop the others', async () => {
    const bad = row({ pHome: 0, pDraw: 0, pAway: 0 });
    const good = row();
    const stats = await syncMlPredictions({ source: source([bad, good]) });
    expect(stats).toMatchObject({ failed: 1, predictionsCreated: 1 });
    expect(stats.errors[0]).toContain(`ml:${bad.id}`);
    expect(await find(bad)).toBeNull();
  });

  it('the endpoint is admin-only and explains when ML is not configured', async () => {
    expect((await api().post('/api/admin/integrations/ml/sync').send({})).status).toBe(401);
    const admin = await loginAs(await makeUser({ role: 'ADMIN' }), 'admin');
    const res = await api().post('/api/admin/integrations/ml/sync').set(auth(admin.token)).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('ML_DATABASE_URL');
  });
});
