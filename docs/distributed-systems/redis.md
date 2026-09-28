# Redis

## Role

Redis holds state that **every API replica must agree on** but that is **not** the
system of record. If Redis were wiped, no booking, slot or payment fact would be lost;
Postgres owns all of those.

Based on actual usage, Redis is used as:

| Classification | Used? | Where |
|---|---|---|
| Coordination (dedupe of in-flight requests) | **Yes** | Idempotency `SET NX` |
| Rate limiter | **Yes** | Fixed-window `INCR` |
| Cache | **Yes** | Catalog cache-aside |
| Short-lived lock | **Yes, cache only** | Single-flight lock for cache fills |
| Distributed lock for business data | No | Slot locking is done in Postgres |
| Queue / pub-sub | No | RabbitMQ is the broker |
| Session store | No | No sessions/auth exist |
| Primary storage | No | — |

Only the API process connects to Redis. The worker does not.

`/api/health` is mounted before the rate limiter, so health checks never touch the
rate-limit keys.

## Client configuration

`infrastructure/redis/redis.ts`:

```ts
new Redis(REDIS_URL, {
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
  retryStrategy: (times) => [100, 250, 500, 1000, 2000, 5000][times - 1] ?? 5000,
});
```

- One connection per API process, shared by all three roles.
- Reconnects forever with a capped backoff.
- While disconnected, `ioredis` queues commands (offline queue, default on); a queued
  command fails after 2 reconnect attempts with `MaxRetriesPerRequestError`. In practice
  a Redis outage turns into request errors within roughly half a second, not a hang.
- No `commandTimeout` is set, so a Redis that accepts connections but is very slow will
  stall requests.
- No password/TLS in the provided configuration.

## Key patterns

All keys start with `REDIS_KEY_PREFIX` (default `slotbook:`).

### `slotbook:idem:{idempotencyKey}`

| | |
|---|---|
| Purpose | Idempotency record for `POST /api/bookings` |
| Value | JSON. In flight: `{key, requestHash, status:"in_progress", createdAt}`. Done: `{key, requestHash, statusCode:201, body:{bookingId,status}, createdAt}` (no `status` field → read as completed) |
| TTL | `IDEMPOTENCY_TTL_SECONDS` (86400). Set on `begin`; reset on `complete`. |
| Writer | `CreateBookingUseCase` via `idempotency.begin` / `complete` |
| Reader | Same use case (`begin`, `get`) |
| Invalidation | TTL only. Never deleted, including after failures. |
| Failure behavior | **Fail-closed**: any Redis error → request fails; simulated failure → 503. |

Details: [idempotency.md](idempotency.md).

### `slotbook:rl:{clientIp}:{windowNumber}`

| | |
|---|---|
| Purpose | Fixed-window request counter |
| Value | Integer |
| TTL | `RATE_LIMIT_WINDOW_MS`, set with `PEXPIRE` when the counter is first created |
| Writer / reader | `createRateLimitMiddleware` → `rateLimiter.consume` on every request except `/api/health` |
| Invalidation | TTL; the window number in the key also rolls over |
| Failure behavior | `GET`/`HEAD`/`OPTIONS`: **fail open** (logged, request proceeds). Other methods: **fail closed** → 500 (real outage) or 503 (simulated). |

Algorithm:

```text
bucket = floor(now / windowMs)
count  = INCR key
if count == 1: PEXPIRE key windowMs
ttl    = PTTL key
allowed = count <= limit
```

Observations:

- `INCR` makes the count itself atomic across replicas.
- `INCR` and `PEXPIRE` are two commands. If the process dies between them, the key has
  no TTL and is never removed (a small leak; since the window number is in the key, it
  does not block anyone).
- Fixed windows allow up to 2× the limit across a window boundary.
- The key uses `req.ip`. Behind HAProxy this is the client address from
  `X-Forwarded-For` (`option forwardfor` + `TRUST_PROXY=1`). Before this was configured,
  every client and HAProxy's health checks shared one bucket keyed by HAProxy's IP; see
  the "Fixed" section of [known-limitations.md](../architecture/known-limitations.md).
- `TRUST_PROXY` must match the real number of proxies. If it's too high, clients can spoof
  their IP via `X-Forwarded-For` and dodge the limit.

### `slotbook:cache:catalog:*`

| Key | Value | TTL | Invalidated by |
|---|---|---|---|
| `slotbook:cache:catalog:services:active` | array of services | 60s | `POST /api/admin/cache/flush` |
| `slotbook:cache:catalog:service:{id}` | one service | 120s | admin flush |
| `slotbook:cache:catalog:slots:{serviceId}:{YYYY-MM-DD}` | open slots for that UTC day | 8s | slot claim, slot release, admin flush |

Writer and reader: `CatalogCache` (API only). **Fail-open**: any Redis error is logged
and treated as a miss. Details: [caching.md](caching.md).

### `slotbook:cache:lock:catalog:*`

| | |
|---|---|
| Purpose | Single-flight lock so one caller refills an expired cache key |
| Value | `"1"` |
| TTL | 3s |
| Writer | `RedisCacheStore.getOrSet` (`SET NX EX 3`); deleted in `finally` by the holder |
| Failure behavior | Lock errors → load without lock |

The delete is not owner-checked: if a load takes longer than 3s, the lock expires,
someone else takes it, and the first caller's `DEL` removes the second caller's lock.
The impact is only extra database loads.

## What happens when Redis is unavailable

Verified by stopping Redis on a running stack (2026-09-28), calling one replica directly:

| Path | Behavior |
|---|---|
| `GET /api/services` (and other reads) | 200. The rate limiter and cache fail open; data comes from Postgres. |
| `POST /api/bookings` | 500. The rate limiter fails closed for mutations (idempotency would too). |
| `/api/health` | 503 `degraded` (`checks.redis: false`) |

Through HAProxy, the 503 health response takes **every** replica out of rotation, so
external clients see HAProxy's 503 for reads as well until Redis is back (about 10s after
it returned in the drill). Keeping reads available through the load balancer would need
health to fail only on Postgres, which trades away the signal that bookings can't be made.
The `failRedis` simulation flag behaves the same way on one replica.

## What happens when Redis restarts or loses data

No persistence is configured for the Compose Redis beyond the image defaults. After a
restart with empty memory:

- **Cache**: refills on demand. Harmless.
- **Rate limits**: counters reset. Harmless.
- **Idempotency**: all records lost. Retries of already-completed requests are treated
  as new. The slot claim or the `bookings_idempotency_uq` index prevent a second
  booking, but the client receives `409` / `500` instead of the original `201` payload.
  In-flight requests at the moment of the restart continue and complete normally.

## Trade-offs

- One Redis instance, no replica or Sentinel: a single point of failure for bookings and,
  via the health check, for everything behind HAProxy.
- Three different consistency requirements (cache: best-effort; rate-limit: approximately
  right; idempotency: must not lose) share one instance and one connection. Separating
  idempotency into Postgres (a table with a unique key) would make it as durable as the
  booking it protects, at the cost of a DB write per request.
