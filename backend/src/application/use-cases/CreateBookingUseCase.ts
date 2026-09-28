import { createHash, randomUUID } from 'node:crypto';
import type { BookingRepository } from '../../domain/repositories/BookingRepository.js';
import type { ServiceRepository } from '../../domain/repositories/ServiceRepository.js';
import type { IdempotencyStore } from '../../domain/repositories/InfrastructurePorts.js';
import type { PaymentProvider } from '../../domain/services/PaymentProvider.js';
import type { EventPublisher } from '../../domain/services/EventPublisher.js';
import { Booking } from '../../domain/entities/Booking.js';
import {
  ConflictError,
  NotFoundError,
  PaymentFailedError,
  SlotUnavailableError,
  ValidationError,
} from '../../shared/errors/AppError.js';
import type { Logger } from '../../shared/logger/logger.js';
import { withRetry, withTimeout } from '../../infrastructure/resilience/retry.js';
import type { CircuitBreaker } from '../../infrastructure/resilience/CircuitBreaker.js';
import type { CatalogCache } from '../services/CatalogCache.js';

export type CreateBookingInput = {
  serviceId: string;
  slotId: string;
  customerName: string;
  customerEmail: string;
  idempotencyKey: string;
  correlationId: string;
};

export type CreateBookingResult = {
  booking: Booking;
  replayed: boolean;
};

function hashRequest(input: CreateBookingInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        serviceId: input.serviceId,
        slotId: input.slotId,
        customerEmail: input.customerEmail.trim().toLowerCase(),
        customerName: input.customerName.trim(),
      }),
    )
    .digest('hex');
}

/**
 * CreateBookingUseCase — the critical path for SlotBook.
 *
 * Concurrency: claimSlot uses SELECT ... FOR UPDATE / version bump so two
 * clients cannot book the same last slot.
 *
 * Idempotency: Idempotency-Key + Redis/store prevents double charges on retries.
 *
 * Async: after confirm, publish booking.created for notification worker.
 */
export class CreateBookingUseCase {
  constructor(
    private readonly deps: {
      bookings: BookingRepository;
      services: ServiceRepository;
      payments: PaymentProvider;
      events: EventPublisher;
      idempotency: IdempotencyStore;
      paymentCircuit: CircuitBreaker;
      catalogCache: CatalogCache;
      logger: Logger;
      idempotencyTtlSeconds: number;
      paymentTimeoutMs: number;
      paymentMaxRetries: number;
    },
  ) {}

  async execute(input: CreateBookingInput): Promise<CreateBookingResult> {
    this.validate(input);
    const log = this.deps.logger.child({
      correlationId: input.correlationId,
      useCase: 'CreateBooking',
      idempotencyKey: input.idempotencyKey,
    });

    const requestHash = hashRequest(input);
    const begin = await this.deps.idempotency.begin(
      input.idempotencyKey,
      requestHash,
      this.deps.idempotencyTtlSeconds,
    );

    if (begin === 'completed') {
      const existing = await this.deps.idempotency.get(input.idempotencyKey);
      if (!existing) {
        const byKey = await this.deps.bookings.findByIdempotencyKey(input.idempotencyKey);
        if (byKey) return { booking: byKey, replayed: true };
        throw new ConflictError('Idempotency record missing');
      }
      if (existing.requestHash !== requestHash) {
        throw new ConflictError('Idempotency-Key reused with different payload', {
          code: 'IDEMPOTENCY_CONFLICT',
        });
      }
      const booking = await this.deps.bookings.findByIdempotencyKey(input.idempotencyKey);
      if (!booking) throw new ConflictError('Idempotent booking not found');
      log.info({ bookingId: booking.id }, 'Idempotent replay');
      return { booking, replayed: true };
    }

    if (begin === 'in_progress') {
      throw new ConflictError('Request with this Idempotency-Key is already in progress');
    }

    const service = await this.deps.services.findById(input.serviceId);
    if (!service || !service.active) {
      throw new NotFoundError('Service not found');
    }

    const slot = await this.deps.services.findSlotById(input.slotId);
    if (!slot || slot.serviceId !== service.id) {
      throw new NotFoundError('Slot not found for service');
    }

    const claimed = await this.deps.services.claimSlot(slot.id, slot.version);
    if (!claimed) {
      throw new SlotUnavailableError();
    }

    // Inventory changed — drop cached open-slot lists immediately (all API instances).
    await this.deps.catalogCache.invalidateSlots(service.id, claimed.startsAt);

    const booking = Booking.create({
      id: randomUUID(),
      serviceId: service.id,
      slotId: claimed.id,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      amountCents: service.priceCents,
      currency: service.currency,
      idempotencyKey: input.idempotencyKey,
    });

    await this.deps.bookings.save(booking);
    log.info({ bookingId: booking.id, slotId: claimed.id }, 'Slot claimed; charging payment');

    try {
      const payment = await this.deps.paymentCircuit.exec(() =>
        withRetry(
          () =>
            withTimeout(
              this.deps.payments.charge({
                amountCents: booking.amountCents,
                currency: booking.currency,
                customerEmail: booking.customerEmail,
                bookingId: booking.id,
                idempotencyKey: input.idempotencyKey,
                correlationId: input.correlationId,
              }),
              this.deps.paymentTimeoutMs,
              'Payment provider timed out',
            ),
          {
            maxAttempts: this.deps.paymentMaxRetries,
            baseDelayMs: 100,
            maxDelayMs: 2000,
            isRetryable: (err) => {
              if (err instanceof Error && err.message.includes('timed out')) return true;
              return false;
            },
            onRetry: (attempt, error, delayMs) => {
              log.warn({ attempt, delayMs, err: String(error) }, 'Retrying payment');
            },
          },
        ),
      );

      if (!payment.success) {
        booking.markFailed();
        await this.deps.bookings.update(booking);
        await this.deps.services.releaseSlot(claimed.id);
        await this.deps.catalogCache.invalidateSlots(service.id, claimed.startsAt);
        throw new PaymentFailedError(payment.message, payment.retryable);
      }

      booking.confirm(payment.reference);
      await this.deps.bookings.update(booking);

      await this.deps.events.publish({
        type: 'booking.created',
        bookingId: booking.id,
        serviceId: booking.serviceId,
        slotId: booking.slotId,
        customerEmail: booking.customerEmail,
        customerName: booking.customerName,
        amountCents: booking.amountCents,
        currency: booking.currency,
        occurredAt: new Date().toISOString(),
        correlationId: input.correlationId,
      });

      await this.deps.idempotency.complete(
        input.idempotencyKey,
        {
          requestHash,
          statusCode: 201,
          body: { bookingId: booking.id, status: booking.status },
          createdAt: new Date().toISOString(),
        },
        this.deps.idempotencyTtlSeconds,
      );

      log.info({ bookingId: booking.id, paymentRef: payment.reference }, 'Booking confirmed');
      return { booking, replayed: false };
    } catch (error) {
      if (booking.status === 'pending_payment') {
        booking.markFailed();
        await this.deps.bookings.update(booking).catch(() => undefined);
        await this.deps.services.releaseSlot(claimed.id).catch(() => undefined);
        await this.deps.catalogCache
          .invalidateSlots(service.id, claimed.startsAt)
          .catch(() => undefined);
      }
      throw error;
    }
  }

  private validate(input: CreateBookingInput): void {
    if (!input.idempotencyKey?.trim()) {
      throw new ValidationError('Idempotency-Key header is required');
    }
    if (!input.customerName?.trim()) {
      throw new ValidationError('customerName is required');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.customerEmail)) {
      throw new ValidationError('customerEmail is invalid');
    }
  }
}
