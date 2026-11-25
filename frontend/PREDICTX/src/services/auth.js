// =========================================================
// auth.js — DEMO-ONLY authentication. Not secure, not a real account system.
// Stage 2 endpoints:
//   POST /api/auth/register.php   POST /api/auth/login.php
//   POST /api/auth/logout.php     GET  /api/auth/me.php
//   POST /api/admin/login.php     (separate admins table + PHP session)
// =========================================================
import { simulate, DemoError } from './api';
import { read, write, remove, uid } from './storage';
import { table, save, update } from './db';
import { demoHash } from './hash';
import { DEMO_ADMIN_LOGIN } from '../data/demo/users';
import { addNotification, logActivity } from './notifications';

const publicUser = (u) => (u ? { id: u.id, name: u.name, email: u.email, phone: u.phone, registeredAt: u.registeredAt, status: u.status, favourites: u.favourites || [] } : null);

/** Synchronous read of the logged-in demo user (used by route guards). */
export function currentUser() {
  const id = read('session');
  if (!id) return null;
  // A blocked account loses its demo session immediately.
  if ((read('blockedUsers') || []).includes(id)) return null;
  return publicUser(table('accounts').find((a) => a.id === id));
}

export function register({ name, email, phone, password }) {
  return simulate(() => {
    const accounts = table('accounts');
    const normalized = email.trim().toLowerCase();
    if (accounts.some((a) => a.email === normalized)) throw new DemoError('An account with this email already exists.');
    const user = {
      id: uid('U'),
      name: name.trim(),
      email: normalized,
      phone: phone.trim(),
      passwordHash: demoHash(password),
      registeredAt: new Date().toISOString(),
      status: 'Active',
      favourites: [],
    };
    save('accounts', [...accounts, user]);
    addNotification(user.id, { title: 'Welcome to TUSKY!', body: 'Your free trial prediction is ready to use.', type: 'success' });
    logActivity(user.id, 'Created a TUSKY demo account', 'account');
    return publicUser(user);
  }, 500);
}

export function login({ email, password, remember }) {
  return simulate(() => {
    const normalized = email.trim().toLowerCase();
    const user = table('accounts').find((a) => a.email === normalized);
    if (!user || user.passwordHash !== demoHash(password)) throw new DemoError('Incorrect email or password.');
    // Admin "block" also applies to registered demo accounts.
    const blocked = (read('blockedUsers') || []).includes(user.id);
    if (blocked || user.status === 'Blocked') throw new DemoError('This account has been blocked by an administrator (demo).');
    write('session', user.id, { session: !remember });
    logActivity(user.id, 'Logged in', 'account');
    return publicUser(user);
  }, 500);
}

export function logout() {
  remove('session');
  return Promise.resolve();
}

export function forgotPassword(email) {
  return simulate(() => ({ message: `Demo only: in Stage 2 a reset link would be emailed to ${email}.` }), 400);
}

export function updateProfile(userId, changes) {
  return simulate(() => {
    let updated;
    update('accounts', (rows) => rows.map((a) => (a.id === userId ? (updated = { ...a, ...changes }) : a)));
    logActivity(userId, 'Updated profile details', 'account');
    return publicUser(updated);
  });
}

export function changePassword(userId, current, next) {
  return simulate(() => {
    const user = table('accounts').find((a) => a.id === userId);
    if (!user || user.passwordHash !== demoHash(current)) throw new DemoError('Current password is incorrect.');
    update('accounts', (rows) => rows.map((a) => (a.id === userId ? { ...a, passwordHash: demoHash(next) } : a)));
    logActivity(userId, 'Changed password', 'account');
    return true;
  });
}

/* ---------------- Admin (separate session) ---------------- */
export function currentAdmin() {
  return read('adminSession');
}

export function adminLogin({ email, password }) {
  return simulate(() => {
    if (email.trim().toLowerCase() !== DEMO_ADMIN_LOGIN.email || password !== DEMO_ADMIN_LOGIN.password) {
      throw new DemoError('Invalid admin credentials.');
    }
    const admin = { name: 'Super Admin', email: DEMO_ADMIN_LOGIN.email, role: 'Administrator' };
    write('adminSession', admin, { session: true });
    return admin;
  }, 500);
}

export function adminLogout() {
  remove('adminSession');
  return Promise.resolve();
}
