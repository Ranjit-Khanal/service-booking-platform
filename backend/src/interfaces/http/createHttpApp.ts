import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Env } from '../../config/env.js';
import type { Logger } from '../../shared/logger/logger.js';
import type { RateLimiter } from '../../domain/repositories/InfrastructurePorts.js';
import {
  createRateLimitMiddleware,
  errorMiddleware,
  requestContextMiddleware,
} from './middleware/common.js';
import { buildRoutes } from './routes/routes.js';
import type {
  AdminController,
  BookingController,
  CatalogController,
} from './controllers/controllers.js';

export function createHttpApp(deps: {
  env: Env;
  logger: Logger;
  rateLimiter: RateLimiter;
  bookings: BookingController;
  catalog: CatalogController;
  admin: AdminController;
}): express.Application {
  const app = express();
  app.disable('x-powered-by');
  // cross-origin: UI (5173) calls API (8080); default CORP same-origin breaks browser fetch
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));
  app.use(requestContextMiddleware(deps.logger));
  app.use(
    createRateLimitMiddleware(deps.rateLimiter, {
      windowMs: deps.env.RATE_LIMIT_WINDOW_MS,
      max: deps.env.RATE_LIMIT_MAX,
    }),
  );

  app.get('/', (_req, res) => {
    res.json({
      name: 'SlotBook API',
      instanceId: deps.env.INSTANCE_ID,
      docs: '/api/health',
    });
  });

  app.use(
    '/api',
    buildRoutes({
      bookings: deps.bookings,
      catalog: deps.catalog,
      admin: deps.admin,
    }),
  );

  app.use(errorMiddleware(deps.logger));
  return app;
}
