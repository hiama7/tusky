// Transactional email via Nodemailer.
// Without SMTP settings (development/test) messages are logged instead of sent,
// so password-reset links can be followed locally. Production requires SMTP.
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let transporter;
export const sentMail = []; // last messages (test/dev inspection only)

function getTransport() {
  if (transporter) return transporter;
  if (env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  } else {
    if (env.isProd) throw new Error('SMTP is not configured (SMTP_HOST is empty).');
    transporter = nodemailer.createTransport({ jsonTransport: true });
  }
  return transporter;
}

export async function sendMail({ to, subject, text, html }) {
  const info = await getTransport().sendMail({ from: env.MAIL_FROM, to, subject, text, html });
  if (!env.SMTP_HOST) {
    sentMail.unshift({ to, subject, text });
    sentMail.length = Math.min(sentMail.length, 20);
    logger.info({ to, subject, text }, 'Email (dev transport — not actually sent)');
  }
  return info;
}

export function passwordResetEmail(name, link) {
  const text = `Hi ${name},\n\nWe received a request to reset your TUSKY password. Use the link below within 30 minutes:\n\n${link}\n\nIf you didn't request this, you can ignore this email — your password won't change.\n`;
  const html = `<p>Hi ${escapeHtml(name)},</p><p>We received a request to reset your TUSKY password. This link is valid for 30 minutes:</p><p><a href="${link}">Reset my password</a></p><p>If you didn't request this, you can ignore this email.</p>`;
  return { subject: 'Reset your TUSKY password', text, html };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
