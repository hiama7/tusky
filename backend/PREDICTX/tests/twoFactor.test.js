import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, codeAt, matchingStep, seal, stepAt, unseal } from '../src/utils/totp.js';
import { api, auth, loginAs, makeUser, prisma } from './helpers.js';

const login = (user, code) => api().post('/api/auth/admin/login').send({ email: user.email, password: user.password, ...(code ? { code } : {}) });
// a code the server has not yet accepted: later steps stay valid within the drift window
const fresh = (secret, ahead = 0) => codeAt(secret, stepAt() + ahead);

async function enrolled() {
  const admin = await makeUser({ role: 'ADMIN' });
  const { token } = await loginAs(admin, 'admin');
  const { secret } = (await api().post('/api/auth/admin/2fa/setup').set(auth(token)).send({ password: admin.password })).body.data;
  const on = await api().post('/api/auth/admin/2fa/enable').set(auth(token)).send({ code: fresh(secret, -1) });
  return { admin, token, secret, recovery: on.body.data.recoveryCodes };
}

describe('one-time codes', () => {
  it('match the RFC 6238 test vectors', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    for (const [seconds, code] of [[59, '94287082'], [1111111109, '07081804'], [1234567890, '89005924'], [2000000000, '69279037']]) {
      expect(codeAt(secret, Math.floor(seconds / 30), 8)).toBe(code);
    }
    expect(matchingStep(secret, codeAt(secret, 100), 100 * 30_000 + 45_000)).toBe(100);
    expect(matchingStep(secret, codeAt(secret, 100), 103 * 30_000)).toBeNull();
  });

  it('are stored sealed, and a tampered value is refused', () => {
    const sealed = seal('SECRET234');
    expect(sealed).not.toContain('SECRET234');
    expect(unseal(sealed)).toBe('SECRET234');
    expect(() => unseal(`${sealed.slice(0, -4)}AAAA`)).toThrow();
  });
});

describe('admin two-factor sign-in', () => {
  it('is off by default and needs the password to set up', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const first = await login(admin);
    expect(first.status).toBe(200);
    const wrong = await api().post('/api/auth/admin/2fa/setup').set(auth(first.body.data.accessToken)).send({ password: 'not-the-password1' });
    expect(wrong.status).toBe(422);
    expect((await api().post('/api/auth/admin/2fa/setup').send({ password: admin.password })).status).toBe(401);
  });

  it('asks for a code only after a correct password, and accepts each code once', async () => {
    const { admin, secret } = await enrolled();
    const noCode = await login(admin);
    expect(noCode.status).toBe(401);
    expect(noCode.body.errors[0].field).toBe('code');
    const badPassword = await api().post('/api/auth/admin/login').send({ email: admin.email, password: 'wrong-password1' });
    expect(badPassword.body.errors).toEqual([]);
    expect((await login(admin, '000000')).status).toBe(401);
    const code = fresh(secret);
    expect((await login(admin, code)).status).toBe(200);
    expect((await login(admin, code)).status).toBe(401);
  });

  it('a recovery code works once', async () => {
    const { admin, recovery } = await enrolled();
    expect(recovery).toHaveLength(8);
    expect((await login(admin, recovery[0])).status).toBe(200);
    expect((await login(admin, recovery[0])).status).toBe(401);
  });

  it('signs out other admin sessions when switched on', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const other = await loginAs(admin, 'admin');
    const here = await loginAs(admin, 'admin');
    const { secret } = (await api().post('/api/auth/admin/2fa/setup').set(auth(here.token)).send({ password: admin.password })).body.data;
    const on = await api().post('/api/auth/admin/2fa/enable').set(auth(here.token)).set('Cookie', here.cookie).send({ code: fresh(secret) });
    expect(on.status).toBe(200);
    expect((await api().post('/api/auth/admin/refresh').set('Cookie', other.cookie)).status).toBe(401);
    expect((await api().post('/api/auth/admin/refresh').set('Cookie', here.cookie)).status).toBe(200);
  });

  it('can be switched off only with the password and a code, and never exposes the secret', async () => {
    const { admin, token, secret } = await enrolled();
    const state = await api().get('/api/auth/admin/2fa').set(auth(token));
    expect(state.body.data).toEqual({ enabled: true, recoveryCodesLeft: 8 });
    const me = await api().get('/api/auth/admin/me').set(auth(token));
    expect(JSON.stringify(me.body)).not.toMatch(/totp/i);
    const stored = (await prisma.user.findUnique({ where: { id: admin.id } })).totpSecret;
    expect(stored).not.toContain(secret);

    const bad = await api().post('/api/auth/admin/2fa/disable').set(auth(token)).send({ password: admin.password, code: '000000' });
    expect(bad.status).toBe(422);
    const off = await api().post('/api/auth/admin/2fa/disable').set(auth(token)).send({ password: admin.password, code: fresh(secret) });
    expect(off.status).toBe(200);
    expect((await login(admin)).status).toBe(200);
  });
});
