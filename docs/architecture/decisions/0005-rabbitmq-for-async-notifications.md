# ADR 0005: RabbitMQ and a separate worker for notifications

Status: Accepted (recorded retroactively)

## Context

After a booking is confirmed, the customer should get a confirmation. Email delivery is
slow and unreliable compared to the booking itself, and a notification failure must not
fail or delay a paid booking.

## Options considered

1. Send inline in the request.
2. Fire-and-forget in the same process (`setImmediate`, un-awaited promise).
3. Postgres job table polled by a worker (can be written in the same transaction as the
   confirm).
4. Message broker (RabbitMQ) with a separate worker process.
5. Redis-based queue (BullMQ, streams).

## Decision

Option 4: publish `booking.created` to a durable topic exchange; a durable queue with a
dead-letter queue; a separate worker process with manual acks, `prefetch(10)`, bounded
retries, and an idempotent consumer backed by a Postgres `processed_events` table.

## Consequences

- Booking latency is independent of the notification path.
- Workers scale independently (`--scale worker=N`).
- Redelivery is expected and handled via dedupe on `booking.created:{bookingId}:email`.
- Poison messages end in `notifications.dlq` after 4 attempts instead of looping.
- A third stateful service (RabbitMQ) must be running for the API to start.

## Trade-offs

- **Dual write.** The confirm (Postgres) and the publish (RabbitMQ) are separate; there is
  no outbox and no publisher confirms, so events can be lost. Option 3 avoids this by
  construction; an outbox on top of option 4 would too.
- Consumer retries are immediate, not delayed.
- Broker loss is handled by exiting gracefully and letting the supervisor restart the
  process (added 2026-09-28 after a broker restart was shown to leave APIs running with a
  dead channel). Simple, but all API replicas restart together.
- The topic exchange leaves room for more consumers (e.g. analytics) without changing the
  publisher; today there is only one.
