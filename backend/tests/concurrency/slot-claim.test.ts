import { describe, expect, it } from 'vitest';
import { PostgresServiceRepository } from '../../src/infrastructure/repositories/PostgresServiceRepository.js';
import { createDatabase } from '../../src/infrastructure/database/pool.js';
import { FailureSimulator } from '../../src/infrastructure/resilience/FailureSimulator.js';
import pino from 'pino';
import { loadEnv } from '../../src/config/env.js';
import { randomUUID } from 'node:crypto';

const run = process.env.RUN_INTEGRATION === '1';

describe.skipIf(!run)('slot claim concurrency', () => {
  it('only one of two concurrent claims wins', async () => {
    const env = loadEnv();
    const logger = pino({ level: 'silent' });
    const failures = new FailureSimulator({
      failPayment: false,
      failRedis: false,
      failDatabase: false,
      failBrokerPublish: false,
      paymentLatencyMs: 0,
    });
    const db = createDatabase(env, logger, failures);
    const repo = new PostgresServiceRepository(db);

    const serviceId = randomUUID();
    const slotId = randomUUID();
    const starts = new Date('2031-06-01T10:00:00Z');
    const ends = new Date('2031-06-01T11:00:00Z');

    await db.query(
      `INSERT INTO services (id, name, description, duration_minutes, price_cents, currency, active)
       VALUES ($1,'Concurrency Test','t',60,1000,'USD',true)`,
      [serviceId],
    );
    await db.query(
      `INSERT INTO time_slots (id, service_id, starts_at, ends_at, status, version)
       VALUES ($1,$2,$3,$4,'open',1)`,
      [slotId, serviceId, starts.toISOString(), ends.toISOString()],
    );

    const [a, b] = await Promise.all([repo.claimSlot(slotId, 1), repo.claimSlot(slotId, 1)]);
    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);

    const check = await db.query<{ status: string }>(
      'SELECT status FROM time_slots WHERE id = $1',
      [slotId],
    );
    expect(check.rows[0]?.status).toBe('booked');

    await db.close();
  });
});
