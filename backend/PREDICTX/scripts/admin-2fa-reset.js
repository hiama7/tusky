// Server-side recovery: switches two-factor sign-in off for one administrator who
// has lost both the authenticator app and the recovery codes.
//   npm run admin:2fa-reset -- --email admin@yourdomain.com
import { Prisma } from '@prisma/client';
import { prisma } from '../src/config/database.js';

const i = process.argv.indexOf('--email');
const email = i > -1 ? String(process.argv[i + 1] || '').trim().toLowerCase() : '';

try {
  const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
  if (!user || user.role !== 'ADMIN') {
    console.error('✗ Provide --email of an existing administrator.');
    process.exitCode = 1;
  } else {
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, totpRecovery: Prisma.DbNull } }),
      prisma.refreshToken.updateMany({ where: { userId: user.id, scope: 'admin', revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    console.log(`✓ Two-factor sign-in is off for ${email}; admin sessions were signed out.`);
  }
} finally {
  await prisma.$disconnect();
}
