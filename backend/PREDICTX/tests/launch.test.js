import net from 'node:net';
import { describe, expect, it } from 'vitest';
import nodemailer from 'nodemailer';
import { passwordResetEmail } from '../src/services/emailService.js';
import { countView, viewSummary } from '../src/services/pageViewService.js';
import { api, auth, loginAs, makeUser, prisma } from './helpers.js';

/** A minimal mail server on this machine, enough to receive one message over SMTP. */
function mailCatcher() {
  const received = [];
  const server = net.createServer((socket) => {
    let data = false;
    let body = '';
    socket.write('220 local ready\r\n');
    socket.on('data', (chunk) => {
      const text = chunk.toString();
      if (data) {
        body += text;
        if (body.includes('\r\n.\r\n')) {
          data = false;
          received.push(body);
          socket.write('250 queued\r\n');
        }
        return;
      }
      for (const line of text.split('\r\n').filter(Boolean)) {
        if (/^DATA/i.test(line)) { data = true; socket.write('354 send it\r\n'); } else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, received, port: server.address().port })));
}

describe('mail delivery', () => {
  it('hands a password-reset message to a mail server over SMTP', async () => {
    const { server, received, port } = await mailCatcher();
    const transport = nodemailer.createTransport({ host: '127.0.0.1', port, secure: false, ignoreTLS: true });
    const link = 'https://example.test/reset-password?token=abc123';
    await transport.sendMail({ from: 'TUSKY <no-reply@example.test>', to: 'someone@example.test', ...passwordResetEmail('Sam', link) });
    server.close();
    const message = received[0].replace(/=\r\n/g, '').replace(/=3D/g, '=');
    expect(message).toContain('Reset your TUSKY password');
    expect(message).toContain(link);
  });

  it('the reset link points at a normal page address', async () => {
    const { sentMail } = await import('../src/services/emailService.js');
    const user = await makeUser();
    await api().post('/api/auth/forgot-password').send({ email: user.email });
    await new Promise((r) => setTimeout(r, 200));
    const mail = sentMail.find((m) => m.to === user.email);
    expect(mail.text).toContain('/reset-password?token=');
    expect(mail.text).not.toContain('/#/');
  });
});

describe('page views', () => {
  it('counts public pages only and stores nothing about the visitor', async () => {
    const day = new Date('2031-03-04T10:00:00Z');
    await prisma.pageView.deleteMany({ where: { day: new Date('2031-03-04') } });
    expect(await countView('/pricing', day)).toBe(true);
    expect(await countView('/pricing', day)).toBe(true);
    expect(await countView('/user/wallet', day)).toBe(false);
    expect(await countView('/<script>', day)).toBe(false);
    const rows = await prisma.pageView.findMany({ where: { day: new Date('2031-03-04') } });
    expect(rows).toEqual([{ day: new Date('2031-03-04'), path: '/pricing', views: 2 }]);
    expect((await viewSummary(1, day)).total).toBe(2);
  });

  it('is open to post to and admin-only to read', async () => {
    expect((await api().post('/api/hit').send({ path: '/news' })).status).toBe(204);
    expect((await api().post('/api/hit').send({ path: { nested: 1 } })).status).toBe(204);
    expect((await api().get('/api/admin/page-views')).status).toBe(401);
    const admin = await loginAs(await makeUser({ role: 'ADMIN' }), 'admin');
    const res = await api().get('/api/admin/page-views').set(auth(admin.token));
    expect(res.body.data.total).toBeGreaterThan(0);
  });
});
