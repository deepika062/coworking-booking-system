import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { config } from './config.js';
import { openapi } from './docs/openapi.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import bookingRoutes from './routes/bookings.js';
import spaceRoutes from './routes/spaces.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // behind nginx / a load balancer: rate-limit by real client IP
  app.use(helmet({ contentSecurityPolicy: false })); // JSON API; CSP off so Swagger UI renders
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  if (config.env !== 'test') app.use(morgan('dev'));

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  // Business rules the frontend needs to render calendars and pickers.
  app.get('/api/meta', (req, res) => {
    const { timezone, openingHour, closingHour, slotMinutes, maxAdvanceDays } = config.business;
    res.json({ data: { timezone, openingHour, closingHour, slotMinutes, maxAdvanceDays } });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/spaces', spaceRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
