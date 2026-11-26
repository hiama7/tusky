// Consistent JSON envelopes and a typed error class used across the API.
//   success: { success: true,  message, data }
//   error:   { success: false, message, errors: [] }

export function ok(res, data = {}, message = 'Operation completed successfully', status = 200) {
  return res.status(status).json({ success: true, message, data });
}

export const created = (res, data, message = 'Created successfully') => ok(res, data, message, 201);

export class ApiError extends Error {
  constructor(status, message, errors = []) {
    super(message);
    this.status = status;
    this.errors = errors;
  }

  static badRequest(msg = 'Bad request', errors) { return new ApiError(400, msg, errors); }
  static unauthorized(msg = 'Authentication required') { return new ApiError(401, msg); }
  static forbidden(msg = 'You do not have permission to perform this action') { return new ApiError(403, msg); }
  static notFound(msg = 'Resource not found') { return new ApiError(404, msg); }
  static conflict(msg = 'Conflict', errors) { return new ApiError(409, msg, errors); }
  static validation(errors, msg = 'Validation failed') { return new ApiError(422, msg, errors); }
  static unavailable(msg = 'Service unavailable') { return new ApiError(503, msg); }
}

/** Parses ?page & ?limit into Prisma skip/take plus a pagination-meta builder. */
export function paginate(query, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit));
  return {
    skip: (page - 1) * limit,
    take: limit,
    meta: (total) => ({ page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }),
  };
}
