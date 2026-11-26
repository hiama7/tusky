// =============================================================================
// External data integration layer (sports data + news).
//
// Providers implement a small interface. Only "manual" (admin-entered data) is
// active today; a real provider is added by writing an adapter and setting
// SPORTS_DATA_PROVIDER / NEWS_PROVIDER plus its API key in .env.
//
// Imported data is always tagged source = PROVIDER, and imported news is saved
// as DRAFT so an administrator must approve it before it is published.
// No data is fabricated: if no provider is configured, sync reports that.
// =============================================================================
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/apiResponse.js';
import { slugify } from './slug.js';

/**
 * Sports data provider interface:
 *   name: string
 *   fetchFixtures({ sport, from, to }) → [{ externalId, sport, tournament, teamA, teamB, startsAt, venue }]
 *   fetchResult(externalMatchId)      → { winner: 'A'|'B'|'DRAW', score, description, completedAt } | null
 */
const sportsProviders = {
  manual: {
    name: 'manual',
    async fetchFixtures() { return []; },
    async fetchResult() { return null; },
  },
};

/**
 * News provider interface:
 *   name: string
 *   fetchArticles({ since }) → [{ externalId, title, description, content, image, category, url, publishedAt }]
 */
const newsProviders = {
  none: { name: 'none', async fetchArticles() { return []; } },
};

export function registerSportsProvider(key, provider) { sportsProviders[key] = provider; }
export function registerNewsProvider(key, provider) { newsProviders[key] = provider; }

export function integrationStatus() {
  return {
    sportsData: { provider: env.SPORTS_DATA_PROVIDER, available: Object.keys(sportsProviders), configured: env.SPORTS_DATA_PROVIDER !== 'manual' },
    news: { provider: env.NEWS_PROVIDER, available: Object.keys(newsProviders), configured: env.NEWS_PROVIDER !== 'none' },
  };
}

function sportsProvider() {
  const p = sportsProviders[env.SPORTS_DATA_PROVIDER];
  if (!p) throw ApiError.badRequest(`Unknown SPORTS_DATA_PROVIDER "${env.SPORTS_DATA_PROVIDER}"`);
  return p;
}

/** Fetches fixtures from the configured provider (none for "manual"). */
export async function previewFixtures(params) {
  const provider = sportsProvider();
  if (provider.name === 'manual') return { provider: 'manual', fixtures: [], message: 'No external sports-data provider is configured. Matches are entered manually.' };
  return { provider: provider.name, fixtures: await provider.fetchFixtures(params) };
}

/** Imports external news as DRAFT, skipping articles already stored (by source + externalId). */
export async function importNews() {
  const provider = newsProviders[env.NEWS_PROVIDER];
  if (!provider) throw ApiError.badRequest(`Unknown NEWS_PROVIDER "${env.NEWS_PROVIDER}"`);
  if (provider.name === 'none') return { provider: 'none', imported: 0, skipped: 0, message: 'No external news provider is configured.' };
  const articles = await provider.fetchArticles({ since: new Date(Date.now() - 7 * 86_400_000) });
  let imported = 0;
  let skipped = 0;
  for (const a of articles) {
    const exists = await prisma.news.findUnique({ where: { source_externalId: { source: 'PROVIDER', externalId: String(a.externalId) } } });
    if (exists) { skipped += 1; continue; }
    await prisma.news.create({
      data: {
        title: a.title.slice(0, 200),
        slug: await uniqueNewsSlug(a.title),
        description: (a.description || '').slice(0, 500),
        content: a.content || a.description || '',
        image: a.image || null,
        category: a.category || 'Tournament News',
        publicationStatus: 'DRAFT', // admin approval required
        publishedAt: a.publishedAt ? new Date(a.publishedAt) : null,
        source: 'PROVIDER',
        externalId: String(a.externalId),
        externalUrl: a.url || null,
      },
    });
    imported += 1;
  }
  return { provider: provider.name, imported, skipped };
}

export async function uniqueNewsSlug(title, excludeId) {
  const base = slugify(title) || 'article';
  let slug = base;
  for (let i = 2; ; i += 1) {
    const clash = await prisma.news.findFirst({ where: { slug, ...(excludeId ? { NOT: { id: excludeId } } : {}) }, select: { id: true } });
    if (!clash) return slug;
    slug = `${base}-${i}`;
  }
}
