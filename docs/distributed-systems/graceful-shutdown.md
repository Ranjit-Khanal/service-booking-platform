# Graceful shutdown

## Problem

`docker compose stop`, a rolling deploy, or Kubernetes all send `SIGTERM` and, after a
grace period, `SIGKILL`. If the process exits immediately on `SIGTERM`:

- requests in the middle of a booking are cut off between slot claim and payment,
  leaving exactly the orphaned state that nothing recovers (see
  [booking-lifecycle.md](../architecture/booking-lifecycle.md#exceptional-paths));
- the load balancer keeps sending new connections until its health check notices;
- open Postgres/Redis/AMQP connections are dropped rather than closed.

## Naive implementation

```ts
process.on('SIGTERM', () => process.exit(0));
```

or no handler at all (Node's default for `SIGTERM` is to exit immediately).

## Actual implementation — API

`backend/src/shared/shutdown.ts`, registered from `main.ts` with
`resources: [messaging, redisStack, db]`:

```text
SIGTERM / SIGINT  (or self-sent SIGTERM when the RabbitMQ connection is lost)
  │  (second signal ignored — shuttingDown flag)
  ├─ start 25s force-exit timer (unref'd) → exit(1) if reached
  ├─ server.close()
  │     stop accepting new connections
  │     close idle keep-alive connections
  │     wait for in-flight requests to finish
  ├─ stopWorkers            (none are passed by main.ts — no-op)
  ├─ messaging.close()      AMQP channel, then connection
  ├─ redis.quit()
  ├─ pool.end()             Postgres
  └─ exit(0)                (any error in the sequence → exit(1))
```

### Why this order

- **HTTP first.** New work must stop before its dependencies go away. `server.close()`
  resolves only after in-flight requests finish, so a booking that is mid-payment still
  has Redis, Postgres and RabbitMQ available for its confirm, publish and `complete`
  steps.
- **Producers before stores.** RabbitMQ is closed first because nothing publishes
  once HTTP is drained; Redis and Postgres last. For the API the relative order of the
  three is not critical, since HTTP draining already guarantees no users are left.
- **Force timer.** A stuck request (e.g. waiting on a `drain` event that never comes)
  must not block exit forever. 25s is chosen to fit inside Kubernetes' default 30s grace
  period.

### Worker

`backend/src/worker.ts` has its own, simpler handler:

```text
SIGTERM / SIGINT  (or self-sent SIGTERM on broker connection loss)
  │  (re-entry guard; 10s force-exit timer)
  ├─ channel.cancel(consumerTag)   stop receiving new deliveries (ignored if channel is gone)
  ├─ messaging.close()             channel + connection (errors ignored)
  ├─ pool.end()
  └─ exit(0)                       any other error → exit(1)
```

- In-flight messages are **not awaited**. `cancel()` stops new deliveries, but a handler
  that is mid-`INSERT` continues; when the channel then closes, its eventual `ack` fails
  and RabbitMQ redelivers the message to another consumer. `processed_events` makes the
  redelivery a no-op for anything that already inserted its row.

## Failure scenarios

| Scenario | Result |
|---|---|
| `SIGTERM` with no traffic | Clean exit in milliseconds. |
| `SIGTERM` during a booking | Request completes (up to ~9.4s if payment is slow), then exit. |
| `SIGTERM` via `docker compose stop` | API replicas have `stop_grace_period: 30s`, above the 25s drain timer. The worker keeps Compose's 10s default, matching its 10s timer. |
| RabbitMQ connection lost | Process sends itself `SIGTERM` → normal drain → exit → Compose restarts it. |
| Client on a long keep-alive connection | Idle keep-alive sockets are closed by `server.close()` (Node ≥ 19); HAProxy uses `http-server-close` anyway. |
| HAProxy during drain | The replica stops accepting connections, so HAProxy's next health check fails; after 3 failures (~6s) it is removed. Requests routed to it in that window fail to connect and are not retried by HAProxy (`option redispatch` / `retry-on` are not configured). |
| Redis `quit` fails | Caught → logged → `exit(1)`; Postgres pool is not closed (process exits anyway). |
| Worker killed mid-message | Redelivered; dedupe prevents a second notification. |

## What is not implemented

- **Readiness flip before close.** The health endpoint does not start returning 503 on
  `SIGTERM`, so the load balancer only learns about the drain from refused connections.
  Returning 503 from `/api/health` for a couple of check intervals before
  `server.close()` would let HAProxy stop routing first.
- **Per-request deadlines**, so that "finish in-flight work" has a bound shorter than the
  force timer.
- **Worker drain.** Tracking in-flight handlers and awaiting them before closing the
  channel would avoid the redelivery on every restart.

## Trade-offs

- Waiting for in-flight work lengthens deploys by up to the longest request. For this
  API that is bounded by the payment retry budget.
- The shared `registerGracefulShutdown` helper accepts `stopWorkers`, but the worker
  process uses its own handler (now with a guard and timer). Folding it into the helper
  would remove the duplication.
