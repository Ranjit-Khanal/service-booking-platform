// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { createDatabase, type Db } from '../../src/infrastructure/database/pool.js';
import { FailureSimulator } from '../../src/infrastructure/resilience/FailureSimulator.js';
import { PostgresBookingRepository } from '../../src/infrastructure/repositories/PostgresBookingRepository.js';
import { PostgresServiceRepository } from '../../src/infrastructure/repositories/PostgresServiceRepository.js';

const run = process.env.RUN_INTEGRATION === '1';

/**
 * Real-Postgres tests for the cancel transaction. Creates its own service and cleans up.
 * Needs DATABASE_URL pointing at a migrated database.
 */
describe.skipIf(!run)('booking cancel concurrency', () => {
  let db: Db;
  const serviceId = randomUUID();

  beforeAll(async () => {
    const failures = new FailureSimulator({
      failPayment: false,
      failRedis: false,
      failDatabase: false,
      failBrokerPublish: false,
      paymentLatencyMs: 0,
    });
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required');
    db = createDatabase({ DATABASE_URL: url, DB_POOL_MAX: 10 }, pino({ level: 'silent' }), failures);
    await db.query(
      `INSERT INTO services (id, name, description, duration_minutes, price_cents, currency, active)
       VALUES ($1,'Cancel Concurrency Test','t',60,1000,'USD',false)`,
      [serviceId],
    );
  });

  afterAll(async () => {
    await db.query('DELETE FROM bookings WHERE service_id = $1', [serviceId]);
    await db.query('DELETE FROM time_slots WHERE service_id = $1', [serviceId]);
    await db.query('DELETE FROM services WHERE id = $1', [serviceId]);
    await db.close();
  });

  async function confirmedBookingOnNewSlot(status = 'confirmed') {
    const slotId = randomUUID();
    const bookingId = randomUUID();
    const starts = new Date(Date.UTC(2032, 0, 1, 0, 0, 0) + Math.floor(Math.random() * 1e9) * 1000);
    await db.query(
      `INSERT INTO time_slots (id, service_id, starts_at, ends_at, status, version)
       VALUES ($1,$2,$3,$4,'booked',2)`,
      [slotId, serviceId, starts.toISOString(), new Date(starts.getTime() + 3_600_000).toISOString()],
    );
    await db.query(
      `INSERT INTO bookings (id, service_id, slot_id, customer_name, customer_email, amount_cents,
                             currency, status, idempotency_key, payment_reference, created_at, updated_at)
       VALUES ($1,$2,$3,'T','t@example.com',1000,'USD',$4,$5,'pay_t',now(),now())`,
      [bookingId, serviceId, slotId, status, randomUUID()],
    );
    return { slotId, bookingId };
  }

  it('10 concurrent cancels: exactly one changes state, slot released exactly once', async () => {
    const repo = new PostgresBookingRepository(db);
    const { slotId, bookingId } = await confirmedBookingOnNewSlot();

    const results = await Promise.all(Array.from({ length: 10 }, () => repo.cancel(bookingId)));
    const outcomes = results.map((r) => r.outcome).sort();

    expect(outcomes.filter((o) => o === 'cancelled')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'already_cancelled')).toHaveLength(9);

    const slot = await db.query<{ status: string; version: number }>(
      'SELECT status, version FROM time_slots WHERE id = $1',
      [slotId],
    );
    expect(slot.rows[0]).toEqual({ status: 'open', version: 3 });
  });

  it('released slot can be claimed again', async () => {
    const repo = new PostgresBookingRepository(db);
    const slots = new PostgresServiceRepository(db);
    const { slotId, bookingId } = await confirmedBookingOnNewSlot();

    await repo.cancel(bookingId);
    const [a, b] = await Promise.all([slots.claimSlot(slotId, 3), slots.claimSlot(slotId, 3)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('refuses to cancel a pending_payment booking and leaves the slot booked', async () => {
    const repo = new PostgresBookingRepository(db);
    const { slotId, bookingId } = await confirmedBookingOnNewSlot('pending_payment');

    const r = await repo.cancel(bookingId);
    expect(r.outcome).toBe('invalid_state');

    const slot = await db.query<{ status: string }>('SELECT status FROM time_slots WHERE id = $1', [
      slotId,
    ]);
    expect(slot.rows[0]?.status).toBe('booked');
  });
});
