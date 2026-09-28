# Failure scenarios

Populated from the code, not from intent. "Recovery" means what the system does on its
own; "manual" means an operator has to act. **(verified)** marks rows exercised against a
running Compose stack on 2026-09-28; the rest are derived from reading the code.

The `FailureSimulator` flags (`POST /api/admin/failures`) reproduce several of these on
**one replica at a time**; see [../operations/failure-injection.md](../operations/failure-injection.md).

## Matrix

| Failure | Expected behavior | Recovery |
|---|---|---|
| **PostgreSQL unavailable** | Every DB call fails after up to 5s (pool connect timeout) → 500 `INTERNAL_ERROR` (simulated: 503). Catalog reads that hit the Redis cache still succeed on a replica. `/api/health` → 503 → HAProxy removes all replicas → HAProxy 503. Worker message handling fails → 3 immediate republishes → DLQ. | Automatic for the API once Postgres is back (pool reconnects; HAProxy re-adds replicas after 2 passing checks). **Manual** for notifications that reached the DLQ. |
| **PostgreSQL fails mid-booking** | Depends on the step: before claim → nothing changed; after claim → compensation (`releaseSlot`) also fails → slot stays `booked`, booking `pending_payment` or absent. | **Manual** cleanup of orphaned slots/bookings. |
| **Redis unavailable** **(verified)** | Per replica: reads 200 (rate limiter and cache fail open), `POST /api/bookings` 500 (fail closed), `/api/health` 503. Through HAProxy: all replicas drained → 503 for everything. | Automatic: healthy through HAProxy ~10s after Redis returned. |
| **Redis restarted / data lost** | Cache and counters reset (harmless). Idempotency records lost: retries of completed requests are treated as new and get 409/500 instead of a replay. | Automatic, except the lost replays. |
| **RabbitMQ unavailable at startup** | API and worker exit with code 1. | Automatic: `restart: unless-stopped` retries until the broker is up. |
| **RabbitMQ restarts at runtime** **(verified)** | API and worker detect the closed channel/connection, shut down gracefully, and are restarted with a fresh connection. Bookings in flight at that moment may be confirmed but get a 500 with no event. | Automatic. Next booking after restart: 201. |
| **Broker publish fails** (simulated `failBrokerPublish`) | Booking already `confirmed` and charged; client receives 503; idempotency key stuck `in_progress`; no notification. | **None.** Event is never re-sent. |
| **Broker accepts publish, then crashes before persisting** | No publisher confirms → API believes it succeeded. Event lost. | **None.** |
| **Worker crashes** **(verified via broker restart)** | Unacked messages (≤10) redelivered; queue grows while down. Duplicates suppressed via `processed_events`. | Automatic restart (Compose policy). |
| **Worker crashes between `processed_events` insert and send** | Row exists → redelivery suppressed → notification never sent (mark-then-send). | **None.** (No real email is sent today, so there's no visible effect yet.) |
| **Duplicate message** | `INSERT … ON CONFLICT DO NOTHING` returns 0 rows → logged as suppressed → acked. | n/a |
| **Poison message** (bad JSON, handler bug) | 4 attempts, then DLQ. | **Manual** via management UI. |
| **Payment provider slow** | 3s timeout × 3 attempts; then booking `failed`, slot released, 500. | Automatic per request. |
| **Payment provider down** | Timeouts open the per-replica breaker after 5 failed sequences; then immediate 500s; half-open after 15s. Declines never open it. | Automatic (breaker). |
| **Payment declined** | Booking `failed`, slot released, 402. | n/a |
| **Request timeout (client or HAProxy 50s)** | Client sees a timeout/504; API keeps processing and may complete the booking. Retry with the same key → 409 while running, replay after completion. | Client must query `GET /api/bookings?email=` if the first attempt failed after confirm. |
| **Duplicate create, sequential** (same key) **(verified)** | Replay: 200 with the original booking. | n/a |
| **Duplicate create, concurrent** (same key) | One proceeds, the other gets 409 immediately. | Client retries later → replay. |
| **Same key, different body** **(verified)** | 409 `CONFLICT`, `details.code = IDEMPOTENCY_CONFLICT`. | n/a |
| **Client retries after a failed attempt** (same key) | 409 "in progress" for 24h. | Client must use a new key. |
| **Two+ customers, one slot** **(verified, 6 concurrent)** | One 201, the rest 409 `SLOT_UNAVAILABLE`. | n/a |
| **Duplicate / concurrent cancel** **(verified, 10 concurrent)** | One transition; the rest return 200 `changed:false`; slot version bumped once. | n/a |
| **Cancel while payment in progress** | 409 `INVALID_STATE_TRANSITION`. | Retry after the create request finishes. |
| **Provider disappears during assignment** | Not applicable: there is no provider or assignment model. | n/a |
| **API process crashes mid-booking** | In-flight transaction rolled back by Postgres; anything committed stays. Orphans possible (see lifecycle). HAProxy removes the replica after ~6s. | Process restarted automatically; **manual** cleanup of orphans. |
| **API receives SIGTERM with requests in flight** | Stops accepting, finishes in-flight requests, closes AMQP/Redis/Postgres, exits 0; forced exit at 25s. Compose waits 30s. | Orchestrator restarts it. |
| **Worker receives SIGTERM** | Cancels consumer, closes connections, exits; in-flight message redelivered. | n/a |
| **One API replica hung** (event loop blocked) | Health checks time out (2s) → removed after 3 checks. | Automatic re-add when it recovers. |
| **Rate limit exceeded** | 429 for that client IP only. Health checks are exempt. | Automatic after ≤ `RATE_LIMIT_WINDOW_MS`. |
| **Missing / wrong API key** **(verified)** | 401. | n/a |
| **Cache stale after booking** | UI may show a booked slot as open for ≤8s; booking attempt gets 409. | Automatic (TTL). |
| **Stack restarted (`docker compose up`)** **(verified)** | Seed sees existing services and skips; data preserved. | n/a |

## Scenario walk-throughs

### Client times out, retries with the same key

```text
t0   client ─POST (key K)──► api2: begin(K) acquired, claim, insert, charge…
t50  HAProxy timeout server ─► client gets 504
t52  client ─POST (key K)──► api1: begin(K) → in_progress → 409
t55  api2: confirm, publish, complete(K)
t60  client ─POST (key K)──► api3: begin(K) → completed → 200 replayed: true
```

This is the case idempotency is designed for, and it works as long as the first attempt
eventually succeeds. If it fails, step t60 returns 409 for the next 24h.

### Payment succeeds, publish fails

```text
confirm booking   ✔ committed
publish           ✗ ServiceUnavailableError / channel closed
catch: status is 'confirmed' → no compensation
client            ◄ 503 (simulated) or 500 (real)
retry (same key)  ◄ 409 in progress (for 24h)
notification      never sent
```

The client is told an error occurred for an operation that actually succeeded and charged
them. The fix is an outbox (write the event row in the confirm transaction, publish from a
relay), or at minimum calling `complete()` before publishing and treating a publish failure
as non-fatal. See [known-limitations.md](../architecture/known-limitations.md).

### Redis goes away (verified)

```text
GET  /api/services  → rate limiter: Redis error, GET → fail open → cache miss → Postgres → 200
POST /api/bookings  → rate limiter: Redis error, POST → fail closed → 500
GET  /api/health    → redis: false → 503
HAProxy             → 3 failed checks per replica → all DOWN → HAProxy 503 to clients
Redis back          → ioredis reconnects → health 200 → 2 passing checks → UP (~10s total)
```

### RabbitMQ restarts (verified)

```text
broker stops          → api channel 'close' → onConnectionLost → SIGTERM to self
                      → server.close (drain) → close redis/pg → exit 0
Compose               → restart api (connect fails while broker is down → exit 1 → retry)
broker back           → api connects, asserts topology, listens
next POST /api/bookings → 201, event published
```

## What the application does not recover from on its own

1. Slots stuck in `booked` with no booking, or with a `pending_payment` booking.
2. Charges made for bookings that never reached `confirmed`.
3. Confirmed bookings whose `booking.created` event was never published or was lost.
4. Messages in `notifications.dlq`.
5. Idempotency keys stuck `in_progress` after a failed attempt (self-heals after 24h).
