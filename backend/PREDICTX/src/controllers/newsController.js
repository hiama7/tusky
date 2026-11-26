// Public news: only PUBLISHED articles whose publish time has passed (scheduled
// articles appear automatically once their publishedAt is reached).
import { prisma } from '../config/database.js';
import { ApiError, ok, paginate } from '../utils/apiResponse.js';
import * as S from '../services/serializers.js';

const visible = () => ({ publicationStatus: 'PUBLISHED', publishedAt: { lte: new Date() } });

export async function list(req, res) {
  const q = req.valid.query;
  const { skip, take, meta } = paginate(q, { defaultLimit: 12, maxLimit: 50 });
  const where = visible();
  if (q.category && q.category !== 'All') where.category = q.category;
  if (q.featured !== undefined) where.featured = q.featured;
  if (q.trending !== undefined) where.trending = q.trending;
  if (q.q) where.OR = [{ title: { contains: q.q } }, { description: { contains: q.q } }];
  const [rows, total] = await Promise.all([
    prisma.news.findMany({ where, include: { author: { select: { fullName: true } } }, orderBy: { publishedAt: 'desc' }, skip, take }),
    prisma.news.count({ where }),
  ]);
  ok(res, { items: rows.map((n) => S.news(n)), pagination: meta(total) });
}

/** GET /api/news/:idOrSlug — full article; increments the view counter. */
export async function details(req, res) {
  const key = req.params.idOrSlug;
  const where = { ...visible(), ...(/^\d+$/.test(key) ? { id: Number(key) } : { slug: key }) };
  const article = await prisma.news.findFirst({ where, include: { author: { select: { fullName: true } } } });
  if (!article) throw ApiError.notFound('Article not found');
  await prisma.news.update({ where: { id: article.id }, data: { views: { increment: 1 } } });
  ok(res, { article: S.news({ ...article, views: article.views + 1 }, { full: true }) });
}

export async function categories(_req, res) {
  const rows = await prisma.news.groupBy({ by: ['category'], where: visible(), _count: true });
  ok(res, { categories: rows.map((r) => ({ name: r.category, count: r._count })) });
}
