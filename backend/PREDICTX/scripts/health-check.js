// Prints the site's health and alerts on anything wrong.  npm run health
// Exit code 1 when a check fails (warnings alone exit 0).
import { prisma } from '../src/config/database.js';
import { systemHealth } from '../src/services/healthService.js';
import { sendAlert } from '../src/utils/alert.js';

try {
  const health = await systemHealth();
  // the daily run judges its own steps; here only the site's state matters
  const checks = health.checks.filter((c) => c.name !== 'jobs');
  for (const c of checks) console.log(`${c.level.toUpperCase().padEnd(4)} ${c.name}: ${c.message}`);
  const bad = checks.filter((c) => c.level !== 'ok');
  if (bad.length) await sendAlert(bad.map((c) => c.message).join(' '));
  if (checks.some((c) => c.level === 'fail')) process.exitCode = 1;
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
