# SlotBook

## What is this?

A self-hostable service-booking backend, built with Node.js and TypeScript on PostgreSQL,
Redis and RabbitMQ. It is meant to be two things at once:

- **Usable infrastructure:** a booking API you can run with `docker compose up` and
  integrate into your own application.
- **A learning and reference implementation** of backend and distributed-systems
  engineering. The docs explain *why* each mechanism exists and *what happens when things
  fail*, including where the current implementation falls short.

This repository is the **community edition**, licensed under GNU AGPLv3. There is no other
edition and no feature is held back (see [docs/licensing.md](docs/licensing.md)).

## Who is it for?

- Developers learning backend engineering
- Developers learning distributed systems
- People experimenting with Node.js infrastructure
- Developers building service-booking applications
- Developers who want a self-hosted booking backend

## What can I do with it?

- **Run it locally**: one command, three API replicas behind a load balancer ([quick start](#quick-start)).
- **Study the architecture**: [architecture overview](docs/architecture/overview.md), [ADRs](docs/architecture/decisions/README.md).
- **Experiment with failure scenarios**: kill Redis, restart the broker, inject payment
  timeouts, and watch what happens ([failure scenarios](docs/distributed-systems/failure-scenarios.md), [failure injection](docs/operations/failure-injection.md)).
- **Build a frontend against the API**: [integration guide](docs/api/overview.md), [OpenAPI spec](docs/api/openapi.yaml).
- **Self-host it**: [self-hosting guide](docs/deployment/self-hosting.md).
- **Integrate it into another application**: API keys, idempotent booking creation, `booking.created` events.
- **Contribute improvements**: [CONTRIBUTING.md](CONTRIBUTING.md).

```text
┌──────────────┐     HTTP + API key     ┌─────────┐     ┌──────────────────────┐
│ Your app /   │ ─────────────────────▶ │ HAProxy │ ──▶ │ API ×3 (stateless)   │──┐
│ demo client  │                        └─────────┘     └──────────────────────┘  │
└──────────────┘                                          │        │        │     │
                                                    PostgreSQL   Redis   RabbitMQ │
                                                  (source of   (idempo-     │     │
                                                    truth)      tency,      ▼     │
                                                                rate limit, Worker│
                                                                cache)  (notifications)
```

## What's in the box

### Core service (`backend/`)

What an integrating application gets:

- **Catalog reads**: services and open time slots per day (cached, shared across instances).
- **Booking creation**: claims a slot, charges via a pluggable payment provider, and
  confirms, all synchronously. Double booking is prevented by Postgres row locks, and
  retries are handled with `Idempotency-Key`.
- **Cancellation**: `POST /api/bookings/{id}/cancel`, which reopens the slot atomically and
  is safe to retry.
- **Booking lookup** by ID or customer email.
- **Events**: `booking.created` on a RabbitMQ topic exchange, with a bundled notification
  worker (dedupe, retries, dead-letter queue).
- **API-key authentication** for client applications; a separate, off-by-default admin key.
- **Operations**: `/api/health` for load balancers, structured JSON logs with correlation
  IDs, graceful shutdown, and restart on broker loss.

API contract: [docs/api/overview.md](docs/api/overview.md) ·
[docs/api/openapi.yaml](docs/api/openapi.yaml)

### Demo client (`demo-client/`)

A React app that consumes the API. **It is a reference client, not the core product.** The
backend has no dependency on it. See [demo-client/README.md](demo-client/README.md).

### Engineering concepts demonstrated

| Concept | Where | Doc |
|---|---|---|
| Row-level locking (`SELECT … FOR UPDATE`) against double booking | `PostgresServiceRepository.claimSlot` | [concurrency](docs/distributed-systems/concurrency.md), [locking](docs/distributed-systems/database-locking.md) |
| Short transactions + compensation around a remote call | `CreateBookingUseCase` | [transactions](docs/distributed-systems/transactions.md) |
| Idempotency keys (Redis `SET NX` + DB unique index) | booking creation | [idempotency](docs/distributed-systems/idempotency.md) |
| Idempotent consumer (dedupe table) | notification worker | [idempotency](docs/distributed-systems/idempotency.md#2-notification-consumer) |
| Timeouts, retries with backoff + jitter, circuit breaker | payment path | [retries](docs/distributed-systems/retries.md) |
| Shared state across replicas (rate limit, cache, idempotency) | Redis | [redis](docs/distributed-systems/redis.md), [caching](docs/distributed-systems/caching.md) |
| At-least-once messaging, retries, DLQ | RabbitMQ + worker | [messaging](docs/distributed-systems/messaging.md) |
| Load balancing and health checks | HAProxy | [overview](docs/architecture/overview.md) |
| Graceful shutdown | API + worker | [graceful-shutdown](docs/distributed-systems/graceful-shutdown.md) |
| Failure injection | admin API | [failure-injection](docs/operations/failure-injection.md) |

What it does **not** do (yet): real payment or email providers, customer accounts,
provider/staff assignment, a catalog management API, rescheduling, refunds, or expiry of
abandoned bookings. The full list, including known correctness gaps, is in
[docs/architecture/known-limitations.md](docs/architecture/known-limitations.md).

## Quick start

```bash
git clone <repository-url> slotbook && cd slotbook
cp .env.example .env
docker compose up --build
```

| URL | |
|---|---|
| http://localhost:8080/api/health | API via HAProxy (no auth) |
| http://localhost:5173 | Demo client |
| http://localhost:15673 | RabbitMQ management UI (local only; credentials from `.env`) |

```bash
KEY=dev-local-key-change-me   # from API_KEYS in .env
curl -H "Authorization: Bearer $KEY" http://localhost:8080/api/services
```

Backend only: `docker compose up --build haproxy worker`. Details, database reset and
production notes: [docs/deployment/self-hosting.md](docs/deployment/self-hosting.md).

## Booking flow

```text
POST /api/bookings  (Idempotency-Key)
  rate limit (Redis) → idempotency SET NX (Redis)
  → BEGIN; SELECT slot FOR UPDATE; UPDATE slot booked; COMMIT     (Postgres)
  → INSERT booking pending_payment
  → charge (timeout 3s × ≤3 attempts, circuit breaker)
  → UPDATE booking confirmed → publish booking.created → mark key completed
  ← 201
worker: booking.created → dedupe (processed_events) → send confirmation → ack
```

```text
pending_payment ──▶ confirmed ──cancel──▶ cancelled
        └─────────▶ failed   (slot released)
```

More: [request flow](docs/architecture/request-flow.md) ·
[booking lifecycle](docs/architecture/booking-lifecycle.md) ·
[failure scenarios](docs/distributed-systems/failure-scenarios.md)

## Technologies

Node.js ≥ 20 (Docker images use 22), TypeScript (strict), Express 5, `pg`, `ioredis`,
`amqplib`, Zod, pino, Vitest · PostgreSQL 16 · Redis 7 · RabbitMQ 3.13 · HAProxy 2.9 ·
React 19 + Vite (demo).

## Local development

```bash
docker compose up -d postgres redis rabbitmq
cd backend && cp .env.example .env && npm install
npm run migrate && npm run seed
npm run dev            # API on :3000
npm run dev:worker     # worker
```

See [docs/operations/local-development.md](docs/operations/local-development.md).

## Configuration

Environment variables, validated at startup (the process exits with a readable list of
problems). The root [`.env.example`](.env.example) is for Docker Compose, and
[`backend/.env.example`](backend/.env.example) is for running on the host. Reference:
[docs/operations/configuration.md](docs/operations/configuration.md).

## Testing

```bash
cd backend
npm run typecheck
npm run test:unit                                   # no infrastructure needed
RUN_INTEGRATION=1 npm run test:concurrency          # needs a migrated Postgres (DATABASE_URL)
```

Unit tests cover state transitions, retry/circuit breaker, idempotent replay, auth and
config validation. Concurrency tests run real concurrent slot claims and cancels against
Postgres.

## Documentation

| | |
|---|---|
| Architecture | [overview](docs/architecture/overview.md) · [request flow](docs/architecture/request-flow.md) · [booking lifecycle](docs/architecture/booking-lifecycle.md) · [known limitations](docs/architecture/known-limitations.md) · [ADRs](docs/architecture/decisions/README.md) |
| API | [integration guide](docs/api/overview.md) · [OpenAPI](docs/api/openapi.yaml) |
| Distributed systems | [concurrency](docs/distributed-systems/concurrency.md) · [locking](docs/distributed-systems/database-locking.md) · [transactions](docs/distributed-systems/transactions.md) · [idempotency](docs/distributed-systems/idempotency.md) · [redis](docs/distributed-systems/redis.md) · [caching](docs/distributed-systems/caching.md) · [messaging](docs/distributed-systems/messaging.md) · [retries](docs/distributed-systems/retries.md) · [graceful shutdown](docs/distributed-systems/graceful-shutdown.md) · [failure scenarios](docs/distributed-systems/failure-scenarios.md) |
| Database | [schema](docs/database/schema.md) |
| Operations | [self-hosting](docs/deployment/self-hosting.md) · [local development](docs/operations/local-development.md) · [docker](docs/operations/docker.md) · [configuration](docs/operations/configuration.md) · [failure injection](docs/operations/failure-injection.md) |
| Security & licensing | [security](docs/security.md) · [SECURITY.md](SECURITY.md) (reporting) · [licensing](docs/licensing.md) |
| Background | [book knowledge map](docs/BOOK_KNOWLEDGE_MAP.md): concepts from *Distributed Systems with Node.js* (T. Hunter II) mapped to this code |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

The SlotBook community edition is licensed under the
**GNU Affero General Public License v3.0** (`AGPL-3.0-only`). See [LICENSE](LICENSE) for the
full text.

The AGPL is a free-software license. It allows you to use, study, modify, redistribute and
self-host this software, including as a network service, under the conditions set out in
the license. One of those conditions (section 13) concerns offering the source code of a
modified version to users who interact with it over a network. Read the license for the
exact terms; this paragraph is not a substitute for it.

Dependencies and container images keep their own licenses. Details, the contribution
terms and how the project could add separately licensed modules in the future are in
[docs/licensing.md](docs/licensing.md).
