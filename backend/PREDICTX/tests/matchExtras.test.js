import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { mentions } from '../src/services/matchNewsService.js';
import { ageOn, clearPlayersCache, playersFor } from '../src/services/playersService.js';
import { api, makeMatch, prisma } from './helpers.js';

const person = (id, name) => ({ id, name, position: 'Offence', nationality: 'England', dateOfBirth: '2000-06-15' });
const SQUADS = { teams: [
  { id: 1, shortName: 'Arsenal', name: 'Arsenal FC', squad: [person(10, 'Quiet Defender'), person(11, 'Top Scorer')] },
  { id: 2, shortName: 'Leeds United', name: 'Leeds United FC', squad: [person(20, 'Other Player')] },
] };
const SCORERS = { scorers: [
  { team: { id: 1 }, player: person(11, 'Top Scorer'), playedMatches: 12, goals: 9, assists: null, penalties: 2 },
  { team: { id: 1 }, player: person(12, 'Late Signing'), playedMatches: 3, goals: 1, assists: 1, penalties: null },
] };
const provider = ({ scorersOk = true } = {}) => vi.fn(async (url) => {
  const scorers = String(url).includes('/scorers');
  return { ok: !scorers || scorersOk, status: 429, json: async () => (scorers ? SCORERS : SQUADS) };
});
const fixture = { sport: 'football', tournament: 'Premier League', teamA: 'Leeds', teamB: 'Arsenal' };

afterEach(() => {
  env.FOOTBALL_DATA_API_KEY = '';
  clearPlayersCache();
  vi.unstubAllGlobals();
});

describe('match players', () => {
  it('is off without a key and never calls out', async () => {
    const f = provider();
    vi.stubGlobal('fetch', f);
    expect(await playersFor(fixture)).toEqual({ available: false });
    expect(f).not.toHaveBeenCalled();
  });

  it('lists both squads, keeps unknown figures empty and caches', async () => {
    env.FOOTBALL_DATA_API_KEY = 'test-key';
    const f = provider();
    vi.stubGlobal('fetch', f);
    const out = await playersFor(fixture);
    expect(out.teams.map((t) => t.side)).toEqual(['A', 'B']);
    const arsenal = out.teams[1].players;
    expect(arsenal.map((p) => p.name)).toEqual(['Top Scorer', 'Late Signing', 'Quiet Defender']);
    expect(arsenal[0]).toMatchObject({ goals: 9, assists: 0, penalties: 2, played: 12 });
    expect(arsenal[2]).toMatchObject({ goals: null, assists: null, played: null });
    expect(JSON.stringify(out)).not.toContain('2000-06-15');
    expect(JSON.stringify(out)).not.toContain('test-key');
    await playersFor(fixture);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('still shows squads when the scorer list fails', async () => {
    env.FOOTBALL_DATA_API_KEY = 'test-key';
    vi.stubGlobal('fetch', provider({ scorersOk: false }));
    const out = await playersFor(fixture);
    expect(out.hasFigures).toBe(false);
    expect(out.teams[0].players[0].goals).toBeNull();
  });

  it('works out ages from the date of birth', () => {
    expect(ageOn('2000-06-15', new Date('2026-06-14T12:00:00Z'))).toBe(25);
    expect(ageOn('2000-06-15', new Date('2026-06-15T12:00:00Z'))).toBe(26);
    expect(ageOn(undefined)).toBeNull();
  });
});

describe('match news', () => {
  it('matches whole team names only', () => {
    expect(mentions('Leeds United sign a striker', 'Leeds')).toBe(true);
    expect(mentions('Cologne preview: 1. FC Köln at home', '1. FC Köln')).toBe(true);
    expect(mentions('Interest grows in the cup', 'Inter')).toBe(false);
    expect(mentions('Anything', '')).toBe(false);
  });

  it('returns published articles about either team, never drafts', async () => {
    const match = await makeMatch({ withPrediction: false });
    const { teamA } = await prisma.match.findUnique({ where: { id: match.id }, include: { teamA: true } });
    const article = (slug, publicationStatus, title) => prisma.news.create({ data: { slug: `${slug}-${match.id}`, title, description: 'Summary', content: 'Body', category: 'Football', publicationStatus, publishedAt: new Date(Date.now() - 60_000) } });
    await article('shown', 'PUBLISHED', `${teamA.name} name their squad`);
    await article('draft', 'DRAFT', `${teamA.name} draft story`);
    await article('unrelated', 'PUBLISHED', 'Something else entirely');
    const res = await api().get(`/api/matches/${match.id}/news`);
    expect(res.body.data.items.map((n) => n.slug)).toEqual([`shown-${match.id}`]);
  });

  it('is served for published matches only', async () => {
    const match = await makeMatch({ withPrediction: false });
    expect((await api().get(`/api/matches/${match.id}/players`)).body.data).toEqual({ available: false });
    await prisma.match.update({ where: { id: match.id }, data: { published: false } });
    expect((await api().get(`/api/matches/${match.id}/players`)).status).toBe(404);
    expect((await api().get(`/api/matches/${match.id}/news`)).status).toBe(404);
  });
});
