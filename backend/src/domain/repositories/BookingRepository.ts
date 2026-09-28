// SPDX-License-Identifier: AGPL-3.0-only
import type { Booking } from '../entities/Booking.js';

export interface BookingRepository {
  findById(id: string): Promise<Booking | null>;
  findByIdempotencyKey(key: string): Promise<Booking | null>;
  findByEmail(email: string): Promise<Booking[]>;
  save(booking: Booking): Promise<void>;
  update(booking: Booking): Promise<void>;

  /**
   * Atomically cancel a confirmed booking and reopen its slot.
   * Must serialise with concurrent cancels of the same booking (row lock).
   */
  cancel(id: string): Promise<CancelOutcome>;
}

export type CancelOutcome =
  | { outcome: 'cancelled'; booking: Booking; slotStartsAt: Date | null }
  | { outcome: 'already_cancelled'; booking: Booking }
  | { outcome: 'invalid_state'; booking: Booking }
  | { outcome: 'not_found' };
