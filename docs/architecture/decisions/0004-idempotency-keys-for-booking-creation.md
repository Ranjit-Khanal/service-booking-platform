# ADR 0004: `Idempotency-Key` header for booking creation, stored in Redis

Status: Accepted (recorded retroactively)

## Context

`POST /api/bookings` claims inventory and charges money. Responses can be lost after the
work is done (client timeout, HAProxy 50s timeout, network drop). Clients need a safe way
to retry, and a retry can land on any replica.

## Options considered

1. **No idempotency** — rely on the slot lock to reject retries (the customer sees 409 for
   a booking that succeeded).
2. **Natural key** — dedupe on `(slot_id, customer_email)`.
3. **Client-supplied `Idempotency-Key`**, record in Postgres.
4. **Client-supplied `Idempotency-Key`**, record in Redis with `SET NX`, Postgres unique
   index as backstop.

## Decision

Option 4. The key is required. A SHA-256 hash of the normalised payload is stored with it
to reject reuse with a different body. Records live for `IDEMPOTENCY_TTL_SECONDS` (24h).
Redis errors make the request fail (fail-closed).

## Consequences

- Concurrent duplicates are rejected atomically on any replica (`SET NX`).
- Sequential duplicates after success replay the booking with `200` and `replayed: true`.
- If Redis loses the record, Postgres' `UNIQUE (idempotency_key)` still prevents a
  second booking row — but the client gets 409/500 rather than a replay.
- No bookings can be made while Redis is unavailable.

## Trade-offs

- Redis makes the fast path cheap but the record is less durable than the booking it
  protects. Option 3 would be as durable as the booking at the cost of one more write
  per request.
- As implemented, failed attempts leave the record `in_progress` until TTL, so a client
  that retries with the same key after a failure is blocked for 24h. This contradicts the
  intent ("safe client retries") and is listed in
  [known-limitations.md](../known-limitations.md#idempotency-key-stuck-after-a-failed-attempt).
- The key is not forwarded to the payment provider by the current adapters, so it does
  not deduplicate charges across the in-request retry loop.
