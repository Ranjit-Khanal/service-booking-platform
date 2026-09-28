# Request flow

This page follows real requests through the code. File references are relative to
`backend/src/`.

## Middleware chain (every request)

`interfaces/http/createHttpApp.ts`:

```text
trust proxy = TRUST_PROXY        req.ip from X-Forwarded-For behind HAProxy
helmet (CORP: cross-origin)
  → cors({origin: CORS_ORIGINS})
  → express.json({limit:100kb})
  → requestContextMiddleware     x-request-id / x-correlation-id, per-request logger
  → GET /api/health              ← answered here: no rate limit, no auth
  → createRateLimitMiddleware    Redis INCR keyed by client IP; on Redis error: GET/HEAD
                                 pass (fail open), mutations fail (fail closed)
  → /api/admin/*                 adminAuthMiddleware (X-Admin-Key; 404 if ADMIN_API_KEY unset)
  → /api/*                       apiKeyAuthMiddleware (Bearer / X-API-Key) → router
  → 404 handler                  NOT_FOUND
  → errorMiddleware              AppError → its status; anything else → 500 INTERNAL_ERROR
```

Health is mounted before rate limiting and auth so that load-balancer checks neither
consume a client's quota nor need a key.

## Routes

| Method | Path | Handler | Backing store |
|---|---|---|---|
| GET | `/` | inline | — |
| GET | `/api/health` (no auth) | `AdminController.health` | `SELECT 1`, Redis `PING` |
| GET | `/api/services` | `CatalogController.services` | Redis cache (60s) → Postgres |
| GET | `/api/services/:id` | `CatalogController.service` | Redis cache (120s) → Postgres |
| GET | `/api/services/:id/slots?date=YYYY-MM-DD` | `CatalogController.slots` | Redis cache (8s) → Postgres |
| POST | `/api/bookings` | `BookingController.create` | Redis + Postgres + payment + RabbitMQ |
| GET | `/api/bookings/:id` | `CatalogController.booking` | Postgres (never cached) |
| GET | `/api/bookings?email=` | `CatalogController.bookingsByEmail` | Postgres (never cached) |
| POST | `/api/bookings/:id/cancel` | `BookingController.cancel` | Postgres transaction, Redis cache invalidation |
| GET | `/api/admin/failures` | `AdminController.getFailures` | process memory |
| POST | `/api/admin/failures` | `AdminController.setFailures` | process memory |
| POST | `/api/admin/cache/flush` | `AdminController.flushCache` | Redis `SCAN` + `DEL` |

`/api/*` routes need an API key (unless `AUTH_MODE=none`); `/api/admin/*` needs the admin
key. Path IDs that are not UUIDs return 404 before touching the database.

## `POST /api/bookings` — the critical path

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant H as HAProxy
    participant A as API replica
    participant R as Redis
    participant P as Postgres
    participant PAY as PaymentProvider
    participant Q as RabbitMQ
    participant W as Worker

    C->>H: POST /api/bookings (Idempotency-Key)
    H->>A: forward (round-robin)
    A->>R: INCR rl:{ip}:{window}
    A->>R: SET idem:{key} in_progress NX EX 86400
    alt key exists and completed
        A->>P: SELECT booking BY idempotency_key
        A-->>C: 200 replayed: true
    else key exists and in_progress
        A-->>C: 409 CONFLICT
    end
    A->>P: SELECT service, SELECT slot (version)
    A->>P: BEGIN; SELECT slot FOR UPDATE; UPDATE status='booked'; COMMIT
    alt slot not open / version changed
        A-->>C: 409 SLOT_UNAVAILABLE
    end
    A->>R: DEL cache slots for service (+ SCAN prefix)
    A->>P: INSERT booking (pending_payment)
    A->>PAY: charge() [timeout 3s × up to 3 attempts, circuit breaker]
    alt payment declined / timed out / circuit open
        A->>P: UPDATE booking failed; UPDATE slot open (if no confirmed booking)
        A->>R: DEL slot cache
        A-->>C: 402 / 500
    end
    A->>P: UPDATE booking confirmed, payment_reference
    A->>Q: publish booking.created (persistent)
    A->>R: SET idem:{key} completed EX 86400
    A-->>C: 201 Created
    Q->>W: deliver
    W->>P: INSERT processed_events ON CONFLICT DO NOTHING
    W->>W: log EMAIL_SENT
    W->>Q: ack
```

### Step by step (`application/use-cases/CreateBookingUseCase.ts`)

1. **Validate.** `Idempotency-Key` non-empty (≤ 255 chars), `serviceId`/`slotId` UUIDs,
   `customerName` non-empty (≤ 200), `customerEmail` matching a simple regex (≤ 320).
2. **Hash the payload.** SHA-256 of `{serviceId, slotId, lowercased email, trimmed name}`.
   Used to detect a key reused with a different body.
3. **`idempotency.begin`.** Redis `SET … NX EX`. Returns `acquired`, `in_progress` or
   `completed`. See [idempotency.md](../distributed-systems/idempotency.md).
4. **Load service and slot** outside any transaction. The slot's `version` is captured
   here.
5. **Claim the slot** in a short transaction (`PostgresServiceRepository.claimSlot`):
   lock the row, check `status = 'open'` and `version = expected`, set
   `status = 'booked'`, bump `version`. See [concurrency.md](../distributed-systems/concurrency.md).
6. **Invalidate the slot cache** for that service, so other replicas stop listing the
   slot as open.
7. **Insert the booking** as `pending_payment`. This is a separate statement, not in the
   claim transaction.
8. **Charge.** `CircuitBreaker.exec(withRetry(withTimeout(charge())))`. Only timeouts
   are retried. See [retries.md](../distributed-systems/retries.md).
9. **On a declined payment**: mark booking `failed`, release the slot, invalidate cache,
   return `402 PAYMENT_FAILED`.
10. **On success**: mark booking `confirmed` with the payment reference.
11. **Publish** `booking.created` to the `booking.events` topic exchange.
12. **`idempotency.complete`**: overwrite the Redis record with the request hash and a
    summary body; reset TTL.
13. Respond `201` (or `200` with `replayed: true` for a replay).

Any exception thrown after step 7 while the booking is still `pending_payment` triggers
the compensating path in the `catch` block (mark failed, release slot, invalidate cache —
each best-effort with `.catch(() => undefined)`). Exceptions after step 10 do **not**
compensate, because the booking is already `confirmed` and the customer has been charged.

### Response codes you will actually see

| Situation | Status | `error.code` |
|---|---|---|
| Created | 201 | — |
| Replay of a completed key, same body | 200 (`replayed: true`) | — |
| Missing/invalid API key | 401 | `UNAUTHORIZED` |
| Missing idempotency key / bad email / empty name / non-UUID IDs | 400 | `VALIDATION_ERROR` |
| Unknown or inactive service, slot not in service | 404 | `NOT_FOUND` |
| Same key still in progress (or its earlier attempt failed) | 409 | `CONFLICT` |
| Same key, different body, after completion | 409 | `CONFLICT` (with `details.code = IDEMPOTENCY_CONFLICT`) |
| Slot already booked or version moved | 409 | `SLOT_UNAVAILABLE` |
| Payment declined (mock `failPayment`) | 402 | `PAYMENT_FAILED` |
| Payment timed out on every attempt | 500 | `INTERNAL_ERROR` (the timeout is a plain `Error`; `ExternalTimeoutError` exists but is unused) |
| Circuit open | 500 | `INTERNAL_ERROR` |
| Simulated Redis / DB / broker failure | 503 | `SERVICE_UNAVAILABLE` |
| Real Redis / Postgres outage | 500 | `INTERNAL_ERROR` (driver errors are not mapped to 503) |
| RabbitMQ connection lost mid-request (after confirm) | 500 | `INTERNAL_ERROR`; booking is confirmed (process then restarts) |
| Rate limited | 429 | `RATE_LIMITED` |

## Read paths

### `GET /api/services/:id/slots?date=YYYY-MM-DD`

```text
ListSlotsUseCase
  → CatalogCache.getService(id)          GET cache:catalog:service:{id} → else SELECT, SET 120s
  → CatalogCache.getOpenSlots(id, date)  getOrSet cache:catalog:slots:{id}:{date}, TTL 8s
        miss → SET NX lock (3s) → SELECT … WHERE status='open' AND starts_at in [date, date+1d)
```

Response header `Cache-Control: private, max-age=0, must-revalidate`, so browsers and
proxies do not add a second stale layer on top of Redis.

A slot list can be stale for up to 8 seconds (or longer, see
[caching.md](../distributed-systems/caching.md#stale-write-after-invalidation)). That is
acceptable because the list is advisory: the claim transaction re-reads the row under a
lock and rejects a slot that is no longer open.

### `GET /api/bookings/:id` and `GET /api/bookings?email=`

Straight Postgres reads. Bookings are never cached because they are the one thing a user
expects to be immediately correct after a write.

## Worker flow

`worker.ts` → `bindBookingCreatedConsumer` → `BookingCreatedConsumer.handle` →
`LoggingNotificationSender.sendBookingConfirmation`.

1. Parse the JSON body. A parse error is treated like any other failure (retry, then DLQ).
2. Ignore any event whose `type` is not `booking.created` (acked, not dead-lettered).
3. `INSERT INTO processed_events (event_id) … ON CONFLICT DO NOTHING`, with
   `event_id = booking.created:{bookingId}:email`. Zero rows inserted → duplicate → return.
4. Log `EMAIL_SENT` (no real email is sent).
5. `ack`.

On failure: if `x-retry < 3`, ack and republish a copy with `x-retry + 1`; otherwise
`nack(requeue=false)` → dead-letter to `notifications.dlq`. See
[messaging.md](../distributed-systems/messaging.md).

## `POST /api/bookings/:id/cancel`

`CancelBookingUseCase` → `PostgresBookingRepository.cancel`:

```text
BEGIN
  SELECT * FROM bookings WHERE id = $1 FOR UPDATE        -- concurrent cancels queue here
  not found          → 404 (nothing written)
  status cancelled   → 200 changed:false
  status ≠ confirmed → 409 INVALID_STATE_TRANSITION
  Booking.cancel()                                       -- entity guard
  UPDATE bookings SET status='cancelled' … WHERE id=$1 AND status='confirmed'
  UPDATE time_slots SET status='open', version=version+1 WHERE id=$slot AND status='booked'
COMMIT
→ invalidate slot cache (fail-open)
← 200 changed:true
```

No payment refund and no event. See
[../distributed-systems/concurrency.md](../distributed-systems/concurrency.md#cancellation).
