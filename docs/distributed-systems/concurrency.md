# Concurrency: two customers, one slot

## Problem

Three API replicas share one Postgres. Two customers see the same open 10:00 slot and
press "Book" within the same few milliseconds. Their requests land on different replicas.
Exactly one of them may end up with a confirmed booking and a charge.

Node's single thread does not help here: the two requests are in different processes,
and even within one process every `await` is a point where another request can run.

## Naive implementation

```ts
const slot = await db.query('SELECT status FROM time_slots WHERE id = $1', [slotId]);
if (slot.rows[0].status !== 'open') throw new SlotUnavailableError();
await db.query("UPDATE time_slots SET status = 'booked' WHERE id = $1", [slotId]);
await db.query('INSERT INTO bookings …');
await charge();
```

Interleaving that breaks it:

```text
time   api1 (Request A)                      api2 (Request B)
 t0    SELECT status → 'open'
 t1                                          SELECT status → 'open'
 t2    UPDATE status='booked'   (1 row)
 t3                                          UPDATE status='booked'   (1 row, no-op overwrite)
 t4    INSERT booking A
 t5                                          INSERT booking B
 t6    charge A ✔                            charge B ✔
       → two customers charged for one slot
```

Both reads happen before either write. The `UPDATE` in B succeeds because nothing in its
`WHERE` clause says "only if still open". This is a classic lost update /
check-then-act race, and it happens under Postgres' default `READ COMMITTED` isolation.

## Actual implementation

`PostgresServiceRepository.claimSlot` (`backend/src/infrastructure/repositories/PostgresServiceRepository.ts`):

```sql
BEGIN;
SELECT * FROM time_slots WHERE id = $1 FOR UPDATE;          -- row lock
-- in JS: return null unless status = 'open' AND version = expectedVersion
UPDATE time_slots
   SET status = 'booked', version = version + 1
 WHERE id = $1 AND status = 'open'
RETURNING *;
COMMIT;
```

Three independent guards are layered here:

1. **`SELECT … FOR UPDATE`** — the second transaction blocks on the row lock until the
   first commits, then reads the *committed* row (status `booked`).
2. **`WHERE status = 'open'` on the UPDATE** — even if the lock were removed, the update
   is conditional, so it would affect zero rows for the loser.
3. **`version` check** — the use case passes the `version` it read *before* the
   transaction (`findSlotById`). If anything changed the slot in between (claim, release),
   the claim is rejected.

Plus a fourth guard one level down:

4. **`bookings_confirmed_slot_uq`** — a partial unique index allowing at most one
   `confirmed` booking per slot. If the three guards above were ever bypassed, the second
   confirm would fail with a unique violation.

### The same race, with the real code

```text
time   api1 (Request A)                              api2 (Request B)
 t0    findSlotById → open, v1
 t1                                                  findSlotById → open, v1
 t2    BEGIN
 t3    SELECT … FOR UPDATE  → lock acquired, open v1
 t4                                                  BEGIN
 t5                                                  SELECT … FOR UPDATE  → BLOCKS
 t6    UPDATE … status='booked', v2   (1 row)              │
 t7    COMMIT  → lock released                              │
 t8                                                  ← returns row: booked, v2
 t9                                                  status ≠ 'open' → return null
 t10                                                 COMMIT
 t11   INSERT booking A (pending_payment)            → 409 SLOT_UNAVAILABLE
 t12   charge A ✔ → confirmed
```

B never reaches the payment provider. The lock is held for two statements only
(t3–t7); the payment call happens **after** commit.

### Why the lock is not held during payment

The obvious alternative is one transaction spanning claim → insert → charge → confirm.
That would hold a row lock and a pooled connection for up to ~9.4 seconds (3 attempts ×
3s timeout + backoff). With `DB_POOL_MAX=10` per replica, ten slow payments would
exhaust a replica's pool and every other request on it — including reads — would queue
for a connection (`connectionTimeoutMillis: 5000`, then fail).

Instead the slot's `booked` status acts as a **logical reservation** that survives
across transactions, and the booking's `pending_payment` status records that the
reservation is not final yet. The cost of this choice is that failure between steps
needs compensation (release the slot), and compensation is not guaranteed if the process
dies — see [Trade-offs](#trade-offs).

## Failure scenarios

| Situation | Behavior |
|---|---|
| Two requests for the same slot at the same moment | One wins; the other waits on the row lock for a few ms, then gets `409 SLOT_UNAVAILABLE`. Verified by `tests/concurrency/slot-claim.test.ts`. |
| Many requests (N) for the same slot | They queue on the row lock serially; N−1 get 409. No `lock_timeout` or `NOWAIT` is set, so waiters wait as long as the holder takes (normally milliseconds). |
| Winner's payment fails | Slot is released (`status='open'`, `version+1`). A loser that retries now sees the new version and can claim it. Losers that already got 409 are not notified. |
| Process crashes while holding the lock | Postgres aborts the transaction when the connection drops; the lock is released and the slot stays `open`. |
| Process crashes after commit, before `INSERT booking` | Slot stays `booked` with no booking. **Not recovered.** |
| Process crashes after `INSERT booking`, during payment | Booking stays `pending_payment`, slot stays `booked`. **Not recovered.** |
| Postgres unavailable | `pool.connect()` fails (5s connect timeout); request returns 500. No state changed. |
| Stale cached slot list shows a booked slot as open | Client submits; claim transaction sees `booked` → 409. The cache can mislead the UI but not the booking. |
| Client retries after a 409 with a fresh slot version | Works if the slot was released; otherwise 409 again. |
| Same customer, same slot, same `Idempotency-Key`, sent twice concurrently | The second request is stopped earlier, in Redis (`409` "in progress"), and never reaches the lock. See [idempotency.md](idempotency.md). |
| Same customer, same slot, **different** keys, concurrently | Treated as two customers: one wins, one gets 409. |

## Trade-offs

- **Serialisation on hot slots.** All claims for one slot are serialised by the row lock.
  That is the point, and it is cheap because the critical section is two statements. It
  would matter only for extremely contended rows.
- **Version check can reject a valid claim.** The version is read before the
  transaction. If the slot was claimed and then released in between (payment failed),
  it is open again but has a newer version, so the claim is rejected with 409 and the
  client has to refetch. Correct, slightly unfriendly.
- **Belt and braces.** `FOR UPDATE` alone is sufficient for correctness under
  `READ COMMITTED`; the conditional `UPDATE` alone would also be sufficient. Keeping
  both makes each easy to explain in isolation, at the cost of a redundant round-trip.
- **Claim and insert are not atomic.** `insertBookingWithClient` exists in
  `PostgresBookingRepository.ts` for doing both in one transaction, but it is unused.
  Moving the insert into the claim transaction would remove the "booked slot with no
  booking" crash window at no real cost.
- **No expiry of reservations.** A pessimistic hold without a TTL relies on the process
  staying alive long enough to compensate. A `held_until` column or a periodic reaper
  would close this gap.

## Cancellation

`POST /api/bookings/{id}/cancel` changes two rows (booking and slot), and clients retry it.
The race to avoid:

```text
time   api1 (cancel A)                     api2 (cancel B, a retry)
 t0    read booking → confirmed
 t1                                        read booking → confirmed
 t2    UPDATE booking cancelled
 t3    UPDATE slot open, version+1  (v3)
 t4                                        UPDATE booking cancelled
 t5    ─── meanwhile a new customer claims the slot (v3 → booked v4) ───
 t6                                        UPDATE slot open, version+1  ← reopens someone else's slot
```

`PostgresBookingRepository.cancel` does everything in one transaction that starts with
`SELECT … FROM bookings WHERE id = $1 FOR UPDATE`. The second cancel blocks on the booking
row, then reads `cancelled` and returns `already_cancelled` without touching the slot.
Booking and slot change in the same commit, so there is no window where the booking is
cancelled but the slot is still booked (or the reverse).

Verified by `tests/concurrency/booking-cancel.test.ts`: 10 concurrent cancels produce
exactly one `cancelled`, nine `already_cancelled`, and the slot's version goes up exactly
once. A second test cancels, then races two claims on the reopened slot; exactly one wins.

Only `confirmed` bookings can be cancelled. A `pending_payment` booking is owned by a
create request that may be about to write `confirmed` or `failed` with an unconditional
`UPDATE`; letting cancel run concurrently would let that write overwrite `cancelled`.
