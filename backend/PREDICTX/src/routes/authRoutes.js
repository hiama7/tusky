// /api/auth — user + admin authentication.
import { Router } from 'express';
import * as c from '../controllers/authController.js';
import { requireUser } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/adminMiddleware.js';
import { validate } from '../middleware/validationMiddleware.js';
import { accountLimiter, loginLimiter, passwordChangeLimiter, passwordResetLimiter, registerLimiter } from '../middleware/rateLimitMiddleware.js';
import { requireTrustedOrigin } from '../middleware/securityMiddleware.js';
import { auth } from '../validators/index.js';

const r = Router();

r.post('/register', registerLimiter, validate({ body: auth.register }), c.register);
r.post('/login', loginLimiter, accountLimiter, validate({ body: auth.login }), c.login);
r.post('/refresh', requireTrustedOrigin, c.refresh);
r.post('/logout', requireTrustedOrigin, c.logout);
r.get('/me', requireUser, c.me);
r.patch('/me', requireUser, validate({ body: auth.profile }), c.updateProfile);
r.post('/change-password', passwordChangeLimiter, requireUser, validate({ body: auth.changePassword }), c.changePassword);
r.post('/forgot-password', passwordResetLimiter, validate({ body: auth.forgot }), c.forgotPassword);
r.post('/reset-password', passwordResetLimiter, validate({ body: auth.reset }), c.resetPassword);

// Separate admin session (own cookie path + signing secret).
r.post('/admin/login', loginLimiter, accountLimiter, validate({ body: auth.adminLogin }), c.adminLogin);
r.post('/admin/refresh', requireTrustedOrigin, c.adminRefresh);
r.post('/admin/logout', requireTrustedOrigin, c.adminLogout);
r.get('/admin/me', requireAdmin, c.adminMe);
r.post('/admin/change-password', passwordChangeLimiter, requireAdmin, validate({ body: auth.changePassword }), c.adminChangePassword);

// two-factor sign-in (setup and removal share the password-guessing limit)
r.get('/admin/2fa', requireAdmin, c.twoFactorStatus);
r.post('/admin/2fa/setup', passwordChangeLimiter, requireAdmin, validate({ body: auth.twoFactorSetup }), c.twoFactorSetup);
r.post('/admin/2fa/enable', passwordChangeLimiter, requireAdmin, validate({ body: auth.twoFactorEnable }), c.twoFactorEnable);
r.post('/admin/2fa/disable', passwordChangeLimiter, requireAdmin, validate({ body: auth.twoFactorDisable }), c.twoFactorDisable);

export default r;
