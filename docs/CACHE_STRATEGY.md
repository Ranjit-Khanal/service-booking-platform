# SlotBook Cache Strategy

## Problem

Under horizontal scale (api1/api2/api3), every browse request hitting Postgres for the same catalog burns connection pool capacity and adds latency. Without a **shared** cache, each instance either:

- has no cache → DB overload, or
- caches in process memory → **divergent** views and stale slot lists after another instance books.

Redis (book Ch9) is the shared coordination layer.

## Pattern: Cache-aside (lazy load)

```text
GET /api/services
      ↓
CatalogCache.getActiveServices
      ↓
Redis HIT? ──yes──→ return
      │ no
      ↓
Postgres listActive()
      ↓
Redis SET EX ttl
      ↓
return
```

Single-flight: `getOrSet` takes a short Redis lock (`SET NX`) so a TTL expiry does not stampede all API instances into Postgres at once.

## What is cached

| Key | TTL | Why |
|-----|-----|-----|
| `catalog:services:active` | 60s | Hot, rarely changes |
| `catalog:service:{id}` | 120s | Hot detail reads |
| `catalog:slots:{serviceId}:{date}` | 8s | Hot but mutates on book |

Keys live under `REDIS_KEY_PREFIX` + `cache:` (see `CachePolicy.ts`).

## What is NOT cached

| Data | Why |
|------|-----|
| Bookings | Authoritative, user-specific, mutate; wrong to serve stale |
| Payments | Use **idempotency store**, not catalog cache |
| Health | Must reflect live dependency status |

## Invalidation

On successful **slot claim** (and on release after payment failure):

```text
CreateBookingUseCase
      ↓ claimSlot
      ↓ catalogCache.invalidateSlots(serviceId, startsAt)
      ↓ DEL catalog:slots:{serviceId}:*
```

So TTL is a safety net; booking is the source of truth for freshness.

Manual flush: `POST /api/admin/cache/flush`

## Failure semantics (important)

| Redis use | On Redis down |
|-----------|----------------|
| Catalog cache | **Fail-open** → treat as miss, hit Postgres |
| Rate limit | **Fail-closed** → 503 |
| Idempotency | **Fail-closed** → 503 |

Caching must never be the reason a booking cannot complete safely. Rate limits and idempotency must not silently diverge across instances.

## HTTP caching (edge)

Complementary, not a substitute for Redis:

- `GET /services` → `Cache-Control: public, max-age=15, stale-while-revalidate=60`
- `GET /services/:id` → `max-age=30`
- `GET .../slots` → `private, max-age=0, must-revalidate` (inventory)

## Observability

`GET /api/health` includes process-local counters:

```json
"cache": { "hits": 12, "misses": 3, "bypasses": 0, "invalidations": 1 }
```

(Per API instance — expected under LB.)

## Multi-instance implication

```text
api-1 books last slot → invalidates Redis keys
api-2 next slots GET  → miss → Postgres shows booked
```

Without shared Redis invalidation, api-2 could keep serving a cached open slot for up to TTL — a classic distributed stale-read bug.
