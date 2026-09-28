// SPDX-License-Identifier: AGPL-3.0-only
import type { Request, Response, NextFunction } from 'express';
import type { CreateBookingUseCase } from '../../../application/use-cases/CreateBookingUseCase.js';
import type { CancelBookingUseCase } from '../../../application/use-cases/CancelBookingUseCase.js';
import { NotFoundError } from '../../../shared/errors/AppError.js';
import type {
  GetBookingUseCase,
  GetServiceUseCase,
  ListBookingsByEmailUseCase,
  ListServicesUseCase,
  ListSlotsUseCase,
} from '../../../application/use-cases/QueryUseCases.js';
import type { AuthedRequest } from '../middleware/common.js';
import type { FailureSimulator } from '../../../infrastructure/resilience/FailureSimulator.js';
import type { CircuitBreaker } from '../../../infrastructure/resilience/CircuitBreaker.js';
import type { Env } from '../../../config/env.js';
import type { Db } from '../../../infrastructure/database/pool.js';
import type { Redis as RedisClient } from 'ioredis';
import type { CatalogCache } from '../../../application/services/CatalogCache.js';
import { CacheTtl } from '../../../infrastructure/cache/CachePolicy.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Path IDs are UUIDs; anything else cannot exist, so answer 404 instead of a Postgres cast error. */
function uuidParam(req: Request, name: string, what: string): string {
  const value = String(req.params[name] ?? '');
  if (!UUID_RE.test(value)) throw new NotFoundError(`${what} not found`);
  return value;
}

export class BookingController {
  constructor(
    private readonly createBooking: CreateBookingUseCase,
    private readonly cancelBooking: CancelBookingUseCase,
  ) {}

  cancel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const r = req as AuthedRequest;
      const result = await this.cancelBooking.execute({
        bookingId: uuidParam(req, 'id', 'Booking'),
        correlationId: r.correlationId,
      });
      const b = result.booking;
      res.status(200).json({
        data: {
          id: b.id,
          status: b.status,
          serviceId: b.serviceId,
          slotId: b.slotId,
          amountCents: b.amountCents,
          currency: b.currency,
          paymentReference: b.paymentReference,
          changed: result.changed,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const r = req as AuthedRequest;
      const idempotencyKey = String(req.header('idempotency-key') ?? '');
      const result = await this.createBooking.execute({
        serviceId: String(req.body.serviceId ?? ''),
        slotId: String(req.body.slotId ?? ''),
        customerName: String(req.body.customerName ?? ''),
        customerEmail: String(req.body.customerEmail ?? ''),
        idempotencyKey,
        correlationId: r.correlationId,
      });
      res.status(result.replayed ? 200 : 201).json({
        data: {
          id: result.booking.id,
          status: result.booking.status,
          serviceId: result.booking.serviceId,
          slotId: result.booking.slotId,
          customerEmail: result.booking.customerEmail,
          amountCents: result.booking.amountCents,
          currency: result.booking.currency,
          paymentReference: result.booking.paymentReference,
          replayed: result.replayed,
        },
      });
    } catch (error) {
      next(error);
    }
  };
}

export class CatalogController {
  constructor(
    private readonly listServices: ListServicesUseCase,
    private readonly getService: GetServiceUseCase,
    private readonly listSlots: ListSlotsUseCase,
    private readonly getBooking: GetBookingUseCase,
    private readonly listByEmail: ListBookingsByEmailUseCase,
  ) {}

  services = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const services = await this.listServices.execute();
      res.setHeader(
        'Cache-Control',
        `public, max-age=15, stale-while-revalidate=${CacheTtl.servicesListSeconds}`,
      );
      res.json({
        data: services.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          durationMinutes: s.durationMinutes,
          priceCents: s.priceCents,
          currency: s.currency,
        })),
      });
    } catch (error) {
      next(error);
    }
  };

  service = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const service = await this.getService.execute(uuidParam(req, 'id', 'Service'));
      res.setHeader('Cache-Control', `public, max-age=30`);
      res.json({
        data: {
          id: service.id,
          name: service.name,
          description: service.description,
          durationMinutes: service.durationMinutes,
          priceCents: service.priceCents,
          currency: service.currency,
        },
      });
    } catch (error) {
      next(error);
    }
  };

  slots = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
      const slots = await this.listSlots.execute(uuidParam(req, 'id', 'Service'), date);
      // Slots must not be cached long at the HTTP edge — inventory mutates.
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
      res.json({
        data: slots.map((s) => ({
          id: s.id,
          serviceId: s.serviceId,
          startsAt: s.startsAt.toISOString(),
          endsAt: s.endsAt.toISOString(),
          status: s.status,
          version: s.version,
        })),
      });
    } catch (error) {
      next(error);
    }
  };

  booking = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const booking = await this.getBooking.execute(uuidParam(req, 'id', 'Booking'));
      res.json({
        data: {
          id: booking.id,
          status: booking.status,
          serviceId: booking.serviceId,
          slotId: booking.slotId,
          customerName: booking.customerName,
          customerEmail: booking.customerEmail,
          amountCents: booking.amountCents,
          currency: booking.currency,
          paymentReference: booking.paymentReference,
          createdAt: booking.createdAt.toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  };

  bookingsByEmail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const email = String(req.query.email ?? '');
      const bookings = await this.listByEmail.execute(email);
      res.json({
        data: bookings.map((b) => ({
          id: b.id,
          status: b.status,
          serviceId: b.serviceId,
          slotId: b.slotId,
          amountCents: b.amountCents,
          currency: b.currency,
          createdAt: b.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      next(error);
    }
  };
}

export class AdminController {
  constructor(
    private readonly failures: FailureSimulator,
    private readonly paymentCircuit: CircuitBreaker,
    private readonly env: Env,
    private readonly db: Db,
    private readonly redis: RedisClient,
    private readonly catalogCache: CatalogCache,
  ) {}

  health = async (_req: Request, res: Response): Promise<void> => {
    let dbOk = false;
    let redisOk = false;
    try {
      await this.db.query('SELECT 1');
      dbOk = true;
    } catch {
      dbOk = false;
    }
    try {
      redisOk = (await this.redis.ping()) === 'PONG';
    } catch {
      redisOk = false;
    }

    const ok = dbOk && redisOk;
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      instanceId: this.env.INSTANCE_ID,
      checks: { database: dbOk, redis: redisOk },
      circuitBreaker: this.paymentCircuit.getState(),
      failures: this.failures.get(),
      cache: this.catalogCache.getMetrics(),
    });
  };

  getFailures = async (_req: Request, res: Response): Promise<void> => {
    res.json({ data: this.failures.get() });
  };

  setFailures = async (req: Request, res: Response): Promise<void> => {
    const next = this.failures.set({
      failPayment: Boolean(req.body.failPayment ?? false),
      failRedis: Boolean(req.body.failRedis ?? false),
      failDatabase: Boolean(req.body.failDatabase ?? false),
      failBrokerPublish: Boolean(req.body.failBrokerPublish ?? false),
      paymentLatencyMs: Number(req.body.paymentLatencyMs ?? 0),
    });
    res.json({ data: next });
  };

  flushCache = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.catalogCache.invalidateCatalog();
      res.json({ data: { flushed: true, metrics: this.catalogCache.getMetrics() } });
    } catch (error) {
      next(error);
    }
  };
}
