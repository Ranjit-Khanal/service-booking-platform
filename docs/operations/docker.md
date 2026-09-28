# Docker

Quick start and day-2 commands are in
[../deployment/self-hosting.md](../deployment/self-hosting.md). This page describes what is
in the images and the Compose file.

## Compose services

| Service | Image / build | Host port | Notes |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | `127.0.0.1:5433` | Volume `pgdata`; healthcheck `pg_isready` |
| `redis` | `redis:7-alpine` | `127.0.0.1:6380` | No password, no persistence config |
| `rabbitmq` | `rabbitmq:3.13-management-alpine` | `127.0.0.1:5673`, UI `127.0.0.1:15673` | |
| `migrate` | `./backend` | — | One-shot; `001_init.sql` (idempotent) |
| `seed` | `./backend` | — | One-shot; seeds only an empty database |
| `api1`, `api2`, `api3` | `./backend` | — (internal 3000) | `node dist/main.js`; `stop_grace_period: 30s` |
| `worker` | `./backend` | — | `node dist/worker.js` |
| `haproxy` | `haproxy:2.9-alpine` | `8080` | Only public entry to the API |
| `demo-client` | `./demo-client` (nginx) | `5173` | Optional reference UI |

All host ports are configurable through the root `.env`
([configuration.md](configuration.md#compose-only-variables-root-env)). Long-running
services have `restart: unless-stopped`.

Backend variables are defined once in the `x-backend-env` YAML anchor and merged into
every backend service, so API replicas, the worker, `migrate` and `seed` see the same
configuration.

Startup order: `postgres healthy → migrate completes → seed completes → api*/worker` (APIs
also wait for Redis and RabbitMQ health).

If you are upgrading from the earlier layout, the old `web` service is now `demo-client`:
run `docker compose up --build --remove-orphans` once.

## Backend image

`backend/Dockerfile`, three stages:

1. `deps` — `npm ci` (including dev dependencies)
2. `build` — `tsc` → `dist/`
3. `release` — copies `node_modules` from `deps` (**including dev dependencies**),
   `dist/`, `package.json` and `src/`; installs `tsx` so the same image can run
   `migrate.ts` / `seed.ts`; runs as `USER node`; `CMD ["node", "dist/main.js"]`.

`node` is PID 1 and receives `SIGTERM` directly, which is what the graceful-shutdown
handler needs. `backend/.dockerignore` keeps `node_modules`, `dist` and `.env*` out of the
build context.

## HAProxy

`docker/haproxy/haproxy.cfg`:

```text
frontend inbound  :8080  maxconn 200
backend slotbook_api     balance roundrobin
  option httpchk GET /api/health ; expect 200
  server apiN apiN:3000 check inter 2s fall 3 rise 2 maxconn 50
defaults: option http-server-close, option forwardfor
timeouts: connect 5s, client 50s, server 50s, check 2s
```

- `maxconn` provides connection-level backpressure: beyond 50 concurrent connections per
  server HAProxy queues; beyond 200 at the frontend the kernel backlog holds them.
- `option forwardfor` + the API's `TRUST_PROXY=1` make `req.ip` the real client for rate
  limiting and logs.
- The health check requires **200**, and `/api/health` returns 503 if Postgres *or* Redis
  is down, so a shared-dependency outage removes all replicas at once.
- No retry/redispatch on connection failure.

## Scaling

```bash
docker compose up -d --scale worker=3     # competing consumers on one queue
```

API replicas are declared individually (`api1..3`) because `haproxy.cfg` lists them by
name. Adding one means a new service in `docker-compose.yml` (reuse the `x-api` anchor)
and a `server` line in `haproxy.cfg`.

## Stopping

```bash
docker compose stop           # API replicas get 30s to drain
docker compose down           # keep the pgdata volume
docker compose down -v        # also delete Postgres data (irreversible)
```
