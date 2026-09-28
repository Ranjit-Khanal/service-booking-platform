// SPDX-License-Identifier: AGPL-3.0-only
import type { BookingRepository } from '../../domain/repositories/BookingRepository.js';
import type { Booking } from '../../domain/entities/Booking.js';
import { InvalidStateTransitionError, NotFoundError } from '../../shared/errors/AppError.js';
import type { Logger } from '../../shared/logger/logger.js';
import type { CatalogCache } from '../services/CatalogCache.js';

export type CancelBookingResult = {
  booking: Booking;
  /** false when the booking was already cancelled (safe retry). */
  changed: boolean;
};

/**
 * Cancel a confirmed booking and return its slot to inventory.
 *
 * Idempotent without an Idempotency-Key: cancelling an already-cancelled booking
 * returns the same final state. Concurrency is handled by the repository's row lock.
 *
 * Does NOT refund: PaymentProvider has no refund operation. Integrators must refund
 * through their payment provider (booking.paymentReference identifies the charge).
 */
export class CancelBookingUseCase {
  constructor(
    private readonly deps: {
      bookings: BookingRepository;
      catalogCache: CatalogCache;
      logger: Logger;
    },
  ) {}

  async execute(input: { bookingId: string; correlationId: string }): Promise<CancelBookingResult> {
    const log = this.deps.logger.child({
      correlationId: input.correlationId,
      useCase: 'CancelBooking',
      bookingId: input.bookingId,
    });

    const result = await this.deps.bookings.cancel(input.bookingId);

    switch (result.outcome) {
      case 'not_found':
        throw new NotFoundError('Booking not found');
      case 'invalid_state':
        throw new InvalidStateTransitionError(
          `Cannot cancel booking in status ${result.booking.status}`,
          { from: result.booking.status, to: 'cancelled', allowedFrom: ['confirmed'] },
        );
      case 'already_cancelled':
        log.info('Cancel replay: booking already cancelled');
        return { booking: result.booking, changed: false };
      case 'cancelled':
        // Inventory changed — drop cached slot lists (fail-open, never fails the request).
        await this.deps.catalogCache.invalidateSlots(
          result.booking.serviceId,
          result.slotStartsAt ?? new Date(),
        );
        log.info({ slotId: result.booking.slotId }, 'Booking cancelled; slot released');
        return { booking: result.booking, changed: true };
    }
  }
}
