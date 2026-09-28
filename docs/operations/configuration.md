# Configuration

All backend configuration is environment variables, parsed and validated at startup by
Zod in `backend/src/config/env.ts`. An invalid or missing required variable stops the
process with a list of every problem:

```text
Error: Invalid environment configuration:
  - DATABASE_URL: Invalid input: expected string, received undefined
  - REDIS_URL: Invalid input: expected string, received undefined
  - RABBITMQ_URL: Invalid input: expected string, received undefined
```

Cross-field rules (`API_KEYS` required when `AUTH_MODE=api_key`, `ADMIN_API_KEY` length) are
checked once the individual fields are valid, so they appear on the next attempt:

```text
  - API_KEYS: required when AUTH_MODE=api_key (comma-separated list), or set AUTH_MODE=none
```

Where values come from:

| How you run it | File | Notes |
|---|---|---|
| `docker compose up` | root [`.env`](../../.env.example) (copy of `.env.example`) | Compose substitutes `${VAR:-default}` in `docker-compose.yml` and passes a fixed set of variables to every backend container. Works without a `.env` too (defaults). |
| `npm run dev` on the host | [`backend/.env`](../../backend/.env.example) | Loaded by `dotenv`. |
| Anything else | real environment variables | `.env` files are optional. |

## Backend variables

### SERVER

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `test` \| `production`. Only changes the log transport. |
| `PORT` | `3000` | |
| `INSTANCE_ID` | `api-local` | Appears in logs and `/api/health`. The worker appends `-worker`. |
| `LOG_LEVEL` | `info` | pino levels. |
| `TRUST_PROXY` | `false` | Express `trust proxy`: `false`, `true`, a hop count (`1`), or a subnet list. Set to the number of proxies in front of the API (Compose: `1`). Too high lets clients spoof `X-Forwarded-For`. |
| `CORS_ORIGINS` | `*` | Comma-separated origins, or `*`. |

### DATABASE

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | **required** | `postgres://user:pass@host:port/db` |
| `DB_POOL_MAX` | `10` | Per process. Total = replicas × this + worker. |

### REDIS

| Variable | Default | Notes |
|---|---|---|
| `REDIS_URL` | **required** | The worker validates it but doesn't connect. |
| `REDIS_KEY_PREFIX` | `slotbook:` | Prefix for every key; lets several deployments share one Redis. |

### MESSAGE_BROKER

| Variable | Default | Notes |
|---|---|---|
| `RABBITMQ_URL` | **required** | `amqp://user:pass@host:port` |
| `BOOKING_EVENTS_EXCHANGE` | `booking.events` | |
| `NOTIFICATION_QUEUE` | `notifications` | |
| `NOTIFICATION_DLQ` | `notifications.dlq` | Changing queue arguments on an existing queue fails with `PRECONDITION_FAILED`; delete the queue first. |

### AUTH

| Variable | Default | Notes |
|---|---|---|
| `AUTH_MODE` | `api_key` | `api_key` \| `none`. |
| `API_KEYS` | — | Comma-separated. **Required** when `AUTH_MODE=api_key`. One per client application. |
| `ADMIN_API_KEY` | unset | Enables `/api/admin/*`; ≥ 16 chars. Empty = unset = admin routes return 404. |

### RATE LIMITING

| Variable | Default | Notes |
|---|---|---|
| `RATE_LIMIT_WINDOW_MS` | `60000` | Fixed window. |
| `RATE_LIMIT_MAX` | `60` | Per client IP per window. Compose default 120. |

### BOOKING / PAYMENT

| Variable | Default | Notes |
|---|---|---|
| `PAYMENT_PROVIDER` | `mock` | `mock` \| `stripe` \| `esewa`. `stripe`/`esewa` are **stubs that always succeed**. |
| `PAYMENT_TIMEOUT_MS` | `3000` | Per attempt. |
| `PAYMENT_MAX_RETRIES` | `3` | Total attempts, not additional retries. |
| `IDEMPOTENCY_TTL_SECONDS` | `86400` | Also how long a failed key stays blocked. |

### FAILURE SIMULATION (demo)

`FAIL_PAYMENT`, `FAIL_REDIS`, `FAIL_DATABASE`, `FAIL_BROKER_PUBLISH` (`"true"` enables) and
`PAYMENT_LATENCY_MS` set the API's initial failure-injection flags. They aren't passed by
`docker-compose.yml`; use the admin API instead. The worker ignores them.

## Compose-only variables (root `.env`)

| Variable | Default | Used for |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `slotbook` ×3 | Postgres container and `DATABASE_URL` |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | `slotbook` ×2 | RabbitMQ container and `RABBITMQ_URL` |
| `API_HOST_PORT` | `8080` | HAProxy on the host |
| `DEMO_CLIENT_HOST_PORT` | `5173` | Demo client |
| `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT`, `RABBITMQ_HOST_PORT`, `RABBITMQ_UI_HOST_PORT` | 5433, 6380, 5673, 15673 | Bound to 127.0.0.1 |
| `DEMO_CLIENT_API_KEY` | `dev-local-key-change-me` | Baked into the demo JS; must be one of `API_KEYS` |
| `DEMO_CLIENT_ADMIN_API_KEY` | empty | Baked into the demo JS for the Ops page |

`demo-client` reads `VITE_API_BASE_URL`, `VITE_API_KEY` and `VITE_ADMIN_API_KEY` **at build
time**; change them and rebuild (`docker compose up --build demo-client`).

## Hard-coded values

Not configurable without a code change:

| Setting | Value | Location |
|---|---|---|
| Circuit breaker threshold / reset | 5 failures / 15s | `composition/buildApp.ts` |
| Payment retry backoff | 100ms base, 2000ms cap | `CreateBookingUseCase.ts` |
| Consumer max retries / prefetch | 3 / 10 | `BookingCreatedConsumer.ts`, `rabbitmq.ts` |
| Cache TTLs | 60s / 120s / 8s | `cache/CachePolicy.ts` |
| Postgres connect / idle timeout | 5s / 30s | `database/pool.ts` |
| Redis reconnect schedule | 100ms → 5s | `redis/redis.ts` |
| Shutdown timeout API / worker | 25s / 10s | `shared/shutdown.ts`, `worker.ts` |
| JSON body limit | 100kb | `createHttpApp.ts` |

## Secrets

Secrets are the API keys, the admin key and the credentials inside `DATABASE_URL` /
`RABBITMQ_URL`. The committed templates contain only placeholders. `.env` and `.env.*`
(except `.env.example`) are gitignored and excluded from Docker build contexts. There are
no third-party API keys in the codebase because the payment adapters are stubs. When a
real provider is added, its key belongs in `env.ts`, validated like the others.
