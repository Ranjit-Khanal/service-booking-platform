# Failure injection

`FailureSimulator` (`backend/src/infrastructure/resilience/FailureSimulator.ts`) lets you
switch failures on at runtime to watch the resilience mechanisms react. The same
controls are on the demo client's **Ops** page (requires `DEMO_CLIENT_ADMIN_API_KEY`).

> Admin endpoints are **disabled unless `ADMIN_API_KEY` is set** (≥ 16 chars), and then
> require `X-Admin-Key`. Anyone holding that key can take the API down with these flags;
> leave it unset in real deployments. See [../security.md](../security.md).

## Flags

| Flag | Where it bites | Observable effect |
|---|---|---|
| `failPayment` | `MockPaymentProvider.charge` returns a decline | 402 `PAYMENT_FAILED`; booking `failed`; slot released. Breaker unaffected. |
| `paymentLatencyMs` | Delay inside the mock charge | Set above `PAYMENT_TIMEOUT_MS` (3000) to force timeouts → retries → 500; five such requests to the same replica open its breaker. |
| `failRedis` | Every Redis call on that replica (cache and read rate-limiting fail open; idempotency and write rate-limiting throw 503) | Reads still succeed on that replica; bookings 503; health 503 → HAProxy drops the replica. |
| `failDatabase` | `db.query` / `db.withTransaction` on that replica | 503 on DB-backed calls; health 503 → replica dropped. |
| `failBrokerPublish` | `publisher.publish` on that replica | Booking confirmed and charged, client gets 503, no notification, key stuck. Demonstrates the dual-write problem. |

## Usage

```bash
# In .env: ADMIN_API_KEY=<16+ chars>, then `docker compose up -d` to apply
ADMIN="X-Admin-Key: $ADMIN_API_KEY"

# Read (from whichever replica HAProxy picks)
curl -s -H "$ADMIN" http://localhost:8080/api/admin/failures | jq

# Set — POST replaces ALL flags; omitted ones become false/0
curl -s -X POST http://localhost:8080/api/admin/failures \
  -H "$ADMIN" -H 'content-type: application/json' \
  -d '{"paymentLatencyMs": 4000}'

# Reset
curl -s -X POST http://localhost:8080/api/admin/failures \
  -H "$ADMIN" -H 'content-type: application/json' -d '{}'
```

## The per-replica catch

Flags live in process memory. Through HAProxy, each call reaches one of three replicas
in round-robin, so one `POST` changes one replica. To affect all three, send the `POST`
three times in a row (round-robin makes that land once on each, if nothing else is
hitting the API) and confirm with `GET /api/health` → `failures`, `instanceId`.

`failRedis` and `failDatabase` make the replica fail its health check, after which
HAProxy stops routing to it — **including your reset request**. To recover, restart that
container (`docker compose restart api2`) or wait for a restart to clear memory.

## Suggested experiments

1. **Circuit breaker:** set `paymentLatencyMs: 4000` on all replicas, make ~15 bookings,
   watch `/api/health` → `circuitBreaker` go `open` per replica; reset, wait 15s, book
   again → `closed`.
2. **Dual write:** set `failBrokerPublish: true`, book, then check
   `GET /api/bookings/{id}` (confirmed) and the worker log (no `EMAIL_SENT`).
3. **Stuck idempotency key:** set `failPayment: true`, book with key K (402), reset,
   book again with K → 409.
4. **Poison message / DLQ:** in the management UI (http://localhost:15673 → Queues →
   `notifications` → Publish message), publish the payload `not json`. The worker log
   shows four failures, and the message ends up in `notifications.dlq`.
5. **Duplicate delivery:** publish the same valid `booking.created` JSON body twice via
   the management UI; the second is logged as `Duplicate notification suppressed`.
