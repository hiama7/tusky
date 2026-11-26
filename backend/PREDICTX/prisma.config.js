// Prisma CLI configuration (Prisma 7). Loads backend/.env when present.
import { defineConfig } from 'prisma/config';

try {
  process.loadEnvFile('.env');
} catch {
  /* .env is optional — variables may come from the real environment */
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.js',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
