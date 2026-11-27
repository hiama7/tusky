// Authentication API calls (user + admin). Tokens are kept in memory by api.js.
import { get, patch, post, refreshSession, setToken } from './api';

export async function login({ email, password }) {
  const data = await post('/auth/login', { email, password }, { scope: 'none' });
  setToken('user', data.accessToken);
  return data.user;
}

export const register = (form) =>
  post('/auth/register', { fullName: form.name, email: form.email, phone: form.phone, password: form.password, confirmPassword: form.confirm }, { scope: 'none' });

export async function logout() {
  try { await post('/auth/logout', undefined, { scope: 'none' }); } finally { setToken('user', null); }
}

/** Restores a session from the refresh cookie (page reload). */
export async function restore(scope) {
  const data = await refreshSession(scope);
  return data?.user || null;
}

export const me = () => get('/auth/me').then((d) => d.user);
export const updateProfile = (changes) => patch('/auth/me', changes).then((d) => d.user);
export async function changePassword(currentPassword, newPassword, confirmPassword, scope = 'user') {
  const data = await post(scope === 'admin' ? '/auth/admin/change-password' : '/auth/change-password', { currentPassword, newPassword, confirmPassword }, { scope });
  setToken(scope, data.accessToken);
  return data.user;
}
export const forgotPassword = (email) => post('/auth/forgot-password', { email }, { scope: 'none' });
export const resetPassword = (token, password, confirmPassword) => post('/auth/reset-password', { token, password, confirmPassword }, { scope: 'none' });

// ---- admin session
export async function adminLogin({ email, password, code }) {
  const data = await post('/auth/admin/login', { email, password, ...(code ? { code } : {}) }, { scope: 'none' });
  setToken('admin', data.accessToken);
  return data.user;
}

export const twoFactorStatus = () => get('/auth/admin/2fa', { scope: 'admin' });
export const twoFactorSetup = (password) => post('/auth/admin/2fa/setup', { password }, { scope: 'admin' });
export const twoFactorEnable = (code) => post('/auth/admin/2fa/enable', { code }, { scope: 'admin' });
export const twoFactorDisable = (password, code) => post('/auth/admin/2fa/disable', { password, code }, { scope: 'admin' });

export async function adminLogout() {
  try { await post('/auth/admin/logout', undefined, { scope: 'none' }); } finally { setToken('admin', null); }
}
