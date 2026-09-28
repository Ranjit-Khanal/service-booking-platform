import type { Booking } from '../entities/Booking.js';

export interface BookingRepository {
  findById(id: string): Promise<Booking | null>;
  findByIdempotencyKey(key: string): Promise<Booking | null>;
  findByEmail(email: string): Promise<Booking[]>;
  save(booking: Booking): Promise<void>;
  update(booking: Booking): Promise<void>;
}
