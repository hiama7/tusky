import { describe, expect, it } from 'vitest';
import { strongPick, testedRecord } from '../src/services/strongPickService.js';
import { api, auth, loginAs, makeMatch, makeUser } from './helpers.js';

const report = { cutoff: '2025-07-01', to: '2026-11-23', strong_picks: { threshold: 0.7, matches: 142, share: 0.0627, observed: 0.8169, ci95: [0.75, 0.88] } };
const prediction = { probA: 72, probDraw: 17, probB: 11, source: 'MODEL', isDemo: false };

describe('strong picks', () => {
  it('labels only clear football model favourites, with the measured record', () => {
    expect(strongPick(prediction, 'football', report)).toMatchObject({ won: 82, matches: 142, share: 6 });
    expect(strongPick({ ...prediction, probA: 11, probB: 72 }, 'football', report)).not.toBeNull();
    expect(strongPick({ ...prediction, probA: 69.9 }, 'football', report)).toBeNull();
    expect(strongPick(prediction, 'cricket', report)).toBeNull();
    expect(strongPick({ ...prediction, source: 'MANUAL' }, 'football', report)).toBeNull();
    expect(strongPick({ ...prediction, isDemo: true }, 'football', report)).toBeNull();
  });

  it('gives no label without a matching, large enough measurement', () => {
    expect(testedRecord(null)).toBeNull();
    expect(testedRecord({ ...report, strong_picks: null })).toBeNull();
    expect(testedRecord({ ...report, strong_picks: { ...report.strong_picks, matches: 20 } })).toBeNull();
    expect(testedRecord({ ...report, strong_picks: { ...report.strong_picks, threshold: 0.6 } })).toBeNull();
  });

  it('never reaches a locked viewer', async () => {
    const match = await makeMatch();
    const res = await api().get(`/api/matches/${match.id}/prediction`);
    expect(res.body.data.locked).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('strongPick');
  });

  it('is part of an unlocked prediction, and empty for an analyst prediction', async () => {
    const match = await makeMatch();
    const { token } = await loginAs(await makeUser());
    await api().post('/api/trial/activate').set(auth(token)).send({ matchId: match.id });
    const res = await api().get(`/api/matches/${match.id}/prediction`).set(auth(token));
    expect(res.body.data.locked).toBe(false);
    expect(res.body.data.prediction.strongPick).toBeNull();
  });

  it('is counted on the public track record', async () => {
    const res = await api().get('/api/track-record');
    expect(res.body.data.strongPicks).toMatchObject({ threshold: 70 });
  });
});
