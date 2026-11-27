import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { assess } from '../src/services/healthService.js';
import { resetAlertHistory, sendAlert } from '../src/utils/alert.js';
import { modelReports } from '../src/services/modelReportService.js';
import { season, steps } from '../../../ops/jobs.mjs';
import { api, auth, loginAs, makeUser } from './helpers.js';

const NOW = Date.parse('2026-11-27T12:00:00Z');
const at = (days) => new Date(NOW + days * 86_400_000).toISOString();
const good = { furthest: at(12), drafts: 0, unsettled: 0, heldRefunds: 0, jobs: { finishedAt: at(-0.2), steps: [{ name: 'sync', ok: true }] }, backup: { finishedAt: at(-0.3), problems: [] } };
const level = (facts, name) => assess({ ...good, ...facts }, NOW).checks.find((c) => c.name === name)?.level;

afterEach(() => {
  env.ALERT_WEBHOOK_URL = '';
  resetAlertHistory();
  vi.unstubAllGlobals();
});

describe('health judgement', () => {
  it('is ok when everything is fresh', () => {
    expect(assess(good, NOW).status).toBe('ok');
  });

  it('warns before the site runs out of matches, and fails when it has', () => {
    expect(level({ furthest: at(3), drafts: 20 }, 'fixtures')).toBe('warn');
    expect(assess({ ...good, furthest: at(3), drafts: 20 }, NOW).checks[0].message).toContain('20 imported matches are waiting');
    expect(level({ furthest: undefined }, 'fixtures')).toBe('fail');
  });

  it('notices stale results, held refunds, failed or silent jobs and old backups', () => {
    expect(level({ unsettled: 4 }, 'results')).toBe('warn');
    expect(level({ heldRefunds: 1 }, 'refunds')).toBe('warn');
    expect(level({ jobs: { finishedAt: at(-0.1), steps: [{ name: 'predict', ok: false }] } }, 'jobs')).toBe('fail');
    expect(level({ jobs: { finishedAt: at(-4), steps: [] } }, 'jobs')).toBe('warn');
    expect(level({ jobs: null }, 'jobs')).toBe('warn');
    expect(level({ backup: { finishedAt: at(-5), problems: [] } }, 'backup')).toBe('warn');
    expect(level({ backup: { finishedAt: at(0), problems: ['Postgres: down'] } }, 'backup')).toBe('fail');
  });

  it('is visible to admins only', async () => {
    expect((await api().get('/api/admin/system-health')).status).toBe(401);
    const admin = await loginAs(await makeUser({ role: 'ADMIN' }), 'admin');
    const res = await api().get('/api/admin/system-health').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data.checks.map((c) => c.name)).toEqual(expect.arrayContaining(['fixtures', 'results', 'jobs', 'backup']));
  });
});

describe('model report', () => {
  it('is admin-only and reports nothing rather than failing when files are missing', async () => {
    expect((await api().get('/api/admin/model-report')).status).toBe(401);
    expect(modelReports(new URL('file:///no/such/folder/'))).toEqual({ football: null, cricket: [], weakness: null });
    const admin = await loginAs(await makeUser({ role: 'ADMIN' }), 'admin');
    const res = await api().get('/api/admin/model-report').set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data.trackRecord).toHaveProperty('matches');
  });
});

describe('alerts', () => {
  it('posts once per problem within the quiet period, and never throws', async () => {
    env.ALERT_WEBHOOK_URL = 'https://hooks.example.test/secret';
    const f = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', f);
    expect(await sendAlert('disk full')).toBe(true);
    expect(await sendAlert('disk full')).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
    f.mockRejectedValue(new Error('offline'));
    expect(await sendAlert('something else')).toBe(false);
  });
});

describe('daily run', () => {
  it('works out the football season and publishes only when told to', () => {
    expect(season(new Date('2026-11-27'))).toBe('2026-27');
    expect(season(new Date('2027-05-01'))).toBe('2026-27');
    expect(season(new Date('2027-07-02'))).toBe('2027-28');
    const sync = (opts) => steps(opts).find((s) => s.name === 'sync').args;
    expect(sync({ publish: false, news: false })).not.toContain('--publish');
    expect(sync({ publish: true, news: false })).toContain('--publish');
    expect(steps({ publish: false, news: false }).map((s) => s.name)).toEqual(['results', 'predict', 'sync', 'health']);
  });
});
