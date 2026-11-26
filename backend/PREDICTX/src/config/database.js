// Single shared Prisma client using the MariaDB/MySQL driver adapter (Prisma 7).
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { env } from './env.js';

/** Converts mysql://user:pass@host:port/db into the driver's connection options. */
export function adapterConfig(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    connectionLimit: 10,
    // MySQL 8 uses caching_sha2_password; lets the driver fetch the server's RSA key.
    allowPublicKeyRetrieval: true,
  };
}

export const prisma = new PrismaClient({ adapter: new PrismaMariaDb(adapterConfig(env.DATABASE_URL)) });
