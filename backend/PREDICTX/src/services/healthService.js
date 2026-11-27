// Is the site still fresh and are the scheduled jobs working? Used by the admin
// dashboard and by the daily run, which alerts when something is wrong.
import { readFileSync } from 'node:fs';
import { prisma } from '../config/database.js';

const STATE = new URL('../../../../ops/state/', import.meta.url);
const DAY = 86_400_000;

export function readState(name, base = STATE) {
  try {
    return JSON.parse(readFileSync(new URL(`${name}.json`, base), 'utf8'));
  } catch {
    return null;
  }
}

const check = (name, level, message) => ({ name, level, message });
const age = (iso, now) => (now - new Date(iso).getTime()) / DAY;
const days = (n) => `${Math.floor(n)} day${Math.floor(n) === 1 ? '' : 's'}`;

/** Pure judgement over the facts, so it can be tested without waiting for time to pass. */
export function assess({ furthest, drafts, unsettled, heldRefunds, jobs, backup }, now = Date.now()) {
  const checks = [];

  const ahead = furthest ? (new Date(furthest).getTime() - now) / DAY : 0;
  const waiting = drafts ? ` ${drafts} imported matches are waiting to be published.` : '';
  if (ahead <= 0) checks.push(check('fixtures', 'fail', `No upcoming match is published.${waiting}`));
  else if (ahead < 5) checks.push(check('fixtures', 'warn', `Published matches run out in ${days(ahead)}.${waiting}`));
  else checks.push(check('fixtures', 'ok', `Published matches reach ${days(ahead)} ahead.`));

  checks.push(unsettled
    ? check('results', 'warn', `${unsettled} matches that started over 3 days ago have no result.`)
    : check('results', 'ok', 'Finished matches have results.'));

  if (heldRefunds) checks.push(check('refunds', 'warn', `${heldRefunds} refunds have been pending for over a day. Check the Razorpay dashboard.`));

  const failed = jobs?.steps?.filter((s) => !s.ok && s.name !== 'health').map((s) => s.name) || [];
  if (!jobs) checks.push(check('jobs', 'warn', 'The daily run has never run on this server.'));
  else if (failed.length) checks.push(check('jobs', 'fail', `Last daily run failed at: ${failed.join(', ')}.`));
  else if (age(jobs.finishedAt, now) > 1.5) checks.push(check('jobs', 'warn', `The daily run last ran ${days(age(jobs.finishedAt, now))} ago.`));
  else checks.push(check('jobs', 'ok', 'The last daily run succeeded.'));

  if (!backup) checks.push(check('backup', 'warn', 'No backup has been made.'));
  else if (backup.problems?.length) checks.push(check('backup', 'fail', 'The last backup was incomplete.'));
  else if (age(backup.finishedAt, now) > 2) checks.push(check('backup', 'warn', `The last backup is ${days(age(backup.finishedAt, now))} old.`));
  else checks.push(check('backup', 'ok', 'Backed up recently.'));

  const worst = ['fail', 'warn'].find((l) => checks.some((c) => c.level === l)) || 'ok';
  return { status: worst, checks };
}

export async function systemHealth() {
  const now = new Date();
  const visible = { published: true, archivedAt: null };
  const [furthest, drafts, unsettled, heldRefunds] = await Promise.all([
    prisma.match.findFirst({ where: { ...visible, startsAt: { gt: now }, status: { in: ['UPCOMING', 'POSTPONED'] } }, orderBy: { startsAt: 'desc' }, select: { startsAt: true } }),
    prisma.match.count({ where: { published: false, archivedAt: null, isDemo: false, externalId: { startsWith: 'ml:' }, startsAt: { gt: now } } }),
    prisma.match.count({ where: { ...visible, isDemo: false, startsAt: { lt: new Date(now - 3 * DAY) }, status: { in: ['UPCOMING', 'LIVE'] }, result: null } }),
    prisma.refund.count({ where: { refundStatus: 'PENDING', createdAt: { lt: new Date(now - DAY) } } }),
  ]);
  return assess({ furthest: furthest?.startsAt, drafts, unsettled, heldRefunds, jobs: readState('jobs'), backup: readState('backup') }, now.getTime());
}
