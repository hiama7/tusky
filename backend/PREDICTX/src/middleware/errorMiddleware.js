// Centralized error handling. Never leaks stack traces or internals in production.
import { Prisma } from '@prisma/client';
import multer from 'multer';
import { env } from '../config/env.js';
import { ApiError } from '../utils/apiResponse.js';
import { logger } from '../utils/logger.js';
import { sendAlert } from '../utils/alert.js';
import { removeUpload } from './uploadMiddleware.js';

export function notFound(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.path}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let message = 'Something went wrong';
  let errors = [];

  if (err instanceof ApiError) {
    ({ status, message } = err);
    errors = err.errors || [];
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      status = 409;
      message = 'A record with these details already exists';
    } else if (err.code === 'P2025') {
      status = 404;
      message = 'Resource not found';
    } else if (err.code === 'P2003') {
      status = 409;
      message = 'This record is referenced by other data and cannot be changed';
    }
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? `File is too large (max ${env.UPLOAD_MAX_MB} MB)` : err.message;
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON body';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request body too large';
  }

  // A file saved before validation failed must not be left behind.
  if (req.uploadedFile) removeUpload(req.uploadedFile).catch(() => {});

  if (status >= 500) logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  // unexpected failures only: a deliberate "service unavailable" is not news
  if (status === 500) sendAlert(`Server error on ${req.method} ${req.baseUrl}${req.route?.path || ''}: ${err.name}`);
  else logger.debug({ status, message, path: req.path }, 'Request error');

  const body = { success: false, message, errors };
  if (!env.isProd && status >= 500) body.debug = err.message;
  res.status(status).json(body);
}
