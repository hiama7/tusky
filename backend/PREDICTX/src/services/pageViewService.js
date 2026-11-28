// Anonymous page-view counts: one number per public page per day. Nothing about the
// visitor is stored (no cookie, address or browser string).
import { prisma } from '../config/database.js';

// keep in step with frontend/PREDICTX/src/content/pages.js
export const PUBLIC_PAGES = new Set(['/', '/sports', '/news', '/track-record', '/pricing', '/about', '/terms', '/privacy', '/refunds', '/disclaimer', '/register', '/login']);

const day = (now) => new Date(now.toISOString().slice(0, 10));

export async function countView(path, now = new Date()) {
  if (!PUBLIC_PAGES.has(path)) return false; // anything else is ignored, so junk cannot fill the table
  const key = { day: day(now), path };
  await prisma.pageView.upsert({ where: { day_path: key }, update: { views: { increment: 1 } }, create: { ...key, views: 1 } });
  return true;
}

export async function viewSummary(days = 30, now = new Date()) {
  const since = day(new Date(now.getTime() - (days - 1) * 86_400_000));
  const rows = await prisma.pageView.groupBy({ by: ['path'], where: { day: { gte: since } }, _sum: { views: true } });
  const pages = rows.map((r) => ({ path: r.path, views: r._sum.views })).sort((a, b) => b.views - a.views);
  return { days, total: pages.reduce((s, p) => s + p.views, 0), pages };
}
