// "Starts soon" notifications for matches a user has unlocked. Created when the
// user next opens the app, at most once per match. (In-app only: no mail server.)
import { prisma } from '../config/database.js';
import { notify } from './notificationService.js';

export const WINDOW_MS = 24 * 3600_000;

export async function createDueReminders(userId, now = new Date()) {
  const soon = { published: true, archivedAt: null, status: 'UPCOMING', startsAt: { gt: now, lte: new Date(now.getTime() + WINDOW_MS) } };
  const include = { match: { include: { teamA: true, teamB: true } } };
  const [bought, trial] = await Promise.all([
    prisma.purchase.findMany({ where: { userId, purchaseStatus: 'ACTIVE', match: soon }, include }),
    prisma.freeTrial.findFirst({ where: { userId, trialStatus: 'USED', match: soon }, include }),
  ]);
  const matches = new Map([...bought, ...(trial ? [trial] : [])].map((r) => [r.matchId, r.match]));
  if (!matches.size) return 0;

  return prisma.$transaction(async (db) => {
    // two requests arriving together must not both add the same reminder
    await db.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    let created = 0;
    for (const m of matches.values()) {
      const title = `Starts soon: ${m.teamA.name} vs ${m.teamB.name}`.slice(0, 150);
      const since = new Date(m.startsAt.getTime() - 2 * WINDOW_MS);
      if (await db.notification.findFirst({ where: { userId, title, createdAt: { gte: since } } })) continue;
      await notify(userId, { title, message: 'A match you unlocked starts within 24 hours.', type: 'INFO' }, db);
      created += 1;
    }
    return created;
  });
}
