# SlotBook

Production-style **service booking** platform (Node.js + TypeScript) built to apply concepts from *Distributed Systems with Node.js* (Thomas Hunter II)—not to copy its recipe-API samples.

Deep book analysis: [`docs/BOOK_KNOWLEDGE_MAP.md`](docs/BOOK_KNOWLEDGE_MAP.md)  
Architecture decisions: [`ARCHITECTURE.md`](ARCHITECTURE.md)

---

## Why service booking?

| Concern | How booking surfaces it |
|---------|-------------------------|
| Concurrency | Two clients, one last slot |
| Idempotency | Payment retries must not double-book |
| Async | Email after confirm |
| Redis | Shared rate limits + idempotency across API replicas |
| Horizontal scale | 3 APIs behind HAProxy |
| Resilience | Payment timeouts, circuit breaker, failure toggles |

---

## Stack

- **API / Worker:** Node 22, Express, TypeScript (strict)
- **Postgres:** system of record (slots, bookings)
- **Redis:** distributed rate limit + idempotency + short cache (Ch9 atomics)
- **RabbitMQ:** `booking.created` → notification worker (+ DLQ)
- **HAProxy:** load balance + health checks + maxconn back pressure (Ch3)
- **Frontend:** React + Vite (SlotBook UI)

---

## Quick start (Docker)

```bash
docker compose up --build
```

| Surface | URL |
|---------|-----|
| UI | http://localhost:5173 |
| API via LB | http://localhost:8080/api/health |
| RabbitMQ UI | http://localhost:15673 (slotbook/slotbook) |
| Postgres (host) | localhost:5433 |
| Redis (host) | localhost:6380 |

> Host ports for Postgres/Redis/Rabbit are remapped (5433/6380/5673) to avoid clashing with local installs. Inside the Compose network, services still use the standard ports.


Compose brings up: postgres, redis, rabbitmq, migrate, seed, **api1/api2/api3**, worker, haproxy, web.

### What scales horizontally

- **api\*** — stateless request handlers (book Ch3)
- **worker** — scale consumers for notification lag
- **Not** Postgres/Redis/Rabbit primary nodes in this demo (would need HA setups)

### If api-2 crashes

HAProxy health check fails → traffic goes to api1/api3. Retriable client requests with the same `Idempotency-Key` are safe.

---

## Local API development

```bash
# infra only
docker compose up -d postgres redis rabbitmq

cp backend/.env.example backend/.env
cd backend
npm install
npm run migrate && npm run seed
npm run dev          # API :3000
npm run dev:worker   # notifications
```

Frontend:

```bash
cd frontend
npm install
VITE_API_BASE_URL=http://localhost:3000 npm run dev
```

---

## Environment variables

See `backend/.env.example`. Validated at boot with Zod (`src/config/env.ts`).

Critical:

| Var | Role |
|-----|------|
| `DATABASE_URL` | Postgres |
| `REDIS_URL` | Rate limit / idempotency / cache |
| `RABBITMQ_URL` | Events |
| `PAYMENT_*` | Timeout + retries |
| `FAIL_*` | Boot-time failure flags (also runtime via admin API) |

---

## API (selected)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/health` | LB health; DB+Redis checks |
| GET | `/api/services` | Catalog (cached ~30s) |
| GET | `/api/services/:id/slots?date=YYYY-MM-DD` | Open slots |
| POST | `/api/bookings` | Requires `Idempotency-Key` |
| GET | `/api/bookings/:id` | Booking detail |
| GET | `/api/bookings?email=` | Customer history |
| POST | `/api/admin/failures` | Failure simulation |

### Idempotent booking

```http
POST /api/bookings
Idempotency-Key: abc-123
Content-Type: application/json

{
  "serviceId": "...",
  "slotId": "...",
  "customerName": "Ada Lovelace",
  "customerEmail": "ada@example.com"
}
```

Replay with same key + same body → `200` + prior booking (`replayed: true`).

---

## Teaching walkthrough (major decisions)

### Problem: last slot double-booking

**Naive:** `SELECT status` then `UPDATE` in app code.  
**Fails:** two requests both see `open`.  
**Pattern:** transaction + `SELECT … FOR UPDATE` (+ unique partial index).  
**Where:** `PostgresServiceRepository.claimSlot`.  
**Multi-instance:** lock is in Postgres — works across api1/2/3.

### Problem: payment timeout → client retries → double charge

**Naive:** always create a new booking on POST.  
**Fails:** ambiguous network failure.  
**Pattern:** Idempotency-Key (book Ch8 / Stripe pattern).  
**Where:** Redis `IdempotencyStore` + use case.  
**Multi-instance:** Redis is shared; any API replica sees the key.

### Problem: email coupling slows booking

**Naive:** send email inside HTTP request.  
**Fails:** SMTP latency/outage fails the booking.  
**Pattern:** publish event; worker consumes.  
**Where:** RabbitMQ + `worker.ts`.  
**Duplicates:** at-least-once → `processed_events` idempotent consumer.

### Problem: payment dependency melts down

**Naive:** retry forever immediately.  
**Fails:** thundering herd; book warns about infinite retries.  
**Pattern:** exponential backoff + max attempts + circuit breaker (Ch8).  
**Where:** `withRetry`, `CircuitBreaker`.

### Problem: one Node process / one instance dies

**Naive:** single process.  
**Fails:** event loop / host limits (Ch1/Ch3).  
**Pattern:** HAProxy + N replicas + health checks.  
**Where:** `docker-compose.yml` + `haproxy.cfg`.

### Problem: Redis vs Postgres roles

Redis is **not** the booking source of truth. It solves **shared ephemeral coordination** (Ch9). Postgres owns bookings/slots.

---

## Caching

Redis **cache-aside** for services/slots. See [`docs/CACHE_STRATEGY.md`](docs/CACHE_STRATEGY.md).

```bash
# metrics appear under "cache"
curl -s http://localhost:8080/api/health | jq .cache

# flush catalog cache on all instances (shared Redis)
curl -s -X POST http://localhost:8080/api/admin/cache/flush
```


UI: **Ops** page, or:

```bash
curl -X POST http://localhost:8080/api/admin/failures \
  -H 'content-type: application/json' \
  -d '{"failPayment":true}'
```

| Flag | Effect |
|------|--------|
| `failPayment` | Payment returns retryable failure |
| `failRedis` | Redis ops throw → 503 |
| `failDatabase` | DB ops throw → 503 |
| `failBrokerPublish` | Event publish fails after payment |
| `paymentLatencyMs` | Artificial delay (timeout demos) |

Recovery: set flags back to `false`; circuit breaker half-opens after reset timeout.

---

## Testing

```bash
cd backend
npm run test:unit

# needs running Postgres + migrated schema
RUN_INTEGRATION=1 npm run test:concurrency
```

| Level | Protects against |
|-------|------------------|
| Unit | Domain rules, retry/circuit logic |
| Concurrency | Double-claim race |
| Integration/API | (extend with Testcontainers as needed) |

---

## Pattern map

| Pattern | Where Used | Problem Solved |
|---------|------------|----------------|
| Repository | `domain/repositories` + Postgres impl | Hide SQL; test use cases |
| Manual DI | `composition/buildApp.ts` | Explicit dependency direction |
| Strategy/Adapter | `PaymentProvider` | Swap gateways |
| Factory | `createPaymentProvider` | Select adapter from config |
| Circuit Breaker | payment path | Stop calling dead dependency |
| Retry + backoff | payment, Redis reconnect | Transient faults without stampede |
| Idempotency | booking POST | Safe client retries |
| Event / queue | RabbitMQ + worker | Async side effects |
| Rate limit | Redis INCR middleware | Shared admission control |
| Row lock | `claimSlot` | Lost-update / double book |

---

## Book → code mapping

| Book Concept | Location in book | Project implementation |
|--------------|------------------|------------------------|
| Why distribute / event loop | Ch1 | Multiple API containers; non-blocking handlers |
| HAProxy LB + health checks | Ch3 “Load Balancing and Health Checks” | `docker/haproxy/haproxy.cfg`, `/api/health` |
| Rate limiting & back pressure | Ch3 “Rate Limiting and Back Pressure” | HAProxy `maxconn` + Redis rate limiter |
| Structured logging / tracing idea | Ch4 | pino + `x-request-id` / `x-correlation-id` |
| Health checks | Ch4 | `/api/health` |
| Docker + Compose | Ch5 | `Dockerfile`s, `docker-compose.yml` |
| Unit vs integration tests | Ch6 | `tests/unit`, `tests/concurrency` |
| SIGTERM graceful shutdown | Ch8 | `shared/shutdown.ts` |
| Connection pooling | Ch8 | `infrastructure/database/pool.ts` |
| Idempotency-Key | Ch8 | Redis store + `CreateBookingUseCase` |
| HTTP retry / method matrix | Ch8 | Payment retries only when retryable |
| Circuit breaker | Ch8 | `CircuitBreaker` |
| Exponential backoff | Ch8 | `withRetry`, ioredis `retryStrategy` |
| Resilience testing | Ch8 | `FailureSimulator` + admin API |
| Redis INCR atomics | Ch9 | Distributed rate limiter |
| Redis SET NX / atomicity | Ch9 | Idempotency `begin` |
| RabbitMQ / DLQ | Not verified as primary book topic | Industry addition for async notify |
| Layered OOP / DIP | Not verified as primary book topic | Industry architecture layering |

---

## TypeScript interfaces note

Interfaces like `PaymentProvider` exist **only at compile time**. After emission to JS they disappear. Runtime polymorphism is “duck typing” via the object you injected. That is why DI + coding to the interface still works without Java-style runtime interface objects.

---

## Project layout

```text
backend/src/
  domain/           entities, ports
  application/      use cases
  infrastructure/   postgres, redis, rabbit, payments, resilience
  interfaces/       http + (worker uses messaging)
  composition/      manual DI
  main.ts / worker.ts
frontend/           React UI
docker/haproxy/     LB config
docs/               book knowledge map
```
