// Validates environment variables once at start-up so misconfiguration fails fast.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(5000),
  APP_URL: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ADMIN_ACCESS_SECRET: z.string().min(32, 'JWT_ADMIN_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  RAZORPAY_KEY_ID: z.string().optional().default(''),
  RAZORPAY_KEY_SECRET: z.string().optional().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(''),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  MAIL_FROM: z.string().default('TUSKY <no-reply@example.com>'),
  UPLOAD_MAX_MB: z.coerce.number().positive().default(2),
  SPORTS_DATA_PROVIDER: z.string().default('manual'),
  SPORTS_DATA_API_KEY: z.string().optional().default(''),
  NEWS_PROVIDER: z.string().default('none'),
  NEWS_API_KEY: z.string().optional().default(''),
  // League tables (football-data.org) and headlines (gnews.io). Empty = off.
  FOOTBALL_DATA_API_KEY: z.string().optional().default(''),
  GNEWS_API_KEY: z.string().optional().default(''),
  // The ML service's Postgres database (read-only). Empty = ML sync disabled.
  ML_DATABASE_URL: z.string().optional().default(''),
  ML_PREDICTION_PRICE: z.coerce.number().min(0).max(100000).default(49),
  ML_SYNC_DAYS: z.coerce.number().int().min(1).max(60).default(14),
  // 0 = no automatic sync. Automatic syncs import drafts unless ML_SYNC_PUBLISH=true.
  ML_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(0),
  ML_SYNC_PUBLISH: bool,
  LOG_LEVEL: z.string().default('info'),
  // Reports group revenue by local day; 330 = IST (UTC+5:30).
  REPORT_TZ_OFFSET_MINUTES: z.coerce.number().int().min(-720).max(840).default(330),
  RATE_LIMIT_DISABLED: bool,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  razorpayEnabled: Boolean(parsed.data.RAZORPAY_KEY_ID && parsed.data.RAZORPAY_KEY_SECRET),
};

// The two data-API keys may instead live in the project-root .env. Only these two
// are taken from it (it also holds the ML service's own DATABASE_URL).
if (!env.isTest) {
  try {
    const root = parseEnv(readFileSync(new URL('../../../../.env', import.meta.url), 'utf8'));
    for (const key of ['FOOTBALL_DATA_API_KEY', 'GNEWS_API_KEY']) env[key] ||= root[key] || '';
  } catch {
    /* no root .env */
  }
}

if (env.isProd && env.RATE_LIMIT_DISABLED) {
  throw new Error('RATE_LIMIT_DISABLED must not be set in production.');
}
