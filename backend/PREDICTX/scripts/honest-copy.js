// Brings sport and plan wording in an existing database up to date, so it only
// describes what the site does. A row is changed only if it still holds the
// original seeded wording, so anything an admin has edited is left alone.
//   npm run copy:fix
//   npm run copy:restore
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { prisma } from '../src/config/database.js';
import { PLANS, SPORTS } from '../prisma/seed-data.js';

const OLD_SPORTS = {
  cricket: 'T20, ODI & Test analytics', football: 'League & cup match models', basketball: 'Pace & efficiency ratings',
  tennis: 'Surface-aware player form', badminton: 'Rally length & serve stats', hockey: 'Circle entries & conversions',
  volleyball: 'Set-by-set momentum', esports: 'Map pools & draft stats',
};
const OLD_PLANS = {
  'basic-weekly': ['Cricket & football predictions for 7 days', 'Match insights & player stats', 'Email alerts'],
  'premium-monthly': ['All sports for 30 days', 'Full head-to-head history', 'Priority notifications', 'Early access to new sports'],
  'pro-yearly': ['Everything in Premium', 'About 2 months free vs monthly', 'Advanced analytics dashboard', 'Dedicated support'],
};
const STATE = new URL('../.copy-before.json', import.meta.url);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const action = process.argv[2];
try {
  if (action === 'fix') {
    const before = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { sports: {}, plans: {} };
    const sports = (await prisma.sport.findMany()).filter((s) => s.description === OLD_SPORTS[s.slug]);
    const plans = (await prisma.subscriptionPlan.findMany()).filter((p) => same(p.features, OLD_PLANS[p.code]));
    for (const s of sports) before.sports[s.slug] = s.description;
    for (const p of plans) before.plans[p.code] = { description: p.description, features: p.features };
    writeFileSync(STATE, JSON.stringify(before, null, 2)); // saved before anything changes
    await prisma.$transaction([
      ...sports.map((s) => prisma.sport.update({ where: { id: s.id }, data: { description: SPORTS.find((x) => x.slug === s.slug).description } })),
      ...plans.map((p) => {
        const next = PLANS.find((x) => x.code === p.code);
        return prisma.subscriptionPlan.update({ where: { id: p.id }, data: { description: next.description, features: next.features } });
      }),
    ]);
    console.log(`Updated ${sports.length} sports and ${plans.length} plans.`);
  } else if (action === 'restore' && existsSync(STATE)) {
    const before = JSON.parse(readFileSync(STATE, 'utf8'));
    await prisma.$transaction([
      ...Object.entries(before.sports).map(([slug, description]) => prisma.sport.update({ where: { slug }, data: { description } })),
      ...Object.entries(before.plans).map(([code, data]) => prisma.subscriptionPlan.update({ where: { code }, data })),
    ]);
    rmSync(STATE);
    console.log('Previous wording restored.');
  } else {
    console.error('Usage: node scripts/honest-copy.js <fix|restore>');
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
