# Book Knowledge Map

Source: **Distributed Systems with Node.js — Building Enterprise-Ready Backend Services** (Thomas Hunter II, O'Reilly, 2020/2021).

This document separates **book-derived concepts** from **additional industry practices** used in SlotBook.

---

## Book structure (verified via provided PDF TOC)

| Ch | Title | Relevant to SlotBook |
|----|-------|----------------------|
| 1 | Why Distributed? | Event loop, why horizontal scale matters for Node |
| 2 | Protocols | HTTP semantics, JSON pitfalls |
| 3 | Scaling | Cluster limits, HAProxy LB, health checks, rate limit & back pressure, SLOs |
| 4 | Observability | Structured logging, metrics, Zipkin-style tracing, health checks |
| 5 | Containers | Docker multi-stage, Compose |
| 6 | Deployments | Unit/integration tests, SemVer |
| 7 | Container Orchestration | K8s probes / SIGTERM drain (conceptual) |
| 8 | Resilience | Signals, graceful exit, DB reconnect/pooling, idempotency keys, retries, circuit breaker, exponential backoff, resilience testing |
| 9 | Distributed Primitives | Redis atomic ops (INCR), transactions, Lua for multi-key atomicity |
| 10 | Security | Env/config, attack surface |

---

## Book-derived concepts

### 1. Single-threaded event loop → must distribute (Ch1)

1. **Problem:** One Node process cannot use multiple CPU cores for JS work; long CPU tasks block all requests.
2. **Why:** JS runs on one main thread; libuv handles I/O concurrently but CPU is serial.
3. **Mechanism:** Scale out processes/machines; keep request handlers non-blocking.
4. **Tradeoffs:** Distributed complexity (partial failure, consistency) vs throughput.
5. **Use when:** Production traffic / multi-core hosts.
6. **Avoid when:** Tiny scripts / local tools.
7. **In book:** Ch1 “Why Distributed?”, event loop phases.
8. **In SlotBook:** 3 API containers behind HAProxy; worker separate process.

### 2. Reverse proxy load balancing + health checks (Ch3)

1. **Problem:** Clients must not pin to a dead instance.
2. **Why:** Instances crash, deploy, or overload independently.
3. **Mechanism:** HAProxy round-robin + `option httpchk GET /health`.
4. **Tradeoffs:** Detection lag (inter/fall/rise) → brief failed requests still possible.
5. **Use when:** ≥2 instances.
6. **Avoid when:** Single local process.
7. **In book:** “Load Balancing and Health Checks”, Table 3-5.
8. **In SlotBook:** `docker/haproxy/haproxy.cfg` → api1/2/3 `/api/health`.

### 3. Rate limiting & back pressure (Ch3)

1. **Problem:** Unbounded inbound work exhausts memory/event-loop queue.
2. **Why:** Node schedules every request callback; no automatic admission control.
3. **Mechanism:** Proxy `maxconn` / per-server limits; optionally app-level limits.
4. **Tradeoffs:** Rejecting work (429/close) vs unbounded latency.
5. **Use when:** Public APIs or bursty clients.
6. **Avoid when:** Trusted internal low-QPS tools only.
7. **In book:** “Rate Limiting and Back Pressure”, `server.maxConnections`, HAProxy maxconn.
8. **In SlotBook:** HAProxy maxconn + Redis shared rate limiter middleware.

### 4. Observability: logs, correlation, health (Ch4)

1. **Problem:** Cannot debug cross-service failures from stdout grepping alone.
2. **Why:** Request fans out across processes asynchronously.
3. **Mechanism:** Structured JSON logs; propagate trace/request IDs; `/health`.
4. **Tradeoffs:** Volume/cost vs debuggability. Book uses ELK + Zipkin; we keep lighter.
5. **Use when:** Any multi-instance system.
6. **Avoid:** Silent `console.log` strings in prod.
7. **In book:** ELK logging, Zipkin trace/span IDs, health checks.
8. **In SlotBook:** pino JSON logs; `x-request-id` / `x-correlation-id` through API → events → worker.

### 5. Containers & Compose (Ch5)

1. **Problem:** “Works on my machine” and inconsistent deps.
2. **Why:** Host drift.
3. **Mechanism:** Image layers; Compose for dependency graph.
4. **Tradeoffs:** Image build time vs reproducibility.
5. **Use when:** Multi-service local/prod parity.
6. **Avoid:** Over-containerizing a single script.
7. **In book:** Multi-stage Dockerfiles, Compose.
8. **In SlotBook:** `backend/Dockerfile`, `docker-compose.yml`.

### 6. Graceful shutdown / SIGTERM (Ch8)

1. **Problem:** Kill -9 / abrupt exit drops in-flight work and leaks connections.
2. **Why:** Orchestrators drain pods with SIGTERM then SIGKILL after timeout.
3. **Mechanism:** Stop accepts → finish in-flight → close DB/Redis/broker → exit.
4. **Tradeoffs:** Longer deploys vs fewer failed requests.
5. **Use when:** Horizontally scaled HTTP/workers.
6. **Avoid:** Ignoring signals in long-running services.
7. **In book:** Signal table (SIGTERM graceful), K8s 30s drain discussion.
8. **In SlotBook:** `registerGracefulShutdown` in API + worker.

### 7. Connection pooling & DB resilience (Ch8)

1. **Problem:** One connection/request collapses under concurrency; disconnects crash naive apps.
2. **Why:** DB connection setup is expensive; networks fail.
3. **Mechanism:** `pg.Pool` with `max`; reconnect strategies.
4. **Tradeoffs:** Too many connections starve DB (each API instance × pool size).
5. **Use when:** Any Postgres-backed API.
6. **Avoid:** Unbounded pools.
7. **In book:** “Database Connection Resilience”, “Connection Pooling”.
8. **In SlotBook:** `createDatabase` with `DB_POOL_MAX`.

### 8. Idempotency keys (Ch8)

1. **Problem:** Client retries of non-idempotent POST create duplicates (double book/charge).
2. **Why:** Ambiguous timeouts — client does not know if server committed.
3. **Mechanism:** Client sends `Idempotency-Key`; server caches result (Stripe/PayPal pattern in book).
4. **Tradeoffs:** Storage TTL; key/payload mismatch conflicts.
5. **Use when:** Payments, bookings, any costly side effect.
6. **Avoid:** Pure GETs (already idempotent by HTTP semantics).
7. **In book:** “Idempotency and Messaging Resilience”, Idempotency-Key header.
8. **In SlotBook:** Redis idempotency store + unique DB index on `bookings.idempotency_key`.

### 9. HTTP retry matrix + exponential backoff (Ch8)

1. **Problem:** Transient network/5xx failures; naive tight loops amplify outages.
2. **Why:** Partial failure is normal in distributed systems.
3. **Mechanism:** Retry only safe cases; backoff schedule; max attempts.
4. **Tradeoffs:** Latency vs success rate; thundering herd without jitter.
5. **Use when:** Calling flaky external APIs.
6. **Avoid:** Infinite retries; retrying non-idempotent POSTs without keys.
7. **In book:** Table 8-4 method matrix; Figure 8-5/8-6; ioredis `retryStrategy`.
8. **In SlotBook:** `withRetry` + payment timeout; Redis reconnect schedule.

### 10. Circuit breaker (Ch8)

1. **Problem:** Continuously calling a dead dependency wastes resources and adds latency.
2. **Why:** Failures cluster; recovery needs cool-down.
3. **Mechanism:** After N failures, open circuit; half-open probe after timeout.
4. **Tradeoffs:** False opens under blips; need metrics.
5. **Use when:** External payment/email APIs.
6. **Avoid:** Internal pure in-process calls.
7. **In book:** “Circuit Breaker Pattern”.
8. **In SlotBook:** `CircuitBreaker` around `PaymentProvider.charge`.

### 11. Resilience testing / failure injection (Ch8)

1. **Problem:** Untested failure paths fail for real in production.
2. **Why:** Happy-path tests hide reconnect/timeouts.
3. **Mechanism:** Random crashes, pauses, failed async ops (book); toggles in SlotBook.
4. **Tradeoffs:** Chaos complexity vs confidence.
5. **Use when:** Before calling a system production-ready.
6. **Avoid:** Only mocking success.
7. **In book:** “Resilience Testing”.
8. **In SlotBook:** `FailureSimulator` + `POST /api/admin/failures`.

### 12. Redis atomic primitives (Ch9)

1. **Problem:** Read-modify-write across instances races.
2. **Why:** Each Node process has separate memory.
3. **Mechanism:** `INCR`, `SET NX`, Lua for multi-step atomicity.
4. **Tradeoffs:** Redis becomes critical dependency; Lua can block Redis thread.
5. **Use when:** Shared counters, locks, idempotency, rate limits.
6. **Avoid:** Using Redis as primary system of record for bookings.
7. **In book:** “Introduction to Redis”, “Seeking Atomicity”, Lua scripting caveats.
8. **In SlotBook:** Redis `INCR` rate limiter; `SET NX` idempotency begin.

---

## Additional industry practices (NOT claimed as book content)

| Practice | Why we added it |
|----------|-----------------|
| Layered architecture (domain/application/infrastructure/interfaces) | Maintainability; DIP for tests |
| Repository + Strategy/Adapter (PaymentProvider) | Swap gateways without rewriting use cases |
| Manual composition root DI | Explicit wiring for senior-level clarity |
| PostgreSQL row `FOR UPDATE` for slot claim | Strong consistency for double-booking |
| RabbitMQ + DLQ for notifications | Async decoupling; book focuses on HTTP resilience, not a broker |
| Modular monolith (not microservices) | Right-sized; avoids distributed monolith |
| Optimistic `version` column alongside locks | Defense in depth |
| React UI | User request; not in book |
| Nginx static frontend | Serve UI; HAProxy remains API LB per book |

---

## Concepts explicitly limited / not deep in book

- Full CAP/consistency theory — not a primary focus → we apply practical Postgres transactions.
- Sharding/partitioning — Redis hash sharding mentioned lightly; we do not shard Postgres.
- Kafka/NATS — not required by book examples; RabbitMQ chosen as practical queue.
