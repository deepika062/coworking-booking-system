import { rateLimit } from 'express-rate-limit';
import { config } from '../config.js';

/** Brute-force protection for login/register: N attempts per IP per window. */
export const authLimiter = rateLimit({
  windowMs: config.authRateLimit.windowMs,
  limit: config.authRateLimit.max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    res.status(options.statusCode).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many attempts. Please try again later.',
      },
    });
  },
});
