import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { isBettingTip, sameStory } from '../src/services/newsFilter.js';
import { gnewsProvider, toArticle } from '../src/services/gnewsProvider.js';
import { clearStandingsCache, findTeam, standingsFor, teamKey } from '../src/services/standingsService.js';
import { api, loginAs, auth, makeMatch, makeUser, prisma } from './helpers.js';

const team = (position, shortName, name) => ({ position, team: { shortName, name }, playedGames: 12, won: 7, draw: 3, lost: 2, goalDifference: 9, points: 24 });
const TABLE = { competition: { name: 'Premier League' }, standings: [{ type: 'TOTAL', table: [team(1, 'Arsenal', 'Arsenal FC'), team(2, 'Leeds United', 'Leeds United FC'), team(3, 'Man United', 'Manchester United FC')] }] };
const reply = (body, ok = true, status = 200) => vi.fn().mockResolvedValue({ ok, status, json: async () => body });
const fixture = { sport: 'football', tournament: 'Premier League', teamA: 'Leeds', teamB: 'Arsenal' };

afterEach(() => {
  env.FOOTBALL_DATA_API_KEY = '';
  env.GNEWS_API_KEY = '';
  clearStandingsCache();
  vi.unstubAllGlobals();
});

describe('league tables', () => {
  it('matches team names across sources, and gives up when unsure', () => {
    expect(teamKey('1. FSV Mainz 05')).toBe('fsv mainz');
    expect(teamKey('Rennes')).toBe(teamKey('Stade Rennais FC 1901'));
    expect(teamKey('Estac Troyes')).toBe('troyes');
    const rows = [{ names: ['Manchester City FC'] }, { names: ['Manchester United FC'] }];
    expect(findTeam(rows, 'Manchester United')).toBe(1);
    expect(findTeam(rows, 'Manchester')).toBe(-1);
  });

  it('is off without a key and never calls out', async () => {
    const f = reply(TABLE);
    vi.stubGlobal('fetch', f);
    expect(await standingsFor(fixture)).toEqual({ available: false });
    expect(f).not.toHaveBeenCalled();
  });

  it('marks both teams, credits the source and caches the table', async () => {
    env.FOOTBALL_DATA_API_KEY = 'test-key';
    const f = reply(TABLE);
    vi.stubGlobal('fetch', f);
    const out = await standingsFor(fixture);
    expect(out.rows.map((r) => r.side)).toEqual(['B', 'A', null]);
    expect(out.attribution).toContain('Football-Data.org');
    expect(JSON.stringify(out)).not.toContain('test-key');
    await standingsFor(fixture);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('shows nothing when the provider fails or the teams are not in the table', async () => {
    env.FOOTBALL_DATA_API_KEY = 'test-key';
    vi.stubGlobal('fetch', reply({}, false, 429));
    expect(await standingsFor(fixture)).toEqual({ available: false });
    clearStandingsCache();
    vi.stubGlobal('fetch', reply(TABLE));
    expect(await standingsFor({ ...fixture, teamA: 'Kaizer Chiefs', teamB: 'Orlando Pirates' })).toEqual({ available: false });
  });

  it('is served for published matches only', async () => {
    const match = await makeMatch({ withPrediction: false });
    expect((await api().get(`/api/matches/${match.id}/standings`)).body.data).toEqual({ available: false });
    await prisma.match.update({ where: { id: match.id }, data: { published: false } });
    expect((await api().get(`/api/matches/${match.id}/standings`)).status).toBe(404);
  });
});

describe('headlines', () => {
  const item = { title: 'A headline', description: 'Short summary', url: 'https://example.com/a', source: { name: 'Example Times' }, publishedAt: new Date().toISOString(), image: 'https://example.com/p.jpg', content: 'the full text' };

  it('keeps a summary and a link, not the article or its photo', () => {
    const a = toArticle(item, 'Football');
    expect(a).toMatchObject({ image: null, url: item.url, category: 'Football' });
    expect(a.content).toContain('Example Times');
    expect(a.content).not.toContain('the full text');
    expect(toArticle({ ...item, url: 'javascript:alert(1)' }, 'Football')).toBeNull();
  });

  it('reports a clear error when every request fails', async () => {
    env.GNEWS_API_KEY = 'test-key';
    vi.stubGlobal('fetch', reply({}, false, 403));
    await expect(gnewsProvider.fetchArticles({ since: new Date() })).rejects.toThrow('GNEWS_API_KEY');
  });

  it('spots betting promotions but not news about betting', () => {
    expect(isBettingTip({ title: 'Football Bet of the Day for Thursday' })).toBe(true);
    expect(isBettingTip({ title: 'Derby preview', description: 'Prediction, odds and picks' })).toBe(true);
    expect(isBettingTip({ title: 'Derby: odds and picks' })).toBe(true);
    expect(isBettingTip({ title: 'Player banned over betting scandal' })).toBe(false);
  });

  it('recognises one story told by several outlets, and keeps different ones', () => {
    expect(sameStory('Jannik Sinner ruled out of Australian Open after surgery', 'Jannik Sinner won’t play 2027 Australian Open')).toBe(true);
    expect(sameStory('Box score: Montana State vs. Northwest Indian College', 'Box score: Montana State vs. Northwest Indian College')).toBe(true);
    expect(sameStory('Box score: Montana State vs. Carroll College', 'Box score: Idaho State vs. Boise Bible College')).toBe(false);
    expect(sameStory('Jannik Sinner ruled out of Australian Open', 'Australian Open raises prize money')).toBe(false);
    expect(sameStory('Alpha Rovers appoint Smith as manager', 'Beta Rovers appoint Jones as manager')).toBe(false);
  });

  it('leaves out betting tips and repeats when importing', async () => {
    env.GNEWS_API_KEY = 'test-key';
    const id = Date.now().toString(36);
    const story = (n, title) => ({ ...item, url: `https://example.com/${id}-${n}`, title });
    vi.stubGlobal('fetch', reply({ articles: [story(1, `Zeta${id} Rovers appoint Quill${id} manager`), story(2, `Zeta${id} Rovers appoint Quill${id} as new manager`), story(3, `Bet of the day ${id}`)] }));
    const admin = await loginAs(await makeUser({ role: 'ADMIN' }), 'admin');
    const res = await api().post('/api/admin/integrations/news/import').set(auth(admin.token));
    // the stand-in answers all four topics with the same three articles
    expect(res.body.data).toMatchObject({ imported: 1, betting: 4 });
  });

  it('imports as drafts through the admin endpoint, once', async () => {
    env.GNEWS_API_KEY = 'test-key';
    const url = `https://example.com/${Date.now()}`;
    vi.stubGlobal('fetch', reply({ articles: [{ ...item, url, title: `Yarrow${Date.now()} signs Vexley${Date.now()} deal` }] }));
    const admin = await loginAs(await makeUser({ role: 'ADMIN' }), 'admin');
    const first = await api().post('/api/admin/integrations/news/import').set(auth(admin.token));
    expect(first.body.data).toMatchObject({ provider: 'gnews', imported: 1 });
    const again = await api().post('/api/admin/integrations/news/import').set(auth(admin.token));
    expect(again.body.data.imported).toBe(0);
    const saved = await prisma.news.findFirst({ where: { externalUrl: url } });
    expect(saved).toMatchObject({ publicationStatus: 'DRAFT', source: 'PROVIDER', image: null });
  });
});
