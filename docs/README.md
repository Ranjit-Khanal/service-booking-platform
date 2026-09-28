# SlotBook documentation

| Start here | |
|---|---|
| Run it | [deployment/self-hosting.md](deployment/self-hosting.md) |
| Integrate with it | [api/overview.md](api/overview.md) · [api/openapi.yaml](api/openapi.yaml) |
| Understand it | [architecture/overview.md](architecture/overview.md) → [request-flow](architecture/request-flow.md) → [booking-lifecycle](architecture/booking-lifecycle.md) |
| Know its limits | [architecture/known-limitations.md](architecture/known-limitations.md) · [security.md](security.md) |
| License | [licensing.md](licensing.md) (community edition, AGPLv3, future boundary, third-party) |

## Layout

```text
docs/
├── api/                  integration guide + OpenAPI 3.1 spec
├── architecture/         overview, request flow, booking lifecycle, known limitations
│   └── decisions/        ADRs 0001–0009
├── distributed-systems/  concurrency, database-locking, transactions, idempotency, redis,
│                         caching, messaging, retries, graceful-shutdown, failure-scenarios
├── database/             schema
├── deployment/           self-hosting
├── operations/           local development, docker, configuration, failure injection
├── security.md
├── licensing.md          license, contribution terms, future open-core boundary, third-party
├── contributing.md       → ../CONTRIBUTING.md
└── BOOK_KNOWLEDGE_MAP.md book concepts ↔ code (background reading)
```

Every page in `distributed-systems/` follows the same structure: **Problem → Naive
implementation → Actual implementation → Failure scenarios → Trade-offs**. Statements
marked *verified* were exercised against a running stack; everything else is derived from
the code, and unclear behavior is labelled as such.
