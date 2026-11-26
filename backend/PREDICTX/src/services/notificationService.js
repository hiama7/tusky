// Notifications, user activity timeline and admin audit log.
// Each helper accepts an optional Prisma transaction client so it can run
// atomically with the operation that triggered it.
import { prisma } from '../config/database.js';
import { logger } from '../utils/logger.js';

export function notify(userId, { title, message, type = 'INFO' }, db = prisma) {
  return db.notification.create({ data: { userId, title, message, notificationType: type } });
}

export function activity(userId, kind, description, db = prisma) {
  return db.activityLog.create({ data: { userId, kind, description: description.slice(0, 255) } });
}

/** Records an administrative action. Never throws (logging must not break the request). */
export async function adminLog(req, action, description, { entityType, entityId } = {}, db = prisma) {
  try {
    await db.adminLog.create({
      data: {
        adminId: req.admin.id,
        action,
        entityType,
        entityId: entityId === undefined ? null : String(entityId),
        description: description.slice(0, 500),
        ipAddress: (req.ip || '').slice(0, 45),
      },
    });
  } catch (err) {
    logger.error({ err, action }, 'Failed to write admin log');
  }
}
