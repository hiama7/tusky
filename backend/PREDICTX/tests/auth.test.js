// Authentication & authorization tests.
import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { api, auth, loginAs, makeUser, prisma, uniq } from './helpers.js';
import { sentMail } from '../src/services/emailService.js';

const cookieValue = (setCookie, name) => (setCookie || []).find((c) => c.startsWith(`${name}=`))?.split(';')[0];

describe('registration', () => {
  it('validates every field and returns 422 with field errors', async () => {
    const res = await api().post('/api/auth/register').send({ fullName: 'A', email: 'bad', phone: '123', password: 'short', confirmPassword: 'x' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    const fields = res.body.errors.map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['fullName', 'email', 'phone', 'password']));
  });

  it('creates a USER even if the client sends role=ADMIN, and never returns the hash', async () => {
    const email = `${uniq('r')}@example.com`;
    const res = await api().post('/api/auth/register').send({ fullName: 'New Fan', email, phone: '9876501234', password: 'Testpass123', confirmPassword: 'Testpass123', role: 'ADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('USER');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
    const row = await prisma.user.findUnique({ where: { email } });
    expect(row.role).toBe('USER');
    expect(row.passwordHash).not.toBe('Testpass123');
  });

  it('rejects a duplicate email with 409', async () => {
    const u = await makeUser();
    const res = await api().post('/api/auth/register').send({ fullName: 'Dup User', email: u.email, phone: '9876501234', password: 'Testpass123', confirmPassword: 'Testpass123' });
    expect(res.status).toBe(409);
  });
});

describe('login, refresh and logout', () => {
  it('rejects wrong passwords with a generic 401', async () => {
    const u = await makeUser();
    const res = await api().post('/api/auth/login').send({ email: u.email, password: 'wrong-password1' });
    expect(res.status).toBe(401);
    const res2 = await api().post('/api/auth/login').send({ email: 'nobody@example.com', password: 'wrong-password1' });
    expect(res2.body.message).toBe(res.body.message);
  });

  it('logs in, sets an httpOnly strict refresh cookie and returns a usable access token', async () => {
    const u = await makeUser();
    const res = await api().post('/api/auth/login').send({ email: u.email, password: u.password });
    expect(res.status).toBe(200);
    const cookie = res.headers['set-cookie'].join(';');
    expect(cookie).toMatch(/px_rt=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    const me = await api().get('/api/auth/me').set(auth(res.body.data.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(u.email);
  });

  it('rotates refresh tokens and revokes the family when an old token is replayed', async () => {
    const u = await makeUser();
    const { cookie } = await loginAs(u);
    const first = cookieValue(cookie, 'px_rt');
    const r1 = await api().post('/api/auth/refresh').set('Cookie', first);
    expect(r1.status).toBe(200);
    const second = cookieValue(r1.headers['set-cookie'], 'px_rt');
    expect(second).not.toBe(first);
    // replay the old token → rejected, and the newer token is revoked too
    const replay = await api().post('/api/auth/refresh').set('Cookie', first);
    expect(replay.status).toBe(401);
    const after = await api().post('/api/auth/refresh').set('Cookie', second);
    expect(after.status).toBe(401);
  });

  it('logout revokes the session', async () => {
    const u = await makeUser();
    const { cookie } = await loginAs(u);
    const c = cookieValue(cookie, 'px_rt');
    expect((await api().post('/api/auth/logout').set('Cookie', c)).status).toBe(200);
    expect((await api().post('/api/auth/refresh').set('Cookie', c)).status).toBe(401);
  });

  it('rejects refresh calls from untrusted origins (CSRF)', async () => {
    const u = await makeUser();
    const { cookie } = await loginAs(u);
    const res = await api().post('/api/auth/refresh').set('Cookie', cookieValue(cookie, 'px_rt')).set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('blocked users cannot log in and existing tokens stop working', async () => {
    const u = await makeUser();
    const { token } = await loginAs(u);
    await prisma.user.update({ where: { id: u.id }, data: { accountStatus: 'BLOCKED' } });
    expect((await api().get('/api/auth/me').set(auth(token))).status).toBe(403);
    expect((await api().post('/api/auth/login').send({ email: u.email, password: u.password })).status).toBe(403);
  });
});

describe('tokens and roles', () => {
  it('rejects missing, malformed and forged tokens', async () => {
    expect((await api().get('/api/auth/me')).status).toBe(401);
    expect((await api().get('/api/auth/me').set(auth('not-a-jwt'))).status).toBe(401);
    const forged = jwt.sign({ sub: '1', scope: 'user' }, 'some-other-secret-that-is-long-enough-123', { issuer: 'predictx', audience: 'user' });
    expect((await api().get('/api/auth/me').set(auth(forged))).status).toBe(401);
  });

  it('a normal user cannot use admin routes or the admin login', async () => {
    const u = await makeUser();
    const { token } = await loginAs(u);
    expect((await api().get('/api/admin/dashboard').set(auth(token))).status).toBe(401); // user token is not an admin token
    expect((await api().post('/api/auth/admin/login').send({ email: u.email, password: u.password })).status).toBe(401);
  });

  it('an admin-scoped token for a user whose role was removed is refused', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const { token } = await loginAs(admin, 'admin');
    expect((await api().get('/api/admin/dashboard').set(auth(token))).status).toBe(200);
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'USER' } });
    expect((await api().get('/api/admin/dashboard').set(auth(token))).status).toBe(403);
  });
});

describe('profile and passwords', () => {
  it('updates the profile and changes the password', async () => {
    const u = await makeUser();
    const { token } = await loginAs(u);
    const p = await api().patch('/api/auth/me').set(auth(token)).send({ fullName: 'Renamed Person', role: 'ADMIN' });
    expect(p.status).toBe(200);
    expect(p.body.data.user.name).toBe('Renamed Person');
    expect(p.body.data.user.role).toBe('USER');

    const bad = await api().post('/api/auth/change-password').set(auth(token)).send({ currentPassword: 'nope', newPassword: 'Another123', confirmPassword: 'Another123' });
    expect(bad.status).toBe(422);
    const good = await api().post('/api/auth/change-password').set(auth(token)).send({ currentPassword: u.password, newPassword: 'Another123', confirmPassword: 'Another123' });
    expect(good.status).toBe(200);
    expect((await api().post('/api/auth/login').send({ email: u.email, password: 'Another123' })).status).toBe(200);
  });

  it('forgot/reset password works once, and does not reveal unknown emails', async () => {
    const u = await makeUser();
    const unknown = await api().post('/api/auth/forgot-password').send({ email: 'missing@example.com' });
    const known = await api().post('/api/auth/forgot-password').send({ email: u.email });
    expect(unknown.status).toBe(200);
    expect(known.body.message).toBe(unknown.body.message);
    const mail = sentMail.find((m) => m.to === u.email);
    const token = decodeURIComponent(mail.text.match(/token=([^\s]+)/)[1]);
    const reset = await api().post('/api/auth/reset-password').send({ token, password: 'Resetpass9', confirmPassword: 'Resetpass9' });
    expect(reset.status).toBe(200);
    const again = await api().post('/api/auth/reset-password').send({ token, password: 'Resetpass9', confirmPassword: 'Resetpass9' });
    expect(again.status).toBe(400);
    expect((await api().post('/api/auth/login').send({ email: u.email, password: 'Resetpass9' })).status).toBe(200);
  });
});
