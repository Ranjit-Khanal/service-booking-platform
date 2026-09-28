// SPDX-License-Identifier: AGPL-3.0-only
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { trustProxyValue, type Env } from '../../config/env.js';
import type { Logger } from '../../shared/logger/logger.js';
import type { RateLimiter } from '../../domain/repositories/InfrastructurePorts.js';
import {
  adminAuthMiddleware,
  apiKeyAuthMiddleware,
  createRateLimitMiddleware,
  errorMiddleware,
  requestContextMiddleware,
} from './middleware/common.js';
import { buildAdminRoutes, buildRoutes } from './routes/routes.js';
import { NotFoundError } from '../../shared/errors/AppError.js';
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
  // Behind HAProxy, req.ip must come from X-Forwarded-For or every client shares one rate-limit bucket.
  app.set('trust proxy', trustProxyValue(deps.env.TRUST_PROXY));
  // cross-origin: UI (5173) calls API (8080); default CORP same-origin breaks browser fetch
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  const origins = deps.env.CORS_ORIGINS.split(',').map((o) => o.trim());
  app.use(cors({ origin: origins.includes('*') ? '*' : origins }));
  app.use(express.json({ limit: '100kb' }));
  app.use(requestContextMiddleware(deps.logger));

  // Health is outside rate limiting and auth: load balancers call it every few seconds.
  app.get('/api/health', deps.admin.health);

  app.use(
    createRateLimitMiddleware(deps.rateLimiter, {
      windowMs: deps.env.RATE_LIMIT_WINDOW_MS,
      max: deps.env.RATE_LIMIT_MAX,
      logger: deps.logger,
    }),
  );

  app.get('/', (_req, res) => {
    res.json({
      name: 'SlotBook API',
      instanceId: deps.env.INSTANCE_ID,
      docs: '/api/health',
    });
  });

  app.use('/api/admin', adminAuthMiddleware(deps.env.ADMIN_API_KEY), buildAdminRoutes(deps.admin));
  app.use(
    '/api',
    apiKeyAuthMiddleware({ mode: deps.env.AUTH_MODE, keys: deps.env.API_KEYS }),
    buildRoutes({ bookings: deps.bookings, catalog: deps.catalog }),
  );

  app.use((_req, _res, next) => next(new NotFoundError('Route not found')));
  app.use(errorMiddleware(deps.logger));
  return app;
}
