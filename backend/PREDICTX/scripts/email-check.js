// Sends one test message through the configured mail server.
//   npm run email:check -- --to you@yourdomain.com
import nodemailer from 'nodemailer';
import { env } from '../src/config/env.js';

const i = process.argv.indexOf('--to');
const to = i > -1 ? process.argv[i + 1] : '';

try {
  if (!env.SMTP_HOST) throw new Error('SMTP_HOST is empty: no mail server is configured, so nothing can be sent.');
  if (!to) throw new Error('Say where to send it: --to you@yourdomain.com');
  const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined });
  await transport.verify();
  const info = await transport.sendMail({ from: env.MAIL_FROM, to, subject: 'TUSKY mail check', text: 'If you can read this, password-reset mail will work.' });
  console.log(`Accepted by the mail server (${info.response}). Check the inbox and the spam folder.`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
