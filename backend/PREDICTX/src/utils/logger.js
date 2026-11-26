// Structured JSON logs to stdout (redirect or ship to a collector in production).
// Sensitive fields are redacted so tokens and passwords never reach log files.
import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: ['req.headers.authorization', 'req.headers.cookie', 'password', '*.password', '*.passwordHash', '*.token'],
});
