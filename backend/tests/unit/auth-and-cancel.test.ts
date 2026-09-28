// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import pino from 'pino';
import {
  adminAuthMiddleware,
  apiKeyAuthMiddleware,
  errorMiddleware,
} from '../../src/interfaces/http/middleware/common.js';
import { CancelBookingUseCase } from '../../src/application/use-cases/CancelBookingUseCase.js';
import { Booking } from '../../src/domain/entities/Booking.js';
import { loadEnv } from '../../src/config/env.js';

const logger = pino({ level: 'silent' });

function appWith(mw: express.RequestHandler) {
  const app = express();
  app.get('/x', mw, (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorMiddleware(logger));
  return app;
}

describe('apiKeyAuthMiddleware', () => {
  const app = appWith(apiKeyAuthMiddleware({ mode: 'api_key', keys: ['key-a', 'key-b'] }));

  it('rejects a request without a key', async () => {
    const res = await request(app).get('/x');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a wrong key', async () => {
    const res = await request(app).get('/x').set('Authorization', 'Bearer nope');
    expect(res.status).toBe(401);
  });

  it('accepts Bearer and X-API-Key', async () => {
    expect((await request(app).get('/x').set('Authorization', 'Bearer key-b')).status).toBe(200);
    expect((await request(app).get('/x').set('X-API-Key', 'key-a')).status).toBe(200);
  });

  it('is open in mode none', async () => {
    const open = appWith(apiKeyAuthMiddleware({ mode: 'none', keys: [] }));
    expect((await request(open).get('/x')).status).toBe(200);
  });
});

describe('adminAuthMiddleware', () => {
  it('hides admin routes when no admin key is configured', async () => {
    const res = await request(appWith(adminAuthMiddleware(undefined))).get('/x');
    expect(res.status).toBe(404);
  });

  it('requires X-Admin-Key when configured', async () => {
    const app = appWith(adminAuthMiddleware('admin-key-0123456789'));
    expect((await request(app).get('/x')).status).toBe(401);
    expect(
      (await request(app).get('/x').set('X-Admin-Key', 'admin-key-0123456789')).status,
    ).toBe(200);
  });
});

describe('loadEnv auth validation', () => {
  const base = {
    DATABASE_URL: 'postgres://x',
    REDIS_URL: 'redis://x',
    RABBITMQ_URL: 'amqp://x',
  };

  it('fails fast when AUTH_MODE=api_key and API_KEYS is empty', () => {
    expect(() => loadEnv({ ...base, AUTH_MODE: 'api_key', API_KEYS: '' })).toThrow(/API_KEYS/);
  });

  it('treats an empty ADMIN_API_KEY as unset', () => {
    const env = loadEnv({ ...base, API_KEYS: 'k1, k2', ADMIN_API_KEY: '' });
    expect(env.API_KEYS).toEqual(['k1', 'k2']);
    expect(env.ADMIN_API_KEY).toBeUndefined();
  });

  it('rejects a short ADMIN_API_KEY', () => {
    expect(() => loadEnv({ ...base, API_KEYS: 'k', ADMIN_API_KEY: 'short' })).toThrow(
      /ADMIN_API_KEY/,
    );
  });
});

describe('CancelBookingUseCase', () => {
  function confirmedBooking() {
    const b = Booking.create({
      id: '00000000-0000-4000-8000-00000000000b',
      serviceId: '00000000-0000-4000-8000-000000000001',
      slotId: '00000000-0000-4000-8000-000000000002',
      customerName: 'Ada',
      customerEmail: 'ada@example.com',
      amountCents: 5000,
      currency: 'USD',
      idempotencyKey: 'k',
    });
    b.confirm('pay_1');
    return b;
  }

  function makeUseCase(outcome: unknown) {
    const bookings = {
      findById: vi.fn(),
      findByIdempotencyKey: vi.fn(),
      findByEmail: vi.fn(),
      save: vi.fn(),
      update: vi.fn(),
      cancel: vi.fn().mockResolvedValue(outcome),
    };
    const catalogCache = { invalidateSlots: vi.fn().mockResolvedValue(undefined) };
    const useCase = new CancelBookingUseCase({
      bookings,
      catalogCache: catalogCache as never,
      logger,
    });
    return { useCase, catalogCache };
  }

  it('cancels and invalidates the slot cache', async () => {
    const booking = confirmedBooking();
    booking.cancel();
    const { useCase, catalogCache } = makeUseCase({
      outcome: 'cancelled',
      booking,
      slotStartsAt: new Date('2030-01-01T10:00:00Z'),
    });
    const result = await useCase.execute({ bookingId: booking.id, correlationId: 'c' });
    expect(result.changed).toBe(true);
    expect(result.booking.status).toBe('cancelled');
    expect(catalogCache.invalidateSlots).toHaveBeenCalledTimes(1);
  });

  it('is a no-op success when already cancelled', async () => {
    const booking = confirmedBooking();
    booking.cancel();
    const { useCase, catalogCache } = makeUseCase({ outcome: 'already_cancelled', booking });
    const result = await useCase.execute({ bookingId: booking.id, correlationId: 'c' });
    expect(result.changed).toBe(false);
    expect(catalogCache.invalidateSlots).not.toHaveBeenCalled();
  });

  it('rejects cancelling a failed booking with INVALID_STATE_TRANSITION', async () => {
    const booking = Booking.rehydrate({ ...confirmedBooking(), status: 'failed' } as never);
    const { useCase } = makeUseCase({ outcome: 'invalid_state', booking });
    await expect(
      useCase.execute({ bookingId: booking.id, correlationId: 'c' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION', statusCode: 409 });
  });

  it('404s when the booking does not exist', async () => {
    const { useCase } = makeUseCase({ outcome: 'not_found' });
    await expect(
      useCase.execute({ bookingId: 'x', correlationId: 'c' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
