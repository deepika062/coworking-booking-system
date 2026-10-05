import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AppError } from '../utils/AppError.js';

/**
 * Verifies the short-lived access token from `Authorization: Bearer <token>`.
 * An expired token yields code TOKEN_EXPIRED so the client knows to call /auth/refresh.
 */
export function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(AppError.unauthorized('Missing or malformed Authorization header'));
  }
  try {
    const payload = jwt.verify(token, config.jwt.accessSecret, { algorithms: ['HS256'] });
    req.user = { id: payload.sub, role: payload.role, name: payload.name, email: payload.email };
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(AppError.unauthorized('Access token expired', 'TOKEN_EXPIRED'));
    }
    return next(AppError.unauthorized('Invalid access token', 'INVALID_TOKEN'));
  }
}

/** Role-based authorization. Must run after `authenticate`. */
export const authorize =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!roles.includes(req.user.role)) return next(AppError.forbidden());
    return next();
  };
