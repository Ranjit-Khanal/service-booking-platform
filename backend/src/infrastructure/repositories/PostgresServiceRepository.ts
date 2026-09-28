import type { ServiceOffering, TimeSlot } from '../../domain/entities/ServiceOffering.js';
import {
  ServiceOffering as ServiceEntity,
  TimeSlot as TimeSlotEntity,
} from '../../domain/entities/ServiceOffering.js';
import type { ServiceRepository } from '../../domain/repositories/ServiceRepository.js';
import type { Db } from '../database/pool.js';

type ServiceRow = {
  id: string;
  name: string;
  description: string;
  duration_minutes: number;
  price_cents: number;
  currency: string;
  active: boolean;
};

type SlotRow = {
  id: string;
  service_id: string;
  starts_at: Date;
  ends_at: Date;
  status: TimeSlot['status'];
  version: number;
};

function mapService(row: ServiceRow): ServiceOffering {
  return new ServiceEntity(
    row.id,
    row.name,
    row.description,
    row.duration_minutes,
    row.price_cents,
    row.currency,
    row.active,
  );
}

function mapSlot(row: SlotRow): TimeSlot {
  return TimeSlotEntity.rehydrate({
    id: row.id,
    serviceId: row.service_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    version: row.version,
  });
}

/**
 * Slot claiming uses SELECT ... FOR UPDATE inside a transaction.
 *
 * Naive (broken) approach:
 *   1) SELECT status FROM time_slots WHERE id=?
 *   2) if open, UPDATE status='booked'
 * Two concurrent requests both see open → double booking.
 *
 * Correct approach (this class):
 *   BEGIN;
 *   SELECT ... FOR UPDATE;  -- row lock, second waiter blocks
 *   UPDATE ... WHERE status='open' AND version=$expected;
 *   COMMIT;
 */
export class PostgresServiceRepository implements ServiceRepository {
  constructor(private readonly db: Db) {}

  async listActive(): Promise<ServiceOffering[]> {
    const result = await this.db.query<ServiceRow>(
      'SELECT * FROM services WHERE active = true ORDER BY name',
    );
    return result.rows.map(mapService);
  }

  async findById(id: string): Promise<ServiceOffering | null> {
    const result = await this.db.query<ServiceRow>('SELECT * FROM services WHERE id = $1', [id]);
    const row = result.rows[0];
    return row ? mapService(row) : null;
  }

  async listOpenSlots(serviceId: string, from: Date, to: Date): Promise<TimeSlot[]> {
    const result = await this.db.query<SlotRow>(
      `SELECT * FROM time_slots
       WHERE service_id = $1
         AND status = 'open'
         AND starts_at >= $2
         AND starts_at < $3
       ORDER BY starts_at`,
      [serviceId, from.toISOString(), to.toISOString()],
    );
    return result.rows.map(mapSlot);
  }

  async findSlotById(slotId: string): Promise<TimeSlot | null> {
    const result = await this.db.query<SlotRow>('SELECT * FROM time_slots WHERE id = $1', [slotId]);
    const row = result.rows[0];
    return row ? mapSlot(row) : null;
  }

  async claimSlot(slotId: string, expectedVersion?: number): Promise<TimeSlot | null> {
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<SlotRow>(
        `SELECT * FROM time_slots WHERE id = $1 FOR UPDATE`,
        [slotId],
      );
      const row = locked.rows[0];
      if (!row || row.status !== 'open') {
        return null;
      }
      if (expectedVersion !== undefined && row.version !== expectedVersion) {
        return null;
      }

      const updated = await client.query<SlotRow>(
        `UPDATE time_slots
         SET status = 'booked', version = version + 1
         WHERE id = $1 AND status = 'open'
         RETURNING *`,
        [slotId],
      );
      const next = updated.rows[0];
      return next ? mapSlot(next) : null;
    });
  }

  async releaseSlot(slotId: string): Promise<void> {
    await this.db.query(
      `UPDATE time_slots
       SET status = 'open', version = version + 1
       WHERE id = $1 AND status = 'booked'
         AND NOT EXISTS (
           SELECT 1 FROM bookings b
           WHERE b.slot_id = $1 AND b.status = 'confirmed'
         )`,
      [slotId],
    );
  }
}
