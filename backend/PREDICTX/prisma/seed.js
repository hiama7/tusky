// =============================================================================
// Seed script — safe to run repeatedly (idempotent).
//   1. Sports catalogue and subscription plans (needed in every environment).
//   2. First admin account from ADMIN_EMAIL / ADMIN_PASSWORD (never hard-coded).
//   3. Optional SAMPLE content (SEED_DEMO_DATA=true): teams, tournaments,
//      matches, predictions and news — all flagged isDemo = true.
// Run: npm run db:seed
// =============================================================================
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { adapterConfig } from '../src/config/database.js';
import { MATCHES, NEWS, PLANS, SPORTS, samplePrediction } from './seed-data.js';
import { slugify } from '../src/services/slug.js';
import { snapshotOf } from '../src/services/predictionService.js';

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(adapterConfig(process.env.DATABASE_URL)) });
const IST_OFFSET_MIN = 330;

function istDate(dayOffset, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date(Date.now() + IST_OFFSET_MIN * 60_000);
  const d = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset, h, m);
  return new Date(d - IST_OFFSET_MIN * 60_000);
}

async function seedCatalogue() {
  const sports = {};
  for (const s of SPORTS) {
    sports[s.slug] = await prisma.sport.upsert({ where: { slug: s.slug }, update: {}, create: s });
  }
  for (const p of PLANS) {
    const { sports: slugs, ...data } = p;
    const exists = await prisma.subscriptionPlan.findUnique({ where: { code: p.code } });
    if (!exists) {
      await prisma.subscriptionPlan.create({ data: { ...data, sports: { create: slugs.map((slug) => ({ sportId: sports[slug].id })) } } });
    }
  }
  console.log(`✓ ${SPORTS.length} sports, ${PLANS.length} subscription plans`);
  return sports;
}

async function seedAdmin() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.log('• ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin account (use `npm run create-admin` later).');
    return null;
  }
  if (ADMIN_PASSWORD.length < 10) throw new Error('ADMIN_PASSWORD must be at least 10 characters.');
  const email = ADMIN_EMAIL.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== 'ADMIN') await prisma.user.update({ where: { id: existing.id }, data: { role: 'ADMIN' } });
    console.log(`✓ Admin account exists: ${email} (password unchanged)`);
    return existing;
  }
  const admin = await prisma.user.create({
    data: {
      fullName: ADMIN_NAME || 'Platform Admin',
      email,
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, Number(process.env.BCRYPT_ROUNDS || 12)),
      role: 'ADMIN',
      emailVerifiedAt: new Date(),
    },
  });
  console.log(`✓ Admin account created: ${email}`);
  return admin;
}

async function seedDemo(sports, admin) {
  if (await prisma.match.findFirst({ where: { isDemo: true } })) {
    console.log('• Sample matches already present — skipping demo content.');
    return;
  }
  let matchCount = 0;
  for (const m of MATCHES) {
    const sport = sports[m.sport];
    const threeWay = sport.outcomeFormat === 'THREE_WAY';
    const team = (x) => prisma.team.upsert({
      where: { sportId_name: { sportId: sport.id, name: x.name } },
      update: {},
      create: { sportId: sport.id, name: x.name, shortName: x.short, color: x.color },
    });
    const [teamA, teamB] = [await team(m.a), await team(m.b)];
    const tournament = await prisma.tournament.upsert({
      where: { sportId_name_season: { sportId: sport.id, name: m.tournament, season: '' } },
      update: {},
      create: { sportId: sport.id, name: m.tournament },
    });
    const match = await prisma.match.create({
      data: {
        sportId: sport.id, tournamentId: tournament.id, teamAId: teamA.id, teamBId: teamB.id,
        startsAt: istDate(m.day, m.time), venue: m.venue, conditions: m.conditions || null,
        predictionPrice: m.price, published: !m.draft, featured: Boolean(m.featured), isDemo: true,
      },
    });
    matchCount += 1;
    if (m.draft) continue;
    const p = samplePrediction(m, threeWay);
    const now = new Date();
    const prediction = await prisma.prediction.create({
      data: {
        matchId: match.id, outcomeFormat: threeWay ? 'THREE_WAY' : 'TWO_WAY', ...p,
        source: 'MANUAL', publicationStatus: 'PUBLISHED', version: 1, publishedAt: now, isDemo: true, createdById: admin?.id ?? null,
      },
    });
    await prisma.predictionVersion.create({ data: { predictionId: prediction.id, version: 1, snapshot: snapshotOf(prediction, match), publishedById: admin?.id ?? null, publishedAt: now } });
  }
  for (const n of NEWS) {
    const { daysAgo, ...data } = n;
    await prisma.news.create({
      data: { ...data, slug: slugify(n.title), publicationStatus: 'PUBLISHED', publishedAt: new Date(Date.now() - daysAgo * 86_400_000 - 3_600_000), authorId: admin?.id ?? null, isDemo: true, views: 0 },
    });
  }
  console.log(`✓ Sample content: ${matchCount} matches (${matchCount - 1} with predictions), ${NEWS.length} news articles — all labelled as sample`);
}

async function main() {
  const sports = await seedCatalogue();
  const admin = await seedAdmin();
  if (process.env.SEED_DEMO_DATA === 'true') await seedDemo(sports, admin);
  else console.log('• SEED_DEMO_DATA is not "true" — no sample matches or news created.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
