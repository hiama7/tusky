import { describe, expect, it } from 'vitest';
import { outcomeOf, summarise, versionAtStart } from '../src/services/trackRecordService.js';
import { api, makeMatch, makeSport, prisma } from './helpers.js';

const row = (probA, probDraw, probB, predicted, actual) => ({ probA, probDraw, probB, predicted, actual });

describe('judging predictions', () => {
  it('counts hits and misses, compares with always picking the home side, and scores probabilities', () => {
    const s = summarise([row(60, 25, 15, 'TEAM_A', 'TEAM_A'), row(55, 25, 20, 'TEAM_A', 'TEAM_B'), row(20, 25, 55, 'TEAM_B', 'TEAM_B'), row(72, 18, 10, 'TEAM_A', 'DRAW')]);
    expect(s).toMatchObject({ matches: 4, correct: 2, accuracy: 50, homeBaseline: 25 });
    expect(s.brier).toBeGreaterThan(0);
    expect(s.calibration.find((b) => b.band === '70% and over')).toMatchObject({ matches: 1, happened: 0 });
    expect(summarise([])).toMatchObject({ matches: 0, accuracy: null });
    expect(summarise([row(100, 0, 0, 'TEAM_A', 'TEAM_A')]).brier).toBe(0);
  });

  it('uses only what was published before kick-off', () => {
    const start = new Date('2026-11-20T15:00:00Z');
    const v = (version, publishedAt) => ({ version, publishedAt });
    expect(versionAtStart([v(1, '2026-11-18'), v(2, '2026-11-19'), v(3, '2026-11-20T16:00:00Z')], start).version).toBe(2);
    expect(versionAtStart([v(1, '2026-11-21')], start)).toBeNull();
    expect(outcomeOf({ isDraw: false, winningTeamId: 9 }, { teamAId: 1, teamBId: 2 })).toBeNull();
  });
});

describe('public track record', () => {
  it('shows finished matches with their pre-match numbers, misses included', async () => {
    const sport = await makeSport({ outcomeFormat: 'THREE_WAY' });
    const m = await makeMatch({ sport });
    const started = new Date(Date.now() - 2 * 86_400_000);
    const before = new Date(started.getTime() - 3_600_000);
    const snapshot = { probA: 61, probDraw: 20, probB: 19, predictedOutcome: 'TEAM_A' };
    const pred = await prisma.prediction.findUnique({ where: { matchId: m.id } });
    await prisma.predictionVersion.create({ data: { predictionId: pred.id, version: 1, snapshot, publishedAt: before } });
    // a "correction" written after kick-off must not count
    await prisma.predictionVersion.create({ data: { predictionId: pred.id, version: 2, snapshot: { ...snapshot, probA: 5, probB: 75, predictedOutcome: 'TEAM_B' }, publishedAt: new Date() } });
    await prisma.match.update({ where: { id: m.id }, data: { startsAt: started, status: 'COMPLETED' } });

    const get = async () => (await api().get(`/api/track-record?sport=${sport.slug}`)).body.data;
    expect(await get()).toMatchObject({ awaitingResult: 1, summary: { matches: 0 } });

    await prisma.matchResult.create({ data: { matchId: m.id, winningTeamId: m.teamBId, scoreSummary: '0-2', resultDescription: 'B won', matchCompletedAt: new Date() } });
    const data = await get();
    expect(data.summary).toMatchObject({ matches: 1, correct: 0, accuracy: 0 });
    expect(data.items[0]).toMatchObject({ probA: 61, predicted: 'TEAM_A', actual: 'TEAM_B', correct: false, score: '0-2' });
  });

  it('never reveals a match that has not started', async () => {
    const sport = await makeSport({ outcomeFormat: 'THREE_WAY' });
    const m = await makeMatch({ sport });
    const pred = await prisma.prediction.findUnique({ where: { matchId: m.id } });
    await prisma.predictionVersion.create({ data: { predictionId: pred.id, version: 1, snapshot: { probA: 61, probDraw: 20, probB: 19, predictedOutcome: 'TEAM_A' } } });
    const res = await api().get(`/api/track-record?sport=${sport.slug}`);
    expect(res.body.data).toMatchObject({ items: [], awaitingResult: 0 });
    expect(JSON.stringify(res.body)).not.toContain('61');
  });
});
