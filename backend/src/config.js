import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function int(name, fallback) {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value)) throw new Error(`Environment variable ${name} must be an integer`);
  return value;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: int('PORT', 4000),
  databaseUrl: required('DATABASE_URL'),
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
  },
  refreshTokenTtlDays: int('REFRESH_TOKEN_TTL_DAYS', 7),
  cookieSecure: process.env.COOKIE_SECURE === 'true',

  authRateLimit: {
    windowMs: int('AUTH_RATE_LIMIT_WINDOW_MIN', 15) * 60 * 1000,
    max: int('AUTH_RATE_LIMIT_MAX', 10),
  },

  // Business rules for bookable time. All wall-clock times are interpreted in this timezone,
  // because a co-working space has one physical location.
  business: {
    timezone: process.env.BUSINESS_TIMEZONE || 'Asia/Kolkata',
    openingHour: int('OPENING_HOUR', 8),
    closingHour: int('CLOSING_HOUR', 20),
    slotMinutes: int('SLOT_MINUTES', 30),
    maxAdvanceDays: int('MAX_ADVANCE_DAYS', 60),
  },
};
