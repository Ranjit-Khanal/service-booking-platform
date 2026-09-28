# Architecture decision records

ADRs 0001–0007 were written **retroactively** on 2026-09-28, while preparing the repository for
open source. They reconstruct the reasoning from the code, code comments, and the original
`ARCHITECTURE.md`; there is no git history to date them more precisely. Where the code
contradicts the stated intent, the ADR says so. ADRs 0008–0009 record decisions made
while turning the backend into a self-hostable service.

| ADR | Decision |
|---|---|
| [0001](0001-modular-monolith-with-manual-di.md) | Modular monolith, layered, manual dependency injection |
| [0002](0002-postgresql-as-system-of-record.md) | PostgreSQL is the only system of record |
| [0003](0003-row-level-locking-for-slot-claims.md) | Pessimistic row lock for slot claims, outside the payment call |
| [0004](0004-idempotency-keys-for-booking-creation.md) | `Idempotency-Key` header for booking creation, stored in Redis |
| [0005](0005-rabbitmq-for-async-notifications.md) | RabbitMQ + separate worker for notifications |
| [0006](0006-redis-for-shared-ephemeral-state.md) | Redis for shared ephemeral state, with per-use fail-open / fail-closed |
| [0007](0007-multiple-api-replicas-behind-haproxy.md) | Three API replicas behind HAProxy in the default setup |
| [0008](0008-api-key-authentication.md) | API-key authentication for client applications; no user accounts |
| [0009](0009-explicit-state-transition-endpoints.md) | State changes through explicit transition endpoints, not status updates |

New ADRs: copy the structure of an existing one, number sequentially, and link it here.
