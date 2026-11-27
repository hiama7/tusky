// Imports headlines as drafts (the same as Admin > News > Import from provider).
//   npm run news:import
import { prisma } from '../src/config/database.js';
import { importNews } from '../src/services/sportsDataService.js';

try {
  console.log(await importNews());
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
