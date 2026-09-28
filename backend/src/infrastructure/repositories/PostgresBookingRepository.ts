import type { PoolClient } from 'pg';
import type { Booking } from '../../domain/entities/Booking.js';
import { Booking as BookingEntity } from '../../domain/entities/Booking.js';
import type { BookingRepository } from '../../domain/repositories/BookingRepository.js';
import type { Db } from '../database/pool.js';

type BookingRow = {
  id: string;
  service_id: string;
  slot_id: string;
  customer_name: string;
  customer_email: string;
  amount_cents: number;
  currency: string;
  status: Booking['status'];
  idempotency_key: string;
  payment_reference: string | null;
  created_at: Date;
  updated_at: Date;
};

function mapRow(row: BookingRow): Booking {
  return BookingEntity.rehydrate({
    id: row.id,
    serviceId: row.service_id,
    slotId: row.slot_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    paymentReference: row.payment_reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class PostgresBookingRepository implements BookingRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<Booking | null> {
    const result = await this.db.query<BookingRow>('SELECT * FROM bookings WHERE id = $1', [id]);
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async findByIdempotencyKey(key: string): Promise<Booking | null> {
    const result = await this.db.query<BookingRow>(
      'SELECT * FROM bookings WHERE idempotency_key = $1',
      [key],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  }

  async findByEmail(email: string): Promise<Booking[]> {
    const result = await this.db.query<BookingRow>(
      'SELECT * FROM bookings WHERE customer_email = $1 ORDER BY created_at DESC',
      [email],
    );
    return result.rows.map(mapRow);
  }

  async save(booking: Booking): Promise<void> {
    await this.db.query(
      `INSERT INTO bookings (
        id, service_id, slot_id, customer_name, customer_email,
        amount_cents, currency, status, idempotency_key, payment_reference,
        created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        booking.id,
        booking.serviceId,
        booking.slotId,
        booking.customerName,
        booking.customerEmail,
        booking.amountCents,
        booking.currency,
        booking.status,
        booking.idempotencyKey,
        booking.paymentReference,
        booking.createdAt.toISOString(),
        booking.updatedAt.toISOString(),
      ],
    );
  }

  async update(booking: Booking): Promise<void> {
    await this.db.query(
      `UPDATE bookings
       SET status = $2, payment_reference = $3, updated_at = $4
       WHERE id = $1`,
      [booking.id, booking.status, booking.paymentReference, booking.updatedAt.toISOString()],
    );
  }
}

/** Optional helper used inside transactions when composing claim+save atomically. */
export async function insertBookingWithClient(client: PoolClient, booking: Booking): Promise<void> {
  await client.query(
    `INSERT INTO bookings (
      id, service_id, slot_id, customer_name, customer_email,
      amount_cents, currency, status, idempotency_key, payment_reference,
      created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      booking.id,
      booking.serviceId,
      booking.slotId,
      booking.customerName,
      booking.customerEmail,
      booking.amountCents,
      booking.currency,
      booking.status,
      booking.idempotencyKey,
      booking.paymentReference,
      booking.createdAt.toISOString(),
      booking.updatedAt.toISOString(),
    ],
  );
}
