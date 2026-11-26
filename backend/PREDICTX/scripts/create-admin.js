// =============================================================================
// Protected CLI: create or promote an administrator.
//   npm run create-admin -- --email admin@yourdomain.com --name "Jane Admin"
// The password is read from the ADMIN_PASSWORD environment variable, or typed
// interactively (hidden) when that is not set. It is never accepted as a
// command-line argument (which would end up in shell history).
// =============================================================================
import readline from 'node:readline';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { adapterConfig } from '../src/config/database.js';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

async function main() {
  const email = (arg('email') || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const name = arg('name') || process.env.ADMIN_NAME || 'Platform Admin';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Provide a valid --email (or ADMIN_EMAIL).');

  let password = process.env.ADMIN_PASSWORD || '';
  if (!password) password = await askHidden('New admin password (min 10 chars, letters + numbers): ');
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error('Password must be at least 10 characters and include letters and numbers.');
  }

  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(adapterConfig(process.env.DATABASE_URL)) });
  try {
    const passwordHash = await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS || 12));
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data: { role: 'ADMIN', passwordHash, accountStatus: 'ACTIVE' } });
      await prisma.refreshToken.updateMany({ where: { userId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } });
      console.log(`✓ ${email} is now an administrator (password reset, old sessions revoked).`);
    } else {
      await prisma.user.create({ data: { fullName: name, email, passwordHash, role: 'ADMIN', emailVerifiedAt: new Date() } });
      console.log(`✓ Administrator ${email} created.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exitCode = 1;
});
