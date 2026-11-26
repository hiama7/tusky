// Hides or restores the seeded sample (isDemo) matches and news on the public site.
// Nothing is deleted: `hide` unpublishes and remembers which rows it changed,
// `show` publishes exactly those rows again.
//   npm run demo:hide
//   npm run demo:show
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { prisma } from '../src/config/database.js';

const STATE = new URL('../.demo-hidden.json', import.meta.url);
const action = process.argv[2];
if (!['hide', 'show'].includes(action)) {
  console.error('Usage: node scripts/demo-content.js <hide|show>');
  process.exit(1);
}

const saved = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { matches: [], news: [] };

try {
  if (action === 'hide') {
    const matches = (await prisma.match.findMany({ where: { isDemo: true, published: true }, select: { id: true } })).map((r) => r.id);
    const news = (await prisma.news.findMany({ where: { isDemo: true, publicationStatus: 'PUBLISHED' }, select: { id: true } })).map((r) => r.id);
    // saved first, so an interrupted run can still be undone
    writeFileSync(STATE, JSON.stringify({ matches: [...new Set([...saved.matches, ...matches])], news: [...new Set([...saved.news, ...news])] }));
    await prisma.$transaction([
      prisma.match.updateMany({ where: { id: { in: matches } }, data: { published: false } }),
      prisma.news.updateMany({ where: { id: { in: news } }, data: { publicationStatus: 'UNPUBLISHED' } }),
    ]);
    console.log(`Hidden: ${matches.length} sample matches, ${news.length} sample articles.`);
  } else {
    const [m, n] = await prisma.$transaction([
      prisma.match.updateMany({ where: { id: { in: saved.matches }, isDemo: true }, data: { published: true } }),
      prisma.news.updateMany({ where: { id: { in: saved.news }, isDemo: true }, data: { publicationStatus: 'PUBLISHED' } }),
    ]);
    rmSync(STATE, { force: true });
    console.log(`Restored: ${m.count} sample matches, ${n.count} sample articles.`);
  }
} finally {
  await prisma.$disconnect();
}
