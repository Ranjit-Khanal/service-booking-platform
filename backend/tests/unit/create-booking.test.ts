import { describe, expect, it, vi } from 'vitest';
import { CreateBookingUseCase } from '../../src/application/use-cases/CreateBookingUseCase.js';
import { Booking } from '../../src/domain/entities/Booking.js';
import { ServiceOffering, TimeSlot } from '../../src/domain/entities/ServiceOffering.js';
import { CircuitBreaker } from '../../src/infrastructure/resilience/CircuitBreaker.js';
import pino from 'pino';

function makeUseCase(overrides: Record<string, unknown> = {}) {
  const slot = TimeSlot.rehydrate({
    id: 'slot-1',
    serviceId: 'svc-1',
    startsAt: new Date('2030-01-01T10:00:00Z'),
    endsAt: new Date('2030-01-01T11:00:00Z'),
    status: 'open',
    version: 1,
  });

  const service = new ServiceOffering('svc-1', 'Cut', 'desc', 60, 5000, 'USD', true);

  const bookings = {
    findById: vi.fn(),
    findByIdempotencyKey: vi.fn().mockResolvedValue(null),
    findByEmail: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  };

  const services = {
    listActive: vi.fn(),
    findById: vi.fn().mockResolvedValue(service),
    listOpenSlots: vi.fn(),
    findSlotById: vi.fn().mockResolvedValue(slot),
    claimSlot: vi.fn().mockImplementation(async () => {
      const claimed = TimeSlot.rehydrate({ ...slot, status: 'booked', version: 2 });
      return claimed;
    }),
    releaseSlot: vi.fn(),
  };

  const payments = {
    name: 'mock',
    charge: vi.fn().mockResolvedValue({ success: true, reference: 'pay_1', provider: 'mock' }),
  };

  const events = { publish: vi.fn().mockResolvedValue(undefined) };

  const idempotency = {
    get: vi.fn(),
    begin: vi.fn().mockResolvedValue('acquired'),
    complete: vi.fn().mockResolvedValue(undefined),
  };

  const catalogCache = {
    getActiveServices: vi.fn(),
    getService: vi.fn(),
    getOpenSlots: vi.fn(),
    invalidateSlots: vi.fn().mockResolvedValue(undefined),
    invalidateCatalog: vi.fn(),
    getMetrics: vi.fn().mockReturnValue({ hits: 0, misses: 0, bypasses: 0, invalidations: 0 }),
  };

  const useCase = new CreateBookingUseCase({
    bookings,
    services,
    payments,
    events,
    idempotency,
    paymentCircuit: new CircuitBreaker({ name: 'payment', failureThreshold: 5, resetTimeoutMs: 1000 }),
    catalogCache,
    logger: pino({ level: 'silent' }),
    idempotencyTtlSeconds: 60,
    paymentTimeoutMs: 1000,
    paymentMaxRetries: 2,
    ...overrides,
  });

  return { useCase, bookings, services, payments, events, idempotency, catalogCache };
}

describe('CreateBookingUseCase', () => {
  it('claims slot, charges, publishes event', async () => {
    const { useCase, bookings, events, catalogCache } = makeUseCase();
    const result = await useCase.execute({
      serviceId: 'svc-1',
      slotId: 'slot-1',
      customerName: 'Ada Lovelace',
      customerEmail: 'ada@example.com',
      idempotencyKey: 'idem-1',
      correlationId: 'corr-1',
    });
    expect(result.replayed).toBe(false);
    expect(result.booking.status).toBe('confirmed');
    expect(bookings.save).toHaveBeenCalled();
    expect(catalogCache.invalidateSlots).toHaveBeenCalled();
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'booking.created', correlationId: 'corr-1' }),
    );
  });

  it('replays when idempotency key already completed', async () => {
    const existing = Booking.create({
      id: 'existing',
      serviceId: 'svc-1',
      slotId: 'slot-1',
      customerName: 'Ada',
      customerEmail: 'ada@example.com',
      amountCents: 5000,
      currency: 'USD',
      idempotencyKey: 'idem-1',
    });
    existing.confirm('pay_old');

    const { useCase, services, idempotency, bookings } = makeUseCase();
    idempotency.begin.mockResolvedValue('completed');
    idempotency.get.mockResolvedValue({
      key: 'idem-1',
      requestHash: expect.any(String),
      statusCode: 201,
      body: {},
      createdAt: new Date().toISOString(),
    });
    // Force hash match by computing via second call path using bookings.findByIdempotencyKey
    bookings.findByIdempotencyKey.mockResolvedValue(existing);

    // Override get to return matching hash — simpler path: begin completed + findByIdempotencyKey
    idempotency.get.mockResolvedValue(null);

    const result = await useCase.execute({
      serviceId: 'svc-1',
      slotId: 'slot-1',
      customerName: 'Ada',
      customerEmail: 'ada@example.com',
      idempotencyKey: 'idem-1',
      correlationId: 'corr-1',
    });

    expect(result.replayed).toBe(true);
    expect(services.claimSlot).not.toHaveBeenCalled();
  });
});
