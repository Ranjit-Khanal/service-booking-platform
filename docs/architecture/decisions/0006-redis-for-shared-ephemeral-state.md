# ADR 0006: Redis for shared ephemeral state, with per-use failure policy

Status: Accepted (recorded retroactively)

## Context

With several API replicas, three kinds of state must be shared to behave correctly:
in-flight idempotency records, rate-limit counters and the catalog cache. Keeping any of
them in process memory would make replicas disagree (one replica's rate limit, another's
stale cache, duplicate processing of a retried request on a different replica).

## Options considered

1. In-process memory (per replica).
2. PostgreSQL tables for all three.
3. Redis for all three.
4. Redis for cache/rate limit, Postgres for idempotency.

## Decision

Option 3, with the failure policy chosen per use:

| Use | Primitive | On Redis failure |
|---|---|---|
| Idempotency | `SET NX EX` | fail closed |
| Rate limiting | `INCR` + `PEXPIRE` (fixed window) | fail open for reads, closed for writes (changed 2026-09-28; originally closed for all) |
| Catalog cache | `GET` / `SET EX`, `SET NX` single-flight lock, `SCAN`+`DEL` invalidation | fail open |

## Consequences

- One shared view across replicas for all three concerns.
- Atomic single-command primitives (`SET NX`, `INCR`) give correctness without Lua or
  distributed locks.
- Redis becomes a hard dependency of the booking path.

## Trade-offs

- Originally the rate limiter failed closed on every route, so a Redis outage took down
  reads and the health endpoint too. It now fails open for safe methods. Behind HAProxy,
  a Redis outage still drains all replicas because health includes Redis.
- Fixed-window limiting allows bursts of up to 2× the limit at window boundaries.
- No Redis persistence or replication is configured; idempotency records are lost on
  restart.
- Option 4 would make idempotency as durable as bookings at the cost of Postgres writes.
