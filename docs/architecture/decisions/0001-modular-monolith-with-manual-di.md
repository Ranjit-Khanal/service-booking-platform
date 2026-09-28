# ADR 0001: Modular monolith, layered, manual dependency injection

Status: Accepted (recorded retroactively)

## Context

The domain has three natural areas — catalog, booking, payment — plus notifications. The
project's purpose is to exercise distributed-systems problems: multiple instances,
shared state, partial failure, async work. Those problems appear as soon as there are
several API processes, a shared database and a worker; they do not require splitting
the domain into separately deployed services.

## Options considered

1. **Microservices** (catalog, booking, payment, notification as separate deployables).
2. **Single-layer Express app** (SQL in route handlers).
3. **Modular monolith** with layers (`interfaces` → `application` → `domain` ← `infrastructure`)
   and one deployable used for both API and worker entry points.

For wiring: a DI container (tsyringe, inversify, awilix) vs. a hand-written composition root.

## Decision

Option 3, with a manual composition root in `backend/src/composition/buildApp.ts`. The
worker (`src/worker.ts`) composes its own, smaller graph from the same modules.

## Consequences

- One codebase, one image, two process types. Scaling is per process type (API replicas,
  worker replicas), not per domain area.
- Use cases depend on ports (`BookingRepository`, `PaymentProvider`, `EventPublisher`,
  `IdempotencyStore`), which is what makes `tests/unit/create-booking.test.ts` possible
  with plain `vi.fn()` mocks.
- The dependency graph is explicit and readable in one file; there are no decorators or
  runtime reflection.
- Payment is an in-process adapter, so there is no network hop to fail between booking
  and payment — the external provider remains the only remote dependency on that path.

## Trade-offs

- The composition root grows linearly with the graph; ~120 lines today.
- Layering is enforced by convention only. `CreateBookingUseCase` already imports
  concrete helpers from `infrastructure/resilience`.
- A shared database across all modules means no module can change the schema
  independently — acceptable for one team, a problem for several.
