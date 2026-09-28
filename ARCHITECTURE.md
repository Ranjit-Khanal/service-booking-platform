# SlotBook Architecture

## Why this project

**Service booking** forces the hard distributed problems into one product surface:

- Last-slot race (concurrency / transactions)
- Payment + booking side effects (idempotency)
- Confirmation email (async messaging, duplicate delivery)
- Public API (rate limiting, horizontal scale)
- External payment gateway (timeouts, retries, circuit breaker)

## Modular monolith (intentional)

We do **not** split “Booking Service”, “Payment Service”, “Catalog Service” into separate deployables.

**Why:** The book’s pain points (LB, health, resilience, Redis atomics) appear as soon as you have **multiple API instances + shared state + async workers**. Extra network hops without clear team boundaries increase failure modes without teaching more.

Boundaries are **modules + interfaces**, not sockets.

## Layering

```text
interfaces/http     Controllers, middleware — HTTP only
application/        Use cases — orchestration, no SQL
domain/             Entities, repository ports, payment port
infrastructure/     Postgres, Redis, RabbitMQ, payment adapters
composition/        Manual DI wiring
```

Dependencies point **inward**:

```text
HTTP → UseCase → Repository interface ← PostgresRepository
                 PaymentProvider    ← Mock/Stripe/Esewa
                 EventPublisher     ← RabbitPublisher
```

## Critical flows

### Book a slot

```text
Client
  → HAProxy (LB + maxconn back pressure)
    → API instance (rate limit via Redis INCR)
      → CreateBookingUseCase
         → IdempotencyStore.begin (Redis SET NX)
         → ServiceRepository.claimSlot (SELECT FOR UPDATE)
         → BookingRepository.save
         → PaymentProvider.charge (retry + circuit breaker)
         → EventPublisher.publish booking.created
  → Worker consumes queue
      → NotificationSender (idempotent via processed_events)
```

### What if API-2 crashes?

HAProxy health checks fail → api2 removed from rotation. In-flight requests on api2 may fail; clients with idempotency keys can safely retry. Postgres/Redis/Rabbit remain shared — no sticky session required.

### What if Redis is down?

Rate limiting and idempotency begin fail → API returns 503 for protected paths (fail closed). Bookings in DB are still authoritative; without Redis, cross-instance idempotency and rate limits are unsafe — better to refuse than double-charge.

### What if the worker crashes?

Unacked RabbitMQ messages are redelivered. `processed_events` prevents duplicate emails.

## TypeScript interfaces (compile-time contracts)

```ts
interface PaymentProvider {
  charge(input: ChargeInput): Promise<PaymentResult>;
}
```

After `tsc`, interfaces are **erased**. Runtime sees only the concrete class instance injected in `buildApp()`. This is **not** a JVM interface — no runtime type checks unless you add Zod/io-ts.

## DI choice

**Manual composition root** in `src/composition/buildApp.ts`.

| | Manual DI | Container (e.g. tsyringe) |
|--|-----------|---------------------------|
| Clarity | Explicit graph | Hidden registrations |
| Refactor | Touch wiring file | Decorator metadata |
| Best for | Teaching / medium apps | Very large graphs |

## Concurrency control

Naive check-then-update double-books. Fix: `SELECT ... FOR UPDATE` + `UPDATE ... WHERE status='open'` inside a transaction. Unique partial index on confirmed `slot_id` as safety net.

## Caching

See [`docs/CACHE_STRATEGY.md`](docs/CACHE_STRATEGY.md).

Summary: Redis **cache-aside** for catalog/slots (fail-open), short slot TTL + invalidate on book, never cache bookings. Rate-limit and idempotency remain fail-closed Redis uses.

