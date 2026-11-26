// Copy the ML service's predictions into PREDICTX.
//   npm run ml:sync                  import as drafts (publish from the admin console)
//   npm run ml:sync -- --publish     publish matches and predictions
//   npm run ml:sync -- --days 7
import { prisma } from '../src/config/database.js';
import { syncMlPredictions } from '../src/services/mlSyncService.js';

const args = process.argv.slice(2);
const days = args.includes('--days') ? Number(args[args.indexOf('--days') + 1]) : undefined;

try {
  if (days !== undefined && !(Number.isInteger(days) && days >= 1 && days <= 60)) throw new Error('--days must be a whole number from 1 to 60');
  console.log(await syncMlPredictions({ publish: args.includes('--publish'), days }));
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
