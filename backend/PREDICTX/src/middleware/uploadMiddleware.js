// Secure image uploads: size-limited memory upload, real content-type detection
// from the file's bytes (not the client-supplied MIME or extension), random file names.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { env } from '../config/env.js';
import { ApiError } from '../utils/apiResponse.js';

export const UPLOAD_ROOT = path.resolve('uploads');
const ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const memory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_MB * 1024 * 1024, files: 1, fields: 30 },
});

/**
 * Accepts one optional image field and stores it under uploads/<folder>/.
 * On success sets req.uploadedFile = "/uploads/<folder>/<random>.<ext>".
 */
export function imageUpload(field, folder) {
  return [
    memory.single(field),
    async (req, _res, next) => {
      if (!req.file) return next();
      const type = await fileTypeFromBuffer(req.file.buffer);
      if (!type || !ALLOWED[type.mime]) {
        throw ApiError.validation([{ field, message: 'Only JPEG, PNG or WebP images are allowed' }], 'Invalid file type');
      }
      const dir = path.join(UPLOAD_ROOT, folder);
      await fs.mkdir(dir, { recursive: true });
      const name = `${crypto.randomUUID()}.${ALLOWED[type.mime]}`;
      await fs.writeFile(path.join(dir, name), req.file.buffer, { flag: 'wx' });
      req.uploadedFile = `/uploads/${folder}/${name}`;
      next();
    },
  ];
}

/** Deletes a previously uploaded file (ignores paths outside the uploads folder). */
export async function removeUpload(publicPath) {
  if (!publicPath?.startsWith('/uploads/')) return;
  const full = path.resolve(UPLOAD_ROOT, publicPath.replace(/^\/uploads\//, ''));
  if (!full.startsWith(UPLOAD_ROOT + path.sep)) return;
  await fs.rm(full, { force: true });
}
