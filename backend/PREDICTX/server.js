// Entry point: connects to MySQL, starts the HTTP server and shuts down cleanly.
import { env } from './src/config/env.js';
import { prisma } from './src/config/database.js';
import { createApp } from './src/app.js';
import { logger } from './src/utils/logger.js';
import { syncMlPredictions } from './src/services/mlSyncService.js';

async function main() {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`PREDICTX API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
    if (!env.razorpayEnabled) logger.warn('Razorpay keys are not set — online payments are disabled until RAZORPAY_KEY_ID/SECRET are configured.');
  });

  // Optional automatic ML sync (never overlapping; a failure is logged and retried next time).
  let syncing = false;
  if (env.ML_SYNC_INTERVAL_MINUTES > 0 && env.ML_DATABASE_URL) {
    setInterval(async () => {
      if (syncing) return;
      syncing = true;
      try {
        logger.info({ stats: await syncMlPredictions({ publish: env.ML_SYNC_PUBLISH }) }, 'ML sync done');
      } catch (err) {
        logger.error({ err }, 'ML sync failed');
      } finally {
        syncing = false;
      }
    }, env.ML_SYNC_INTERVAL_MINUTES * 60_000).unref();
  }

  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down`);
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
