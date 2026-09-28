# ADR 0009: State changes through explicit transition endpoints

Status: Accepted (2026-09-28)

## Context

Bookings have a state machine (`pending_payment → confirmed | failed`, `confirmed →
cancelled`). Integrators need to change state (cancellation was the first need). Any state
change also affects the slot, and must be safe under concurrent requests from several API
replicas and under client retries.

## Options considered

1. `PATCH /bookings/{id}` with `{ "status": "cancelled" }`.
2. One endpoint per transition: `POST /bookings/{id}/cancel`.

## Decision

Option 2. Clients never write `status`. Each transition is a use case that:

- loads the booking with `SELECT … FOR UPDATE` inside a transaction,
- checks the transition with the domain entity (and a `WHERE status = …` predicate),
- applies all side effects on other rows (the slot) in the same transaction,
- treats "already in the target state" as success (`changed: false`), so it's safe to retry
  without an idempotency key,
- returns `409 INVALID_STATE_TRANSITION` with `from` / `allowedFrom` otherwise.

Only transitions with real behavior behind them are exposed. There is no `/confirm`
(confirmation happens inside `POST /bookings` when payment succeeds) and no `/assign`
(there is no provider model).

## Consequences

- Invalid transitions are impossible through the API rather than merely validated.
- Each transition's side effects and concurrency control live in one place.
- Adding a transition means a new endpoint, use case and test, not a new allowed value.

## Trade-offs

- More endpoints than a generic `PATCH`.
- Cancelling a `pending_payment` booking is deliberately not allowed: the create request
  owns that booking until it resolves, and its final `UPDATE` isn't conditional. Allowing
  it would require making the create path's writes conditional first.
