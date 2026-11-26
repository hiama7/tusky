// Shared test helpers: app instance, factories and login helpers.
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/config/database.js';

export const app = createApp();
export { prisma };
export const api = () => request(app);

let seq = 0;
export const uniq = (p = 'x') => `${p}${Date.now().toString(36)}${(seq += 1)}${crypto.randomBytes(2).toString('hex')}`;

export async function makeUser({ role = 'USER', password = 'Passw0rd!x', status = 'ACTIVE' } = {}) {
  const email = `${uniq('u')}@example.com`;
  const user = await prisma.user.create({
    data: { fullName: 'Test Person', email, phone: '9876543210', passwordHash: await bcrypt.hash(password, 4), role, accountStatus: status },
  });
  return { ...user, password };
}

/** Logs in through the real endpoint; returns { token, cookie, user }. */
export async function loginAs(user, scope = 'user') {
  const res = await api().post(scope === 'admin' ? '/api/auth/admin/login' : '/api/auth/login').send({ email: user.email, password: user.password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.data.accessToken, cookie: res.headers['set-cookie'], user: res.body.data.user };
}

export async function makeSport({ outcomeFormat = 'TWO_WAY' } = {}) {
  const name = uniq('Sport');
  return prisma.sport.create({ data: { slug: name.toLowerCase(), name, outcomeFormat } });
}

/** Creates a published match with a published prediction (unless told otherwise). */
export async function makeMatch({ sport, price = '49.00', published = true, predictionStatus = 'PUBLISHED', status = 'UPCOMING', withPrediction = true } = {}) {
  const s = sport || (await makeSport());
  const [a, b] = await Promise.all([
    prisma.team.create({ data: { sportId: s.id, name: uniq('TeamA'), shortName: 'TA' } }),
    prisma.team.create({ data: { sportId: s.id, name: uniq('TeamB'), shortName: 'TB' } }),
  ]);
  const t = await prisma.tournament.create({ data: { sportId: s.id, name: uniq('Cup') } });
  const match = await prisma.match.create({
    data: { sportId: s.id, tournamentId: t.id, teamAId: a.id, teamBId: b.id, startsAt: new Date(Date.now() + 86_400_000), venue: 'Test Ground', predictionPrice: price, published, status },
  });
  if (withPrediction) {
    await prisma.prediction.create({
      data: {
        matchId: match.id, outcomeFormat: s.outcomeFormat, teamAProbability: '61.00', teamBProbability: s.outcomeFormat === 'THREE_WAY' ? '19.00' : '39.00',
        drawProbability: s.outcomeFormat === 'THREE_WAY' ? '20.00' : null, predictedOutcome: 'TEAM_A', confidenceLevel: 'HIGH',
        summary: 'SECRET ANALYSIS TEXT that must never leak to locked viewers.', teamAnalysis: { teamA: { strengths: ['secret strength'], weaknesses: [] }, teamB: { strengths: [], weaknesses: [] } },
        recentForm: { teamA: ['W'], teamB: ['L'] }, playerAnalysis: [{ name: 'Secret Player', team: 'A', stat: 'x', rating: 90 }],
        headToHead: { played: 3, aWins: 2, bWins: 1, draws: 0 }, keyFactors: ['secret factor'], publicationStatus: predictionStatus, version: 1,
      },
    });
  }
  return { ...match, sport: s };
}

export const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** Razorpay checkout signature, computed with the test secret (same algorithm as Razorpay). */
export const checkoutSignature = (orderId, paymentId) =>
  crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

export const webhookSignature = (raw) => crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
