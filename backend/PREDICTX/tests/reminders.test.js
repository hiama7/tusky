import { describe, expect, it } from 'vitest';
import { api, auth, loginAs, makeMatch, makeUser, prisma } from './helpers.js';

async function owner({ inHours }) {
  const m = await makeMatch();
  await prisma.match.update({ where: { id: m.id }, data: { startsAt: new Date(Date.now() + inHours * 3600_000) } });
  const user = await makeUser();
  const { token } = await loginAs(user);
  const txn = await prisma.transaction.create({ data: { transactionReference: `R-${m.id}-${user.id}`, userId: user.id, transactionType: 'PREDICTION', amount: '49.00', matchId: m.id, paymentStatus: 'CAPTURED' } });
  await prisma.purchase.create({ data: { userId: user.id, matchId: m.id, transactionId: txn.id, amount: '49.00' } });
  const reminders = async () => (await api().get('/api/notifications').set(auth(token))).body.data.items.filter((n) => n.title.startsWith('Starts soon'));
  return { reminders };
}

describe('match start reminders', () => {
  it('appear once for an unlocked match starting within a day, even with simultaneous requests', async () => {
    const { reminders } = await owner({ inHours: 5 });
    await Promise.all([reminders(), reminders(), reminders()]);
    expect(await reminders()).toHaveLength(1);
  });

  it('do not appear for matches further off or already started', async () => {
    expect(await (await owner({ inHours: 60 })).reminders()).toHaveLength(0);
    expect(await (await owner({ inHours: -1 })).reminders()).toHaveLength(0);
  });
});
