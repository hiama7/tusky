// Zod request validation. Parsed (and coerced) values are placed on req.valid.
// Express 5 makes req.query read-only, so we never overwrite the originals.
import { ApiError } from '../utils/apiResponse.js';

export function validate({ body, query, params } = {}) {
  return (req, _res, next) => {
    const errors = [];
    const valid = {};
    for (const [key, schema] of Object.entries({ body, query, params })) {
      if (!schema) continue;
      const result = schema.safeParse(req[key] ?? {});
      if (result.success) valid[key] = result.data;
      else {
        for (const issue of result.error.issues) {
          errors.push({ field: [key === 'body' ? null : key, ...issue.path].filter((p) => p !== null).join('.') || key, message: issue.message });
        }
      }
    }
    if (errors.length) throw ApiError.validation(errors);
    req.valid = { ...(req.valid || {}), ...valid };
    next();
  };
}
