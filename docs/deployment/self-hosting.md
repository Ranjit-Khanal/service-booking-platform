# Self-hosting

SlotBook runs entirely from this repository: PostgreSQL, Redis and RabbitMQ are standard
images, and there are no external services. Only the mock payment provider actually
works (see [Limitations](#limitations-to-know-before-relying-on-it)).

## Quick start

Requirements: Docker with Compose v2, ports 8080 and 5173 free (configurable).

```bash
git clone <repository-url> slotbook
cd slotbook
cp .env.example .env          # edit API_KEYS and passwords
docker compose up --build
```

What happens:

1. `postgres`, `redis`, `rabbitmq` start and pass health checks.
2. `migrate` applies `backend/src/infrastructure/database/migrations/001_init.sql`
   (idempotent: `CREATE … IF NOT EXISTS`).
3. `seed` inserts three demo services with 7 days of slots **only if there are no
   services yet**. It never deletes data.
4. `api1..3` start behind `haproxy` on port 8080; `worker` starts consuming.
5. `demo-client` (optional reference UI) on port 5173.

Check it:

```bash
curl http://localhost:8080/api/health
curl -H "Authorization: Bearer dev-local-key-change-me" http://localhost:8080/api/services
```

This procedure was verified on 2026-09-28 from `.env.example` in an isolated Compose
project: health, auth, booking, replay, concurrent claims, cancel, admin guard, worker
notification, Redis outage/recovery and RabbitMQ restart.

## Backend only

The demo client is not required:

```bash
docker compose up --build haproxy worker     # pulls in api1..3, infra, migrate, seed
```

A single API instance without HAProxy also works: run `api1` and publish its port, or run
the backend on the host ([../operations/local-development.md](../operations/local-development.md)).

## Configuration

All settings are environment variables; the root `.env` feeds `docker-compose.yml`, which
passes them to every backend container. The backend validates its configuration at
startup and exits with a list of problems, e.g.:

```text
Error: Invalid environment configuration:
  - API_KEYS: required when AUTH_MODE=api_key (comma-separated list), or set AUTH_MODE=none
```

Full reference: [../operations/configuration.md](../operations/configuration.md). Minimum
for anything beyond your own machine:

| Set | Why |
|---|---|
| `API_KEYS` | Random, one per client application (`openssl rand -hex 32`). |
| `POSTGRES_PASSWORD`, `RABBITMQ_PASSWORD` | Defaults are public. |
| `CORS_ORIGINS` | Your frontend origins instead of `*`. |
| `ADMIN_API_KEY` | Leave empty unless you need failure injection / cache flush. |

## Services and ports

| Service | Host port (default) | Exposure |
|---|---|---|
| HAProxy (API) | `API_HOST_PORT` 8080 | all interfaces |
| Demo client | `DEMO_CLIENT_HOST_PORT` 5173 | all interfaces |
| Postgres | `POSTGRES_HOST_PORT` 5433 | 127.0.0.1 only |
| Redis | `REDIS_HOST_PORT` 6380 | 127.0.0.1 only |
| RabbitMQ AMQP / UI | 5673 / 15673 | 127.0.0.1 only |

Put TLS in front of port 8080 (a reverse proxy or cloud load balancer); the stack itself
speaks plain HTTP.

## Database

```bash
# Migrations and seed run automatically on every `up`. To run them by hand on a running stack:
docker compose exec api1 npx tsx src/infrastructure/database/migrate.ts
docker compose exec api1 npx tsx src/infrastructure/database/seed.ts            # empty DB only

# Wipe ALL services, slots, bookings and processed events, then re-seed
docker compose exec api1 npx tsx src/infrastructure/database/seed.ts --reset
curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" http://localhost:8080/api/admin/cache/flush   # if admin enabled

# Full reset including the volume
docker compose down -v && docker compose up --build

# psql
docker compose exec postgres psql -U slotbook -d slotbook
```

Prefer `exec` into a running API container over `docker compose run` against a running
stack (see [known-limitations.md](../architecture/known-limitations.md#docker-compose-run-against-a-running-stack)).

There is no API for creating services or slots. Insert them with SQL (see
[../database/schema.md](../database/schema.md)) and flush the catalog cache, or wait
≤ 2 minutes for it to expire.

## Operations

| Task | Command |
|---|---|
| Logs (JSON) | `docker compose logs -f api1 worker` |
| Scale workers | `docker compose up -d --scale worker=3` |
| Stop gracefully | `docker compose stop` (API gets 30s via `stop_grace_period`) |
| Queue depth / DLQ | `docker compose exec rabbitmq rabbitmqctl list_queues name messages` |
| Upgrade | `git pull && docker compose up -d --build` (migrations are additive `IF NOT EXISTS`) |

Restart behavior: all long-running services have `restart: unless-stopped`. If the
RabbitMQ connection drops, API and worker processes shut down gracefully and are
restarted, reconnecting on start.

## Limitations to know before relying on it

- **Payments:** `mock` is the only functional provider. `stripe`/`esewa` are stubs that
  always succeed. Wiring a real provider means implementing `PaymentProvider` and
  forwarding the idempotency key.
- **Notifications:** the worker logs "EMAIL_SENT" instead of sending email.
- **No catalog management API**, no customer accounts, no provider/staff model.
- **No backups** are configured for the `pgdata` volume.
- **Single instance** of Postgres, Redis and RabbitMQ; no HA.
- Crash-consistency gaps (orphaned reservations, unpublished events) are listed in
  [../architecture/known-limitations.md](../architecture/known-limitations.md).
