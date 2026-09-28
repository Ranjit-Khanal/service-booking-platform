# ADR 0007: Three API replicas behind HAProxy in the default setup

Status: Accepted (recorded retroactively)

## Context

A single Node process hides most distributed-systems bugs: in-memory state "works",
races are rarer, and there is no failover. The default local environment should surface
those problems rather than hide them.

## Options considered

1. One API process.
2. Node `cluster` module in one container.
3. Several containers behind a reverse proxy (nginx, HAProxy, Traefik).

## Decision

Option 3 with HAProxy: `api1`, `api2`, `api3`, round-robin, active HTTP health checks on
`/api/health` every 2s (down after 3 failures, up after 2 successes), `maxconn` limits for
connection-level backpressure.

## Consequences

- Any state kept in process memory is visibly per-replica. This already shows up:
  circuit breaker state and failure-injection flags differ between replicas.
- Losing one replica is survivable; HAProxy removes it within ~6s.
- `/api/health` depending on Postgres and Redis means a shared-dependency outage removes
  every replica at once — HAProxy then answers 503 itself, which is arguably correct but
  also means the API cannot report its own degraded status.

## Trade-offs

- Replicas are listed statically in both `docker-compose.yml` and `haproxy.cfg`.
- The proxy hides the client's IP unless `X-Forwarded-For` is configured on both sides.
  This was missing originally (all clients shared one rate-limit bucket with the health
  checks); now HAProxy sets `option forwardfor` and the API uses `TRUST_PROXY`.
- No retry/redispatch on connection failure is configured, so requests routed to a
  replica during its shutdown fail.
