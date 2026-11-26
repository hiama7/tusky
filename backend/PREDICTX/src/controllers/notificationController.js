// User notifications (always scoped to req.user — users can't read others').
import { prisma } from '../config/database.js';
import { ApiError, ok } from '../utils/apiResponse.js';
import * as S from '../services/serializers.js';

export async function list(req, res) {
  const rows = await prisma.notification.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 30 });
  const unread = await prisma.notification.count({ where: { userId: req.user.id, isRead: false } });
  ok(res, { items: rows.map(S.notification), unread });
}

export async function markRead(req, res) {
  const { count } = await prisma.notification.updateMany({ where: { id: req.valid.params.id, userId: req.user.id }, data: { isRead: true } });
  if (!count) throw ApiError.notFound('Notification not found');
  ok(res, {}, 'Marked as read');
}

export async function markAllRead(req, res) {
  const { count } = await prisma.notification.updateMany({ where: { userId: req.user.id, isRead: false }, data: { isRead: true } });
  ok(res, { updated: count }, 'All notifications marked as read');
}
