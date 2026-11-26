// Sports headlines from GNews (https://gnews.io). Needs GNEWS_API_KEY.
// Only the headline, short description and a link to the publisher are kept; the
// publisher's article is not copied. Imports are drafts an admin must approve.
// The free GNews plan is for non-commercial use only.
import crypto from 'node:crypto';
import { env } from '../config/env.js';

const TOPICS = [
  { category: 'Football', q: 'football AND (league OR cup)' },
  { category: 'Cricket', q: 'cricket' },
  { category: 'Basketball', q: 'basketball' },
  { category: 'Tennis', q: 'tennis' },
];
const GAP_MS = 1100; // the free plan allows one request a second

export const webUrl = (u) => (/^https?:\/\//i.test(u || '') ? String(u).slice(0, 500) : null);

export function toArticle(a, category) {
  const url = webUrl(a.url);
  if (!url || !a.title) return null;
  const source = a.source?.name || new URL(url).hostname;
  return {
    externalId: `gnews:${crypto.createHash('sha1').update(url).digest('hex')}`,
    title: a.title,
    description: a.description || a.title,
    content: `${a.description || a.title}\n\nSource: ${source}`,
    image: null, // publishers' photos are not ours to show
    category,
    url,
    publishedAt: a.publishedAt,
  };
}

export const gnewsProvider = {
  name: 'gnews',
  async fetchArticles({ since }) {
    const articles = [];
    let failures = 0;
    for (const [i, topic] of TOPICS.entries()) {
      if (i && !env.isTest) await new Promise((r) => setTimeout(r, GAP_MS));
      const query = new URLSearchParams({ q: topic.q, lang: 'en', max: '8', from: since.toISOString().replace(/\.\d{3}/, ''), apikey: env.GNEWS_API_KEY });
      try {
        const res = await fetch(`https://gnews.io/api/v4/search?${query}`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`GNews answered ${res.status}`);
        const data = await res.json();
        articles.push(...(data.articles || []).map((a) => toArticle(a, topic.category)).filter(Boolean));
      } catch (e) {
        failures += 1;
        console.warn(`[news] ${topic.category}: ${e.message}`); // never log the URL: it holds the key
      }
    }
    if (failures === TOPICS.length) throw new Error('GNews could not be reached. Check GNEWS_API_KEY and your request limit.');
    return articles;
  },
};
