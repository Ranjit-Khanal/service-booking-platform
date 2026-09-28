import { Router } from 'express';
import type {
  AdminController,
  BookingController,
  CatalogController,
} from '../controllers/controllers.js';

export function buildRoutes(deps: {
  bookings: BookingController;
  catalog: CatalogController;
  admin: AdminController;
}): Router {
  const router = Router();

  router.get('/health', deps.admin.health);

  router.get('/services', deps.catalog.services);
  router.get('/services/:id', deps.catalog.service);
  router.get('/services/:id/slots', deps.catalog.slots);

  router.post('/bookings', deps.bookings.create);
  router.get('/bookings/:id', deps.catalog.booking);
  router.get('/bookings', deps.catalog.bookingsByEmail);

  router.get('/admin/failures', deps.admin.getFailures);
  router.post('/admin/failures', deps.admin.setFailures);
  router.post('/admin/cache/flush', deps.admin.flushCache);

  return router;
}
