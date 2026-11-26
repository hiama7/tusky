// HTTP handlers for /api/auth (user + admin sessions).
import * as auth from '../services/authService.js';
import { created, ok } from '../utils/apiResponse.js';

export async function register(req, res) {
  const user = await auth.register(req.valid.body);
  created(res, { user }, 'Account created. You can now log in.');
}

export async function login(req, res) {
  ok(res, await auth.login(req.valid.body, req, res), 'Logged in successfully');
}

export async function refresh(req, res) {
  ok(res, await auth.refresh('user', req, res), 'Session refreshed');
}

export async function logout(req, res) {
  await auth.logout('user', req, res);
  ok(res, {}, 'Logged out');
}

export async function me(req, res) {
  ok(res, { user: await auth.getProfile(req.user.id) });
}

export async function updateProfile(req, res) {
  ok(res, { user: await auth.updateProfile(req.user.id, req.valid.body) }, 'Profile updated');
}

export async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.valid.body;
  ok(res, await auth.changePassword(req.user.id, currentPassword, newPassword, req, res), 'Password changed. Other devices have been signed out.');
}

export async function forgotPassword(req, res) {
  await auth.forgotPassword(req.valid.body.email);
  ok(res, {}, 'If an account exists for that email, a reset link has been sent.');
}

export async function resetPassword(req, res) {
  await auth.resetPassword(req.valid.body.token, req.valid.body.password);
  ok(res, {}, 'Password updated. Please log in with your new password.');
}

// ---- admin session
export async function adminLogin(req, res) {
  ok(res, await auth.adminLogin(req.valid.body, req, res), 'Admin session started');
}

export async function adminRefresh(req, res) {
  ok(res, await auth.refresh('admin', req, res), 'Session refreshed');
}

export async function adminLogout(req, res) {
  await auth.logout('admin', req, res);
  ok(res, {}, 'Admin logged out');
}

export async function adminMe(req, res) {
  ok(res, { user: await auth.getProfile(req.admin.id) });
}

export async function adminChangePassword(req, res) {
  const { currentPassword, newPassword } = req.valid.body;
  ok(res, await auth.changePassword(req.admin.id, currentPassword, newPassword, req, res, 'admin'), 'Password changed. Other sessions have been signed out.');
}
