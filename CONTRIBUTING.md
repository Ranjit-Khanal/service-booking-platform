# Contributing

Thanks for looking. Contributions to the SlotBook community edition are welcome: bug
fixes, tests, docs, and features such as the ones listed as missing in
[known-limitations.md](docs/architecture/known-limitations.md).

SlotBook is small on purpose: a modular monolith where each distributed-systems mechanism
is easy to find, test and reason about. Contributions that keep it that way fit best.

## Licensing of contributions

The project is licensed under [AGPL-3.0-only](LICENSE). By submitting a contribution you
agree that it is offered under that same license. There is no CLA and no copyright
assignment; you keep the copyright in your work. New source files should start with:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
```

Only contribute code you wrote or have the right to submit under this license. Don't paste
code from sources with incompatible or unclear terms (including book samples and Q&A sites
without checking their license). Background: [docs/licensing.md](docs/licensing.md).

## Reporting issues

- **Bugs:** open a GitHub issue with what you ran, what you expected, what happened, and
  the relevant log lines (include the `correlationId` from the error response).
- **Security problems:** do not open a public issue; follow [SECURITY.md](SECURITY.md).
- **Feature ideas:** open an issue describing the use case first, especially for anything
  touching the booking state machine or adding infrastructure.

## Development setup

```bash
docker compose up -d postgres redis rabbitmq
cd backend
cp .env.example .env
npm install
npm run migrate && npm run seed
npm run dev          # API :3000
npm run dev:worker   # second terminal
```

Full stack with 3 replicas + HAProxy: `cp .env.example .env && docker compose up --build`
at the repository root. Details in
[docs/operations/local-development.md](docs/operations/local-development.md).

## Architecture

Start with [docs/architecture/overview.md](docs/architecture/overview.md) and
[request-flow.md](docs/architecture/request-flow.md). The layering rule: use cases depend on
ports in `domain/`, and concrete adapters are chosen only in `composition/buildApp.ts`.

## Repository structure

```text
backend/
  src/
    domain/          entities + ports (interfaces). No I/O.
    application/     use cases; orchestrate ports
    infrastructure/  Postgres, Redis, RabbitMQ, payment adapters, resilience helpers
    interfaces/      HTTP (controllers, middleware, routes) and AMQP consumers
    composition/     buildApp.ts — the only place concrete classes are wired
    main.ts          API entry     worker.ts   worker entry
  tests/
    unit/            no infrastructure
    concurrency/     real Postgres, gated by RUN_INTEGRATION=1
demo-client/         React reference client (not required by the backend)
docker/haproxy/      load balancer config
docs/                architecture, API, distributed-systems, operations, ADRs
```

## Coding conventions

- TypeScript `strict`, ES modules, `.js` suffix in relative imports.
- Use cases depend on ports in `domain/`; new infrastructure goes behind a port and is
  wired in `composition/buildApp.ts`. No DI container.
- Errors that reach clients are `AppError` subclasses (`shared/errors/AppError.ts`) with a
  stable `code`. Don't let driver errors leak.
- Every SQL statement is parameterised.
- Log with the request/child logger so `correlationId` is attached; log objects, not
  string concatenation.
- Match the surrounding comment style: explain *why* (the race, the failure mode), not
  what the next line does.

## Testing

```bash
cd backend
npm run typecheck
npm run test:unit
RUN_INTEGRATION=1 npm run test:concurrency   # needs DATABASE_URL to a migrated DB
```

Expectations:

- Changes to booking state, locking, idempotency or messaging need a test that fails
  without the change. For races, prefer a real-Postgres test in `tests/concurrency/` that
  fires concurrent calls with `Promise.all` and asserts on the final rows.
- Integration tests create their own rows and clean them up.
- Don't mock the thing you are testing the concurrency of.

## Commits

- One logical change per commit, imperative subject (`Add cancel endpoint`, not
  `added stuff`).
- Explain *why* in the body when the change touches correctness (locks, transactions,
  retries, ack/nack).

## Pull requests

- Describe the problem, the change, and how you verified it (commands + output).
- Update the affected docs in the same PR. If behavior under failure changes, update
  [docs/distributed-systems/failure-scenarios.md](docs/distributed-systems/failure-scenarios.md).
- If you fix an item from [known-limitations.md](docs/architecture/known-limitations.md),
  move it to the "Fixed" section there.
- Keep PRs reviewable; split refactors from behavior changes.

## Proposing architectural changes

Open an issue first, then add an ADR under
[docs/architecture/decisions/](docs/architecture/decisions/README.md) using the existing
format (Context, Options considered, Decision, Consequences, Trade-offs). The bar for new
infrastructure (another datastore, broker, orchestrator) is high. Show the failure it
prevents and why Postgres/Redis/RabbitMQ can't handle it.

## Adding a distributed-systems demonstration

A good addition solves a real problem in the booking domain (e.g. a transactional outbox
for `booking.created`, a reaper for stale `pending_payment` bookings, delayed consumer
retries). It should come with:

1. The implementation, behind existing ports where possible.
2. A test that reproduces the failure without it.
3. A doc section in `docs/distributed-systems/` using the page structure: Problem → Naive
   implementation → Actual implementation → Failure scenarios → Trade-offs.
4. If useful, a `FailureSimulator` flag and an entry in
   [docs/operations/failure-injection.md](docs/operations/failure-injection.md).

Please don't add mechanisms only to showcase them (e.g. Kafka, CQRS, service mesh) without
a problem in this codebase that needs them.
