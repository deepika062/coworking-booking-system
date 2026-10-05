import { ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';
import { config } from '../config.js';

/**
 * Every error response has the same shape:
 *   { "error": { "code": "SOME_CODE", "message": "Human readable", "details": [...]? } }
 */
function send(res, status, code, message, details) {
  const body = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  res.status(status).json(body);
}

export function notFoundHandler(req, res) {
  send(res, 404, 'ROUTE_NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`);
}

// Express recognises error handlers by their 4-argument signature.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return send(res, err.status, err.code, err.message, err.details);
  }

  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return send(res, 400, 'VALIDATION_ERROR', 'Request validation failed', details);
  }

  // Malformed JSON body (thrown by express.json()).
  if (err.type === 'entity.parse.failed') {
    return send(res, 400, 'INVALID_JSON', 'Request body is not valid JSON');
  }
  if (err.type === 'entity.too.large') {
    return send(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }

  // PostgreSQL errors that map to client mistakes / conflicts.
  switch (err.code) {
    case '23P01': // exclusion_violation -> our bookings_no_overlap constraint
      return send(res, 409, 'BOOKING_CONFLICT', 'This time slot overlaps an existing booking for this space');
    case '23505': // unique_violation
      return send(res, 409, 'DUPLICATE', 'A record with the same unique value already exists');
    case '23503': // foreign_key_violation
      return send(res, 409, 'REFERENCE_CONFLICT', 'Operation conflicts with related records');
    case '22P02': // invalid_text_representation (e.g. bad uuid that slipped past validation)
    case '22007': // invalid_datetime_format
    case '22008': // datetime_field_overflow
      return send(res, 400, 'BAD_REQUEST', 'Invalid input value');
    default:
      break;
  }

  console.error('[unhandled error]', err);
  const message = config.env === 'production' ? 'Something went wrong' : err.message || 'Something went wrong';
  return send(res, 500, 'INTERNAL_ERROR', message);
}
