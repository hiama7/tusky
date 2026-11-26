// Rate limiting is disabled for the other test files; this file turns it on
// before the app modules are imported (Vitest isolates modules per file).
import { describe, expect, it } from 'vitest';

process.env.RATE_LIMIT_DISABLED = 'false';
const { api } = await import('./helpers.js');

describe('login rate limiting', () => {
  it('returns 429 after 10 attempts for the same email from one IP', async () => {
    const statuses = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await api().post('/api/auth/login').send({ email: 'brute@example.com', password: `guess-${i}` });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});
