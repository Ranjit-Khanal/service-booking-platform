# ADR 0002: PostgreSQL is the only system of record

Status: Accepted (recorded retroactively)

## Context

The core invariant is "one confirmed booking per slot, and never a charge without a
booking record". Enforcing it needs atomic conditional updates, row locking and unique
constraints that hold across every API replica. There is also a need for durable
consumer-side dedupe.

## Options considered

1. PostgreSQL for everything durable.
2. Redis as primary store for slots (fast `SET NX` / Lua claims), Postgres for bookings.
3. A document store.

## Decision

PostgreSQL owns services, slots, bookings and `processed_events`. Redis and RabbitMQ hold
nothing that cannot be rebuilt or lost without violating a booking invariant.

## Consequences

- Invariants live in the schema: `bookings_confirmed_slot_uq`,
  `bookings_idempotency_uq`, `time_slots_service_starts_uq`, `CHECK` constraints on
  statuses and amounts. They hold even if application code has a bug.
- Slot claims are serialised by Postgres row locks (ADR 0003), which work across any
  number of replicas without extra coordination.
- Losing Redis loses idempotency *replays* but cannot create a double booking, because the
  Postgres unique index is the backstop (ADR 0004).
- Postgres is a single point of failure: when it is down, nothing works except cached
  catalog reads (and those are masked by the rate limiter — see known limitations).

## Trade-offs

- Every booking needs several round-trips to one primary; write throughput is bounded by
  that primary. Not a constraint at this scale.
- No replica, backup or failover configuration exists in the repository.
