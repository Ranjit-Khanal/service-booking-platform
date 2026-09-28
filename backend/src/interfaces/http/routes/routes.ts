// SPDX-License-Identifier: AGPL-3.0-only
import { Router } from 'express';
import type {
  AdminController,
  BookingController,
  CatalogController,
} from '../controllers/controllers.js';

/** Public integration API (behind API-key auth). */
export function buildRoutes(deps: {
  bookings: BookingController;
  catalog: CatalogController;
}): Router {
  const router = Router();

  router.get('/services', deps.catalog.services);
  router.get('/services/:id', deps.catalog.service);
  router.get('/services/:id/slots', deps.catalog.slots);

  router.post('/bookings', deps.bookings.create);
  router.get('/bookings/:id', deps.catalog.booking);
  router.get('/bookings', deps.catalog.bookingsByEmail);
  router.post('/bookings/:id/cancel', deps.bookings.cancel);

  return router;
}

/** Operator-only routes (behind ADMIN_API_KEY; disabled when unset). */
export function buildAdminRoutes(admin: AdminController): Router {
  const router = Router();

  router.get('/failures', admin.getFailures);
  router.post('/failures', admin.setFailures);
  router.post('/cache/flush', admin.flushCache);

  return router;
}
