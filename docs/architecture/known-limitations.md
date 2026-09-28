# Known limitations

Problems found while reviewing the codebase. Each entry says what the problem is, how it
shows up, and a proportionate fix. Ordered roughly by impact. Items fixed so far are
listed at the end with how they were verified.

## Correctness

### Idempotency key stuck after a failed attempt
Failures never call `complete()` or delete the record, so the key stays `in_progress`
for `IDEMPOTENCY_TTL_SECONDS` (24h) and every retry returns 409. This defeats the retry
use case for exactly the transient errors (timeouts, 503) that invite retries.
**Fix:** delete the record on failures that did not charge, or store the failure
response and replay it.

### Confirmed-but-unnotified bookings (dual write)
The booking is confirmed (and paid) before the event is published. A publish failure
returns 5xx to the client, leaves the key stuck, and the event is never sent. There are
also no publisher confirms. **Fix:** transactional outbox, or at least `complete()` before
`publish()` and treat a publish failure as non-fatal + log it for replay.

### Orphaned slots and pending bookings
No recovery exists for:
- a crash (or `INSERT` failure) between the `claimSlot` commit and `bookings.save`: slot
  `booked`, no booking;
- a crash during payment: booking `pending_payment` forever, slot `booked`;
- a crash between `markFailed` and `releaseSlot`.

**Fix:** insert the booking inside the claim transaction (`insertBookingWithClient`
already exists), wrap fail+release in one transaction, and add a reaper that fails
stale `pending_payment` bookings after reconciling with the payment provider.

### Payment adapters ignore the idempotency key
`charge()` receives `idempotencyKey`, but the mock issues a new reference per call and
the Stripe/eSewa adapters are stubs that always succeed. Combined with retry-on-timeout
(which doesn't cancel the original call), a real provider integration built on this
shape would double-charge. **Fix:** forward the key as the provider's idempotency key.

### Mark-then-send in the notification consumer
`processed_events` is inserted before the (simulated) email. A crash in between loses the
email permanently. Acceptable while the sender only logs; must be revisited with a real
email provider.

### Consumer retry without backoff, and ack-before-republish
Retries are immediate (a DB outage burns all 4 attempts in milliseconds), and a crash
between `ack` and `sendToQueue` loses the message. **Fix:** a retry queue with
per-message TTL dead-lettering back to the main queue.

### Errors mapped to 500 instead of 503/504
Real Postgres/Redis connection errors, payment timeouts (the unused
`ExternalTimeoutError` exists for this), an open circuit and unique violations all return
`500 INTERNAL_ERROR` with no `retryable` hint. Only simulated failures produce 503.

### Cancellation does not refund or emit an event
`PaymentProvider` has no refund operation, and there is no `booking.cancelled` event.
Integrators must refund using `paymentReference` and poll or track cancellations
themselves.

## Availability

### Redis outage drains every replica
Reads work on each replica without Redis, but `/api/health` includes Redis, so HAProxy
removes all replicas and clients get 503 for everything. Deliberate trade-off (health
signals "cannot take bookings"), but it means a cache/coordination outage becomes a full
outage. A separate readiness check for reads vs. writes would decouple them.

### Broker restart restarts every API replica
Recovery from RabbitMQ loss is "exit and let the supervisor restart", so all replicas
restart together and in-flight confirmed bookings get a 500 with no event. An outbox
would remove the broker from the request path entirely.

### Single instances of stateful services
One Postgres, one Redis, one RabbitMQ, no backups configured.

## Security

### Coarse authorization
API keys identify a client application, not a user. Any key can read any booking,
list bookings by any email and cancel any booking. There is no per-key scoping, key
rotation endpoint or audit log. Fine for a single trusted backend-to-backend
integration; not for multi-tenant use.

### No TLS, open CORS by default
See [../security.md](../security.md).

## Product gaps

- No catalog management API: services and slots come from the seed or SQL.
- No provider/staff model or assignment, no customer accounts, no rescheduling.
- No pagination on list endpoints.
- No expiry for unpaid bookings; no slot-in-the-past check when booking.
- Only the mock payment provider is functional; notifications are logged, not sent.

## Operational

### Per-replica state behind a load balancer
Circuit breaker state, failure-injection flags and cache metrics are process-local, so
`/api/health` and `/api/admin/failures` answer differently depending on which replica
HAProxy picks.

### Single-file migration runner
`migrate.ts` hard-codes `001_init.sql`; there is no migrations table.

### Dev dependencies in the runtime image
The release stage copies `node_modules` from the full install (needed today because
`migrate`/`seed` run through `tsx` from the same image).

### Unbounded growth
`processed_events`, `notifications.dlq` and the `notifications` queue (while the worker
is down) have no retention or length limits.

### `docker compose run` against a running stack
During testing, running `docker compose run --rm seed` against a running stack was
followed by Postgres being recreated and left detached from the network until the stack
was re-upped. The cause wasn't pinned down. Prefer `docker compose exec api1 npx tsx src/infrastructure/database/seed.ts`
on a running stack.

## Code hygiene

- Slot status `held` exists in the schema and entity; nothing writes it.
- `Money` value object, `TimeSlot.markBooked()`, `insertBookingWithClient` and
  `ExternalTimeoutError` are unused.
- `registerGracefulShutdown` supports `stopWorkers`; nothing passes it, and the worker has
  its own handler.
- `tests/integration` and `tests/api` are empty directories with npm scripts pointing at
  them.
- `CreateBookingUseCase` (application layer) imports `withRetry`, `withTimeout` and the
  `CircuitBreaker` type from `infrastructure/resilience`.

## Fixed

| Problem | Change | Verified by |
|---|---|---|
| No authentication; admin endpoints (failure injection) public | API-key auth on `/api/*` (`AUTH_MODE`, `API_KEYS`); `/api/admin/*` needs `ADMIN_API_KEY`, disabled when unset; config fails fast without keys | Unit tests (`auth-and-cancel.test.ts`); live: 401 without/wrong key, 404/401/200 on admin |
| Rate limiter keyed on HAProxy's IP: all clients plus health checks shared one bucket (observed 86/120 hits/min from health checks alone), so exceeding it would take every replica out of rotation | HAProxy `option forwardfor`; `TRUST_PROXY`; health mounted before the rate limiter | Live: Redis keys now per client IP; no health-check keys |
| Redis outage failed every endpoint, including reads designed to fail open | Rate limiter fails open for GET/HEAD/OPTIONS | Live drill: direct GET 200 with Redis stopped |
| RabbitMQ restart left APIs running with a dead channel: bookings charged + confirmed, client 500, no event, indefinitely | Connection/channel listeners; on loss → graceful shutdown → restart | Live drill: before, 500 and `Channel closed`; after, restart and 201 |
| No restart policy | `restart: unless-stopped` on long-running services | Live: worker restarted after broker loss |
| `docker compose up` wiped all bookings (seed ran `DELETE` every time) | Seed skips non-empty DB; `--reset` flag / `npm run seed:reset` | Live: re-run printed "skipping seed" |
| Compose `SIGKILL` at 10s < 25s drain | `stop_grace_period: 30s` on API replicas | Config |
| Non-UUID IDs caused Postgres cast errors → 500 | UUID validation (404 for paths, 400 for bodies) | Live: 404 / `VALIDATION_ERROR` |
| No cancellation (`Booking.cancel()` unused) | `POST /api/bookings/{id}/cancel`, row-locked, slot reopened in the same tx | `booking-cancel.test.ts` (10 concurrent cancels); live |
| Worker shutdown had no guard/timeout | Re-entry guard + 10s force exit | Code review |
| Unknown routes returned Express HTML | JSON `NOT_FOUND` | Live |
| Demo client showed "Request failed (409)" instead of server messages | Parse `{ error: { message } }` | Typecheck |
| Postgres/Redis/RabbitMQ ports published on all interfaces | Bound to 127.0.0.1 | Config |
| No `.dockerignore` (local `.env`, `node_modules` in build context) | Added for backend and demo client | Build |
