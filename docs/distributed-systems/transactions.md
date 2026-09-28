# Transactions

## What exists

`createDatabase()` in `backend/src/infrastructure/database/pool.ts` exposes two ways to
talk to Postgres:

```ts
db.query(sql, params)          // pool.query — autocommit, one statement
db.withTransaction(async (client) => { … })   // BEGIN … COMMIT / ROLLBACK on one client
```

`withTransaction` is used **twice**: `PostgresServiceRepository.claimSlot` and
`PostgresBookingRepository.cancel`. Every other write is a single autocommit statement. Isolation level is Postgres' default,
`READ COMMITTED`; nothing changes it.

## Transaction boundaries in the booking flow

```text
┌─ tx ──────────────────────────────┐
│ SELECT slot FOR UPDATE            │  claimSlot
│ UPDATE slot → booked, version+1   │
└───────────────────────────────────┘
  INSERT booking (pending_payment)      autocommit
  … payment call (no DB connection held) …
  UPDATE booking → confirmed            autocommit
  (or UPDATE booking → failed           autocommit
      UPDATE slot → open                autocommit)
```

So the booking flow is **four separate commits** on the happy path. Consistency between
them is maintained by ordering plus compensation, not by a transaction. This is a
deliberate choice for the payment step and an incidental one for the insert.

## Why not one big transaction

Holding a transaction open across the payment call would:

- keep the slot row locked for up to ~9.4s (payment retry budget);
- keep one pooled connection busy for the same time (pool size is 10 per replica);
- still not make the payment atomic with the database — the provider is outside the
  transaction no matter what. A rollback after a successful charge leaves the money
  taken and the booking gone, which is worse than a `pending_payment` row.

The design instead uses the slot's `booked` status as a durable reservation and the
booking's `pending_payment` status as a durable "payment in progress" marker. That is a
small saga: each step commits, and failure triggers compensating writes (`markFailed`,
`releaseSlot`).

## Where a transaction is missing

**Claim + insert.** `claimSlot` commits, then `bookings.save()` runs as a separate
statement outside the `try` block. If the insert fails (unique violation on
`idempotency_key`, DB error, crash), the slot is `booked` with no booking and no
compensation runs. `insertBookingWithClient(client, booking)` in
`PostgresBookingRepository.ts` was written for exactly this — inserting inside the claim
transaction — but is not called. Using it would make "slot booked ⇔ a booking row
exists" hold unconditionally.

**Fail + release.** `markFailed` and `releaseSlot` are two statements. A crash between
them leaves a `failed` booking holding a `booked` slot. Doing both in one transaction
is straightforward.

**Confirm + event.** The confirm `UPDATE` and the RabbitMQ publish cannot share a
transaction. The standard fix is a transactional outbox: `INSERT INTO outbox` in the
same transaction as the confirm, and a relay that publishes and marks rows sent. Not
implemented.

## `withTransaction` details

```ts
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const result = await fn(client);
  await client.query('COMMIT');
  return result;
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

- If `ROLLBACK` itself throws (connection already dead), that error replaces the
  original one.
- `client.release()` is called without the error argument, so a broken connection is
  returned to the pool instead of being destroyed. `pg` usually evicts it on its `error`
  event, but not in every case.
- No retry on serialization failure / deadlock (not needed at `READ COMMITTED` with a
  single-row lock, but worth adding if the isolation level or lock set changes).
- The `failDatabase` simulation is checked before `pool.connect()`, so it never fails a
  transaction halfway.

## Connection pool

| Setting | Value |
|---|---|
| `max` | `DB_POOL_MAX` (10 per API replica, 5 for the worker in Compose) |
| `connectionTimeoutMillis` | 5000 |
| `idleTimeoutMillis` | 30000 |
| statement timeout | not set |

Total possible connections in Compose: 3 × 10 + 5 = 35, below Postgres' default
`max_connections` of 100. Adding replicas multiplies this.

## Cancellation transaction

```text
┌─ tx ─────────────────────────────────────────┐
│ SELECT booking FOR UPDATE                     │
│ UPDATE booking → cancelled (WHERE confirmed)  │
│ UPDATE slot → open, version+1 (WHERE booked)  │
└───────────────────────────────────────────────┘
  invalidate slot cache (Redis, fail-open, after commit)
```

Unlike booking creation there is no remote call in the middle, so one transaction covers
the whole state change. The cache invalidation runs after commit. If it fails, the slot
list is stale for at most its 8s TTL.
