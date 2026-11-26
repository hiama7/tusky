// /api/auth — user + admin authentication.
import { Router } from 'express';
import * as c from '../controllers/authController.js';
import { requireUser } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/adminMiddleware.js';
import { validate } from '../middleware/validationMiddleware.js';
import { loginLimiter, passwordResetLimiter, registerLimiter } from '../middleware/rateLimitMiddleware.js';
import { requireTrustedOrigin } from '../middleware/securityMiddleware.js';
import { auth } from '../validators/index.js';

const r = Router();

r.post('/register', registerLimiter, validate({ body: auth.register }), c.register);
r.post('/login', loginLimiter, validate({ body: auth.login }), c.login);
r.post('/refresh', requireTrustedOrigin, c.refresh);
r.post('/logout', requireTrustedOrigin, c.logout);
r.get('/me', requireUser, c.me);
r.patch('/me', requireUser, validate({ body: auth.profile }), c.updateProfile);
r.post('/change-password', requireUser, validate({ body: auth.changePassword }), c.changePassword);
r.post('/forgot-password', passwordResetLimiter, validate({ body: auth.forgot }), c.forgotPassword);
r.post('/reset-password', passwordResetLimiter, validate({ body: auth.reset }), c.resetPassword);

// Separate admin session (own cookie path + signing secret).
r.post('/admin/login', loginLimiter, validate({ body: auth.login }), c.adminLogin);
r.post('/admin/refresh', requireTrustedOrigin, c.adminRefresh);
r.post('/admin/logout', requireTrustedOrigin, c.adminLogout);
r.get('/admin/me', requireAdmin, c.adminMe);
r.post('/admin/change-password', requireAdmin, validate({ body: auth.changePassword }), c.adminChangePassword);

export default r;
