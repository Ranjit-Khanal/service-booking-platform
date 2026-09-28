# ADR 0003: Pessimistic row lock for slot claims, outside the payment call

Status: Accepted (recorded retroactively)

## Context

Concurrent requests for the same slot on different replicas must not both succeed. The
booking flow also includes a payment call that can take up to ~9.4s with retries.

## Options considered

1. **Check then update** in application code — broken under concurrency.
2. **Conditional update only**: `UPDATE … SET status='booked' WHERE id=$1 AND status='open'`
   and check the row count.
3. **Optimistic concurrency**: compare-and-swap on `version`.
4. **Pessimistic lock**: `SELECT … FOR UPDATE` in a transaction, then update.
5. **One transaction spanning claim, insert, payment and confirm.**
6. **Serializable isolation** with retry on serialization failure.

## Decision

Option 4, combined with 2 and 3 (`FOR UPDATE`, then an `UPDATE` guarded by
`status='open'`, with a `version` check), in a **short** transaction containing only the
claim. The payment call happens after commit. The slot's `booked` status is the
reservation; the booking's `pending_payment` status marks the reservation as provisional.
A partial unique index on confirmed bookings per slot is the final guard.

## Consequences

- Losers wait milliseconds on the lock and get `409 SLOT_UNAVAILABLE`; they never reach
  the payment provider.
- Connection and lock hold time are independent of payment latency.
- Failure after the claim requires compensation (`markFailed`, `releaseSlot`), which is
  best-effort. A crash between steps leaves an orphaned reservation that nothing cleans up
  (see [known-limitations.md](../known-limitations.md#orphaned-slots-and-pending-bookings)).

## Trade-offs

- Options 2 or 3 alone would be sufficient for correctness with one fewer statement; the
  combination is chosen for clarity and defence in depth.
- Option 5 would make compensation unnecessary for DB state but would hold a pooled
  connection and a row lock for the whole payment, and still could not roll back a charge.
- Option 6 is correct but pushes retry logic into the application for a single-row
  invariant that a row lock handles directly.
- The claim and the booking insert are in separate statements; moving the insert into the
  claim transaction would remove one crash window (`insertBookingWithClient` exists for
  this and is unused).
