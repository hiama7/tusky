// Tests run against TEST_DATABASE_URL (a separate database that is reset before the run).
// Razorpay HTTP calls are mocked per test file; signature verification uses real HMACs
// with the test secrets below.
import { defineConfig } from 'vitest/config';

try {
  process.loadEnvFile('.env');
} catch {
  /* CI can provide the variables directly */
}

export default defineConfig({
  test: {
    globalSetup: './tests/globalSetup.js',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      RATE_LIMIT_DISABLED: 'true',
      BCRYPT_ROUNDS: '4',
      JWT_ACCESS_SECRET: 'test-user-access-secret-0123456789abcdef0123456789',
      JWT_ADMIN_ACCESS_SECRET: 'test-admin-access-secret-0123456789abcdef012345678',
      RAZORPAY_KEY_ID: 'rzp_test_unit_tests',
      RAZORPAY_KEY_SECRET: 'unit_test_key_secret',
      RAZORPAY_WEBHOOK_SECRET: 'unit_test_webhook_secret',
      SMTP_HOST: '',
      ML_DATABASE_URL: '', // tests inject their own ML data
      FOOTBALL_DATA_API_KEY: '', // no real calls from tests
      GNEWS_API_KEY: '',
      NEWS_PROVIDER: 'none',
      APP_URL: 'http://localhost:5173',
      CORS_ORIGINS: 'http://localhost:5173',
    },
  },
});
