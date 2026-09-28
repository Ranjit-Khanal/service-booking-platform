# Database locking

This page is the reference for every lock and lock-like constraint in the code. The
narrative example lives in [concurrency.md](concurrency.md).

## Inventory

| Mechanism | Where | Scope | Held for |
|---|---|---|---|
| Row lock `SELECT … FOR UPDATE` | `PostgresServiceRepository.claimSlot` | one `time_slots` row | claim transaction (2 statements) |
| Row lock `SELECT … FOR UPDATE` | `PostgresBookingRepository.cancel` | one `bookings` row (+ its slot updated in the same tx) | cancel transaction (3 statements) |
| Conditional update `WHERE status='open'` | `claimSlot` | one row | single statement |
| Optimistic `version` column | `claimSlot`, `releaseSlot` | one row | compared once per claim |
| Conditional release `WHERE status='booked' AND NOT EXISTS (confirmed booking)` | `PostgresServiceRepository.releaseSlot` | one row | single statement (implicit transaction) |
| Unique partial index `bookings_confirmed_slot_uq` | migration | `bookings.slot_id WHERE status='confirmed'` | permanent |
| Unique index `bookings_idempotency_uq` | migration | `bookings.idempotency_key` | permanent |
| Unique index `processed_events.event_id` (PK) | migration | consumer dedupe | permanent |
| Unique index `time_slots_service_starts_uq` | migration | `(service_id, starts_at)` | permanent — no two slots for a service at the same start time |
| Redis `SET NX` cache-fill lock | `RedisCacheStore.getOrSet` | one cache key | ≤ 3s TTL |

No advisory locks, no table locks, no `SERIALIZABLE` transactions and no `NOWAIT` /
`SKIP LOCKED` are used. There are two explicit transactions in the codebase (`claimSlot`
and booking `cancel`); everything else runs as single autocommit statements.

Lock ordering: `claimSlot` locks a slot; `cancel` locks a booking and then updates its
slot. No code path locks a slot and then a booking, so the two cannot deadlock each
other.

## Problem

Slots are shared inventory. Any read-then-write on a slot row from two sessions can
interleave (see [concurrency.md](concurrency.md#naive-implementation)).

## Pessimistic lock: `SELECT … FOR UPDATE`

Under `READ COMMITTED` (Postgres' default; the code does not change it), `FOR UPDATE`
does two things:

- takes a row-level exclusive lock that conflicts with other `FOR UPDATE` and `UPDATE`
  on the same row, and
- when it had to wait, re-reads the **latest committed** version of the row rather than
  the snapshot from the start of the statement.

The second property is what makes the in-JS `row.status !== 'open'` check safe: the loser
sees `booked` after the winner commits.

```text
Session A                       Session B
BEGIN
SELECT … FOR UPDATE  ✔ lock
                                BEGIN
                                SELECT … FOR UPDATE  ⏳ wait on A
UPDATE … booked
COMMIT               ✔ release
                                ◀ row (booked, v2)
                                → return null
                                COMMIT
```

## Optimistic check: `version`

`version` is incremented on every claim and release. The use case passes the version it
read before starting the transaction. This detects an ABA-style change
(`open v1 → booked v2 → open v3`) that a status-only check would miss. In this code it
does not prevent any incorrect booking that the row lock would not already prevent;
its practical effect is to reject claims made from a stale view. It would become
load-bearing if the `FOR UPDATE` were ever removed.

## Release is guarded too

```sql
UPDATE time_slots
   SET status = 'open', version = version + 1
 WHERE id = $1 AND status = 'booked'
   AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id = $1 AND b.status = 'confirmed');
```

Compensation after a failed payment must never reopen a slot that somebody else
legitimately holds. Today a slot can only be held by one booking at a time, so the
`NOT EXISTS` is defensive; it protects against a future path (e.g. an admin re-assign)
that creates a second booking for the slot.

This statement runs **without** `FOR UPDATE` on the booking rows. Under `READ COMMITTED`
a concurrent transaction confirming a booking for the same slot could commit between the
subquery and the update. That cannot happen with the current flow (only the claimant has
a booking for the slot) but it is not a general-purpose guarantee.

## Unique indexes as the last line

| Index | Invariant | What a violation looks like today |
|---|---|---|
| `bookings_confirmed_slot_uq` | one confirmed booking per slot | `update()` throws `23505` → 500. The payment has already been taken at that point. Not reachable through the current flow. |
| `bookings_idempotency_uq` | one booking per idempotency key (any status) | `save()` throws `23505` → 500. Reachable if the Redis idempotency record expires or is lost and the client retries a key whose earlier attempt left a `failed` booking row and a released slot — and because `save()` runs after `claimSlot` commits and is outside the `try`, **the slot is left `booked` with no booking**. |
| `processed_events_pkey` | one notification per booking | Expected; handled with `ON CONFLICT DO NOTHING`. |

Constraint violations are not mapped to `AppError`s, so they surface as generic 500s.

## Failure scenarios

| Scenario | Effect on locks |
|---|---|
| Client disconnects mid-request | Node keeps running the handler; the transaction completes normally. |
| API process killed while holding the row lock | Postgres detects the dropped connection and rolls back; lock released. |
| `ROLLBACK` itself fails (connection dead) | `withTransaction` throws from the `catch`; `client.release()` still runs in `finally`. The broken client is returned to the pool without the `release(err)` flag, so `pg` may hand the dead connection out again (it is normally evicted on its `error` event). |
| Long-running holder | Waiters block indefinitely — no `lock_timeout` / `statement_timeout`. With the current 2-statement transaction this is theoretical. |
| Pool exhaustion | `pool.connect()` waits up to 5s, then throws → 500. |

## Trade-offs

- Pessimistic locking is simple and correct but requires a live DB round-trip per claim.
  At this scale that is not a constraint.
- Putting the invariant in unique indexes means correctness does not depend on every
  future code path remembering to lock.
- A `SERIALIZABLE` transaction would also be correct, but would push retry-on-serialization-failure
  logic into the application. Explicit row locks are easier to reason about for a
  single-row invariant.
