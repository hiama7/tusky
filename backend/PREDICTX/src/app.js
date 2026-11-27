// Express application: security middleware, routes, error handling.
// Exported without listening so tests can drive it with Supertest.
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { prisma } from './config/database.js';
import { UPLOAD_ROOT } from './middleware/uploadMiddleware.js';
import { apiLimiter } from './middleware/rateLimitMiddleware.js';
import { errorHandler, notFound } from './middleware/errorMiddleware.js';
import { ok } from './utils/apiResponse.js';
import * as payment from './controllers/paymentController.js';

import authRoutes from './routes/authRoutes.js';
import matchRoutes, { sportRoutes, tournamentRoutes } from './routes/matchRoutes.js';
import predictionRoutes from './routes/predictionRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import newsRoutes from './routes/newsRoutes.js';
import { trackRecord } from './services/trackRecordService.js';
import userRoutes, { trialRoutes } from './routes/userRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Behind one reverse proxy (nginx / a PaaS router) so req.ip and secure cookies work.
  app.set('trust proxy', env.isProd ? 1 : 'loopback');

  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], imgSrc: ["'self'", 'data:'], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(
    cors({
      origin(origin, cb) {
        // Same-origin / server-to-server requests have no Origin header.
        if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    }),
  );

  // Razorpay webhook needs the exact raw bytes for signature verification — mount before JSON parsing.
  app.post('/api/payments/webhook', express.raw({ type: 'application/json', limit: '1mb' }), payment.webhook);

  app.use(express.json({ limit: '200kb' }));
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(cookieParser());
  app.use('/api', apiLimiter);

  // Uploaded images (validated on upload). Served with nosniff via helmet.
  app.use('/uploads', express.static(UPLOAD_ROOT, { fallthrough: false, index: false, dotfiles: 'deny', maxAge: '7d' }));

  app.get('/api/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    ok(res, { status: 'ok', payments: env.razorpayEnabled ? 'razorpay' : 'not-configured', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/sports', sportRoutes);
  app.use('/api/tournaments', tournamentRoutes);
  app.use('/api/matches', matchRoutes);
  app.use('/api/predictions', predictionRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/subscriptions', subscriptionRoutes);
  app.use('/api/news', newsRoutes);
  app.get('/api/track-record', async (req, res) => {
    const sport = /^[a-z0-9-]{1,40}$/i.test(req.query.sport || '') ? String(req.query.sport) : undefined;
    ok(res, await trackRecord({ sport }));
  });
  app.use('/api/users', userRoutes);
  app.use('/api/trial', trialRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
