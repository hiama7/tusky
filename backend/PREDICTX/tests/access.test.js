// Prediction access control + free trial.
import { describe, expect, it } from 'vitest';
import { api, auth, loginAs, makeMatch, makeUser, prisma } from './helpers.js';

const LEAK = /SECRET|probA|teamAProbability|summary|confidence|predictedOutcome|insights|players/;

describe('locked prediction data never leaves the server', () => {
  it('anonymous and non-entitled users only get { locked, price, available }', async () => {
    const m = await makeMatch({ price: '59.00' });
    const anon = await api().get(`/api/matches/${m.id}/prediction`);
    expect(anon.status).toBe(200);
    expect(anon.body.data).toEqual({ locked: true, matchId: m.id, price: 59, available: true });
    expect(JSON.stringify(anon.body)).not.toMatch(LEAK);

    const u = await makeUser();
    const { token } = await loginAs(u);
    const res = await api().get(`/api/predictions/${m.id}`).set(auth(token));
    expect(res.body.data.locked).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(LEAK);
  });

  it('list endpoints include no prediction content for locked matches', async () => {
    await makeMatch();
    const u = await makeUser();
    const { token } = await loginAs(u);
    const list = await api().get('/api/predictions?limit=100').set(auth(token));
    expect(list.status).toBe(200);
    for (const item of list.body.data.items) {
      expect(item.unlocked).toBe(false);
      expect(item.preview).toBeNull();
    }
    expect(JSON.stringify(list.body)).not.toMatch(/SECRET/);
    const matches = await api().get('/api/matches?limit=100');
    expect(JSON.stringify(matches.body)).not.toMatch(/SECRET|teamAProbability/);
  });

  it('unpublished matches and draft predictions are hidden', async () => {
    const hidden = await makeMatch({ published: false });
    expect((await api().get(`/api/matches/${hidden.id}`)).status).toBe(404);
    expect((await api().get(`/api/matches/${hidden.id}/prediction`)).status).toBe(404);
    const draft = await makeMatch({ predictionStatus: 'DRAFT' });
    const res = await api().get(`/api/matches/${draft.id}/prediction`);
    expect(res.body.data).toMatchObject({ locked: true, available: false });
  });
});

describe('free trial', () => {
  it('unlocks exactly the chosen match, once', async () => {
    const [m1, m2] = [await makeMatch(), await makeMatch()];
    const u = await makeUser();
    const { token } = await loginAs(u);
    expect((await api().get('/api/trial/status').set(auth(token))).body.data.status).toBe('available');

    const act = await api().post('/api/trial/activate').set(auth(token)).send({ matchId: m1.id });
    expect(act.status).toBe(201);

    const p1 = await api().get(`/api/matches/${m1.id}/prediction`).set(auth(token));
    expect(p1.body.data.locked).toBe(false);
    expect(p1.body.data.unlockReason).toBe('trial');
    expect(p1.body.data.prediction.probA).toBe(61);

    const p2 = await api().get(`/api/matches/${m2.id}/prediction`).set(auth(token));
    expect(p2.body.data.locked).toBe(true);

    const again = await api().post('/api/trial/activate').set(auth(token)).send({ matchId: m2.id });
    expect(again.status).toBe(409);
    // a new login session does not reset the trial
    const { token: t2 } = await loginAs(u);
    expect((await api().get('/api/trial/status').set(auth(t2))).body.data.status).toBe('used');
  });

  it('concurrent activation requests create only one trial', async () => {
    const matches = await Promise.all([makeMatch(), makeMatch(), makeMatch(), makeMatch(), makeMatch()]);
    const u = await makeUser();
    const { token } = await loginAs(u);
    const results = await Promise.all(matches.map((m) => api().post('/api/trial/activate').set(auth(token)).send({ matchId: m.id })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);
    expect(await prisma.freeTrial.count({ where: { userId: u.id } })).toBe(1);
  });

  it('cannot be used on a match without a published prediction or on a completed match', async () => {
    const u = await makeUser();
    const { token } = await loginAs(u);
    const draft = await makeMatch({ predictionStatus: 'DRAFT' });
    expect((await api().post('/api/trial/activate').set(auth(token)).send({ matchId: draft.id })).status).toBe(400);
    const done = await makeMatch({ status: 'COMPLETED' });
    expect((await api().post('/api/trial/activate').set(auth(token)).send({ matchId: done.id })).status).toBe(400);
  });
});

describe('input safety', () => {
  it('treats SQL-injection-looking input as plain text', async () => {
    const res = await api().get(`/api/matches?q=${encodeURIComponent("' OR 1=1; DROP TABLE users; --")}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(0);
    expect(await prisma.user.count()).toBeGreaterThan(0);
    expect((await api().get('/api/matches/1%20OR%201=1')).status).toBe(422);
  });

  it('returns 400 for malformed JSON and 404 JSON for unknown routes', async () => {
    const bad = await api().post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(bad.status).toBe(400);
    const nf = await api().get('/api/does-not-exist');
    expect(nf.status).toBe(404);
    expect(nf.body.success).toBe(false);
  });
});
