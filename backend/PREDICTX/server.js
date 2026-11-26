// Entry point: connects to MySQL, starts the HTTP server and shuts down cleanly.
import { env } from './src/config/env.js';
import { prisma } from './src/config/database.js';
import { createApp } from './src/app.js';
import { logger } from './src/utils/logger.js';

async function main() {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`PREDICTX API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
    if (!env.razorpayEnabled) logger.warn('Razorpay keys are not set — online payments are disabled until RAZORPAY_KEY_ID/SECRET are configured.');
  });

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
