// Tells a person something is wrong, through ALERT_WEBHOOK_URL (Slack, Discord and
// most chat tools accept this). Without it, alerts are only logged.
import { env } from '../config/env.js';
import { logger } from './logger.js';

const QUIET_MS = 15 * 60_000;
const lastSent = new Map();

/** `key` groups repeats: the same key is sent at most once in 15 minutes. */
export async function sendAlert(message, key = message) {
  const now = Date.now();
  if (now - (lastSent.get(key) || 0) < QUIET_MS) return false;
  lastSent.set(key, now);
  logger.warn({ alert: message }, 'Alert');
  if (!env.ALERT_WEBHOOK_URL) return false;
  try {
    const res = await fetch(env.ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `[TUSKY] ${message}`, content: `[TUSKY] ${message}` }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch (err) {
    logger.error({ reason: err.name }, 'Alert could not be sent'); // the URL is a secret
    return false;
  }
}

export const resetAlertHistory = () => lastSent.clear();
