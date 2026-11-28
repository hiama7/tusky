// Published articles that name one of a match's two teams. Matching is on the
// headline and summary only, so it can miss nicknames; it never shows drafts.
import { prisma } from '../config/database.js';
import * as S from './serializers.js';
import { teamKey } from './standingsService.js';

const DAYS = 14;
const LIMIT = 5;

export function mentions(text, team) {
  const key = teamKey(team);
  return Boolean(key) && ` ${teamKey(text)} `.includes(` ${key} `);
}

export async function newsFor({ teamA, teamB }, now = new Date()) {
  const rows = await prisma.news.findMany({
    where: { publicationStatus: 'PUBLISHED', publishedAt: { lte: now, gte: new Date(now.getTime() - DAYS * 86_400_000) } },
    orderBy: { publishedAt: 'desc' },
    take: 300,
  });
  return rows
    .filter((n) => [teamA, teamB].some((team) => mentions(`${n.title} . ${n.description}`, team)))
    .slice(0, LIMIT)
    .map((n) => S.news(n));
}
