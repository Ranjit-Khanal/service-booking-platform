# Catalog caching

## Problem

With three API replicas, every catalog page view hitting Postgres spends pool
connections on data that rarely changes. Caching in process memory would give each
replica its own view, and after api1 books the last 10:00 slot, api2 would keep listing
it as open until its local entry expired.

A shared Redis cache gives all replicas one copy that can be invalidated in one place.

## Pattern: cache-aside with single-flight fill

```text
GET /api/services
  → CatalogCache.getActiveServices
  → GET slotbook:cache:catalog:services:active
       hit  → return
       miss → SET slotbook:cache:lock:catalog:services:active 1 NX EX 3
                acquired     → SELECT from Postgres → SET value EX 60 → DEL lock → return
                not acquired → sleep 40ms → GET again
                                  hit  → return ("hit-after-wait")
                                  miss → SELECT from Postgres anyway → SET → return
```

`getService` (single service detail) does **not** use `getOrSet`; it is a plain
get → load → set, and only positive results are cached so a "not found" is never pinned.

## What is cached

Policy is in `backend/src/infrastructure/cache/CachePolicy.ts`.

| Key (after `slotbook:cache:`) | TTL | Why this TTL |
|---|---|---|
| `catalog:services:active` | 60s | Rarely changes; no admin API to change it anyway |
| `catalog:service:{id}` | 120s | Same |
| `catalog:slots:{serviceId}:{YYYY-MM-DD}` | 8s | Mutates on every booking; explicit invalidation keeps it fresher than the TTL |

## What is never cached

| Data | Why |
|---|---|
| Bookings | Authoritative, user-specific, read right after writes |
| Payment results | The idempotency store covers replays |
| `/api/health` | Must reflect live dependencies |

## Invalidation

`CreateBookingUseCase` calls `catalogCache.invalidateSlots(serviceId, startsAt)`:

- after a successful claim, and
- after a slot is released on payment failure.

It deletes the day key and then `SCAN`s for `slotbook:cache:catalog:slots:{serviceId}:*`
and deletes every match. `POST /api/admin/cache/flush` does the same for the whole
`catalog:` prefix.

Because the store is shared, one `DEL` on api1 is visible to api2 and api3 immediately.

### Stale write after invalidation

Cache-aside with delete-on-write has a known race:

```text
api2: miss → SELECT open slots (10:00 is open)
api1:                                   claim 10:00 → DEL slots key
api2: SET slots key = [10:00, …]  ← stale list written after the invalidation
```

The stale list lives until the 8s TTL expires. This is tolerable here because the list
is advisory; the claim transaction re-checks the slot under a row lock (see
[concurrency.md](concurrency.md)), so a customer who picks the stale slot gets
`409 SLOT_UNAVAILABLE`, never a double booking. The short TTL is what bounds the damage.

## Failure semantics

`RedisCacheStore` wraps every cache operation and returns a miss/no-op on error
(**fail-open**). Idempotency and rate limiting are deliberately **fail-closed**.

| Redis use | Designed behavior on Redis error |
|---|---|
| Catalog cache | Miss → read Postgres |
| Rate limit | Error → request fails |
| Idempotency | Error → request fails |

The rate limiter also fails open for reads, so a replica keeps serving catalog reads from
Postgres while Redis is down. Behind HAProxy, though, the health check (which includes Redis)
takes replicas out of rotation. See
[redis.md](redis.md#what-happens-when-redis-is-unavailable).

## HTTP caching headers

Set in `CatalogController`:

| Route | `Cache-Control` |
|---|---|
| `GET /api/services` | `public, max-age=15, stale-while-revalidate=60` |
| `GET /api/services/:id` | `public, max-age=30` |
| `GET /api/services/:id/slots` | `private, max-age=0, must-revalidate` |

Neither HAProxy nor nginx caches responses in this setup, so these only affect
browsers.

## Observability

`GET /api/health` includes `cache: {hits, misses, bypasses, invalidations}`. These are
**process-local** counters: each response reflects whichever replica HAProxy chose.

## Trade-offs and limitations

- **Single-flight is partial.** Waiters sleep once for 40ms. If the holder's query takes
  longer, every waiter loads from Postgres itself. It reduces a stampede; it does not
  eliminate it.
- **`SCAN` on every booking.** `invalidateSlots` scans the whole keyspace (`COUNT 100`
  per iteration) for each claim and release. Fine for a demo-sized Redis; with a large
  keyspace it becomes the most expensive Redis operation in the system. Deleting the
  one known day key is sufficient when `starts_at` dates are UTC as the seed produces.
- **Day keys are UTC.** The slots endpoint's `date` parameter is interpreted as a UTC day.
- **No catalog write path.** Services and slots only change via the seed script or SQL,
  neither of which invalidates Redis. After `seed --reset` or manual SQL, stale catalog
  entries can live for up to 120s, and cached IDs from a previous seed will 404/409. Flush
  with `POST /api/admin/cache/flush` (admin key required) or wait.
