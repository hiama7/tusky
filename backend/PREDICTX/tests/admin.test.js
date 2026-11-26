// Admin management tests: catalogue, matches, predictions (validation + versions),
// news with secure uploads, users, analytics and the audit log.
import { beforeAll, describe, expect, it } from 'vitest';
import { api, auth, loginAs, makeMatch, makeSport, makeUser, prisma, uniq } from './helpers.js';

// 1×1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

let token;
let admin;
beforeAll(async () => {
  admin = await makeUser({ role: 'ADMIN' });
  ({ token } = await loginAs(admin, 'admin'));
});

describe('catalogue and matches', () => {
  it('adds a sport, teams, a tournament and a match, then publishes it', async () => {
    const sport = await api().post('/api/admin/sports').set(auth(token)).send({ name: uniq('Kabaddi'), outcomeFormat: 'TWO_WAY', color: '#20D9A0' });
    expect(sport.status).toBe(201);
    const sportId = sport.body.data.sport.dbId;
    const ta = await api().post('/api/admin/teams').set(auth(token)).send({ sportId, name: uniq('Raiders') });
    const tb = await api().post('/api/admin/teams').set(auth(token)).send({ sportId, name: uniq('Panthers') });
    const tour = await api().post('/api/admin/tournaments').set(auth(token)).send({ sportId, name: uniq('League'), season: '2026' });
    expect([ta.status, tb.status, tour.status]).toEqual([201, 201, 201]);

    const m = await api().post('/api/admin/matches').set(auth(token)).send({
      sportId, tournamentId: tour.body.data.tournament.id, teamAId: ta.body.data.team.id, teamBId: tb.body.data.team.id,
      startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), venue: 'Indoor Arena', predictionPrice: 29,
    });
    expect(m.status).toBe(201);
    expect(m.body.data.match.published).toBe(false);
    const id = m.body.data.match.id;
    expect((await api().get(`/api/matches/${id}`)).status).toBe(404); // drafts are not public

    const pub = await api().patch(`/api/admin/matches/${id}`).set(auth(token)).send({ published: true, predictionPrice: 35 });
    expect(pub.status).toBe(200);
    const pubView = await api().get(`/api/matches/${id}`);
    expect(pubView.status).toBe(200);
    expect(pubView.body.data.match.price).toBe(35);
  });

  it('creates teams and tournaments by name, and rejects identical teams', async () => {
    const s = await makeSport();
    const ok = await api().post('/api/admin/matches').set(auth(token)).send({ sportId: s.id, tournamentName: 'Named Cup', teamAName: 'Alpha Club', teamBName: 'Beta Club', startsAt: new Date(Date.now() + 86_400_000).toISOString(), venue: 'Ground', predictionPrice: '19.50', published: 'true' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.match.price).toBe(19.5);
    const same = await api().post('/api/admin/matches').set(auth(token)).send({ sportId: s.id, tournamentName: 'Named Cup', teamAName: 'Alpha Club', teamBName: 'Alpha Club', startsAt: new Date().toISOString(), venue: 'Ground', predictionPrice: 10 });
    expect(same.status).toBe(422);
  });

  it('archives instead of deleting a match with purchases', async () => {
    const m = await makeMatch();
    const u = await makeUser();
    const txn = await prisma.transaction.create({ data: { transactionReference: uniq('PX'), userId: u.id, transactionType: 'PREDICTION', amount: '49.00', paymentStatus: 'CAPTURED', matchId: m.id, capturedAt: new Date() } });
    await prisma.purchase.create({ data: { userId: u.id, matchId: m.id, transactionId: txn.id, amount: '49.00' } });
    const del = await api().delete(`/api/admin/matches/${m.id}`).set(auth(token));
    expect(del.body.data.archived).toBe(true);
    expect((await prisma.match.findUnique({ where: { id: m.id } })).archivedAt).not.toBeNull();
    const plain = await makeMatch({ withPrediction: false });
    expect((await api().delete(`/api/admin/matches/${plain.id}`).set(auth(token))).body.data.deleted).toBe(true);
  });
});

describe('predictions', () => {
  const body = (matchId, extra = {}) => ({
    matchId, teamAProbability: 55, teamBProbability: 45, confidenceLevel: 'MEDIUM',
    summary: 'Team A have the stronger recent form in this sample analysis.', keyFactors: ['Home crowd'], ...extra,
  });

  it('validates that probabilities total 100 for the outcome format', async () => {
    const two = await makeMatch({ withPrediction: false });
    expect((await api().post('/api/admin/predictions').set(auth(token)).send(body(two.id, { teamBProbability: 40 }))).status).toBe(422);
    expect((await api().post('/api/admin/predictions').set(auth(token)).send(body(two.id, { drawProbability: 10, teamAProbability: 50, teamBProbability: 40 }))).status).toBe(422);
    expect((await api().post('/api/admin/predictions').set(auth(token)).send(body(two.id, { predictedOutcome: 'DRAW' }))).status).toBe(422);

    const three = await makeMatch({ sport: await makeSport({ outcomeFormat: 'THREE_WAY' }), withPrediction: false });
    expect((await api().post('/api/admin/predictions').set(auth(token)).send(body(three.id))).status).toBe(422); // missing draw share
    const ok3 = await api().post('/api/admin/predictions').set(auth(token)).send(body(three.id, { teamAProbability: 45, teamBProbability: 30, drawProbability: 25 }));
    expect(ok3.status).toBe(201);
    expect(ok3.body.data.prediction.predictedOutcome).toBe('TEAM_A');
  });

  it('saves drafts, publishes with versions, and keeps history when a live prediction is edited', async () => {
    const m = await makeMatch({ withPrediction: false });
    const draft = await api().post('/api/admin/predictions').set(auth(token)).send(body(m.id));
    expect(draft.status).toBe(201);
    expect(draft.body.data.prediction.status).toBe('DRAFT');
    const id = draft.body.data.prediction.id;
    expect((await api().get(`/api/matches/${m.id}/prediction`)).body.data.available).toBe(false);

    const pub = await api().post(`/api/admin/predictions/${id}/publish`).set(auth(token));
    expect(pub.body.data.prediction.version).toBe(1);
    expect((await api().get(`/api/matches/${m.id}/prediction`)).body.data.available).toBe(true);

    const edit = await api().put(`/api/admin/predictions/${id}`).set(auth(token)).send(body(m.id, { teamAProbability: 70, teamBProbability: 30 }));
    expect(edit.body.data.prediction.version).toBe(2);
    const versions = await prisma.predictionVersion.findMany({ where: { predictionId: id }, orderBy: { version: 'asc' } });
    expect(versions.map((v) => v.snapshot.probA)).toEqual([55, 70]);

    await api().post(`/api/admin/predictions/${id}/unpublish`).set(auth(token));
    expect((await api().get(`/api/matches/${m.id}/prediction`)).body.data.available).toBe(false);
  });
});

describe('news and uploads', () => {
  it('publishes an article with a validated image and lists it publicly', async () => {
    const title = `Sample headline ${uniq()}`;
    const res = await api().post('/api/admin/news').set(auth(token))
      .field('title', title).field('description', 'A sample summary that is long enough.').field('content', 'Body text for the sample article, long enough to pass validation rules.')
      .field('category', 'Cricket').field('status', 'PUBLISHED').attach('image', PNG, 'photo.png');
    expect(res.status).toBe(201);
    expect(res.body.data.article.image).toMatch(/^\/uploads\/news\/[0-9a-f-]+\.png$/);
    const img = await api().get(res.body.data.article.image);
    expect(img.status).toBe(200);
    const pub = await api().get(`/api/news?q=${encodeURIComponent(title)}`);
    expect(pub.body.data.items[0].title).toBe(title);
  });

  it('rejects files that are not real images, whatever their name says', async () => {
    const res = await api().post('/api/admin/news').set(auth(token))
      .field('title', 'Malicious upload attempt').field('description', 'A sample summary that is long enough.').field('content', 'Body text for the sample article, long enough to pass validation rules.')
      .field('category', 'Cricket').attach('image', Buffer.from('<?php system($_GET["c"]); ?>'), { filename: 'shell.png', contentType: 'image/png' });
    expect(res.status).toBe(422);
  });

  it('keeps scheduled articles hidden until their publish time', async () => {
    const title = `Scheduled story ${uniq()}`;
    await api().post('/api/admin/news').set(auth(token)).send({ title, description: 'A sample summary that is long enough.', content: 'Body text for the sample article, long enough to pass validation rules.', category: 'Football', status: 'PUBLISHED', publishedAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect((await api().get(`/api/news?q=${encodeURIComponent(title)}`)).body.data.items).toHaveLength(0);
  });
});

describe('users, analytics and audit', () => {
  it('lists, inspects, blocks and unblocks users', async () => {
    const u = await makeUser();
    const { token: userToken } = await loginAs(u);
    const list = await api().get(`/api/admin/users?q=${encodeURIComponent(u.email)}`).set(auth(token));
    expect(list.body.data.items).toHaveLength(1);
    expect((await api().get(`/api/admin/users/${u.id}`).set(auth(token))).body.data.user.email).toBe(u.email);

    expect((await api().patch(`/api/admin/users/${u.id}/status`).set(auth(token)).send({ status: 'BLOCKED' })).status).toBe(200);
    expect((await api().get('/api/auth/me').set(auth(userToken))).status).toBe(403);
    expect((await api().patch(`/api/admin/users/${u.id}/status`).set(auth(token)).send({ status: 'ACTIVE' })).status).toBe(200);
    expect((await api().post('/api/auth/login').send({ email: u.email, password: u.password })).status).toBe(200);
    expect((await api().patch(`/api/admin/users/${admin.id}/status`).set(auth(token)).send({ status: 'BLOCKED' })).status).toBe(400);
  });

  it('serves revenue analytics for every range', async () => {
    for (const range of ['today', '7d', '30d', '90d', '12w', '12m', '5y']) {
      const res = await api().get(`/api/admin/analytics/revenue?range=${range}`).set(auth(token));
      expect(res.status).toBe(200);
      expect(res.body.data.labels.length).toBe(res.body.data.net.length);
    }
    const overview = await api().get('/api/admin/analytics/overview').set(auth(token));
    expect(overview.status).toBe(200);
    expect(overview.body.data.predictionPerformance).toHaveProperty('evaluated');
  });

  it('records admin actions in the audit log', async () => {
    const logs = await api().get('/api/admin/logs').set(auth(token));
    const actions = logs.body.data.items.map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['SPORT_CREATED', 'MATCH_CREATED', 'PREDICTION_PUBLISHED', 'NEWS_CREATED', 'USER_BLOCKED']));
  });
});
