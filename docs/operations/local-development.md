# Local development

## Prerequisites

- Node.js ≥ 20 (`engines` in `backend/package.json`; Docker images use Node 22)
- Docker with Compose v2 (for Postgres, Redis, RabbitMQ)
- `curl` and optionally `jq` for the examples

## Run infrastructure in Docker, code on the host

```bash
# 1. Infrastructure only
docker compose up -d postgres redis rabbitmq

# 2. Backend
cd backend
cp .env.example .env          # host ports 5433 / 6380 / 5673 are pre-filled
npm install
npm run migrate
npm run seed                  # demo data, only if the DB has no services (seed:reset wipes first)
npm run dev                   # API on http://localhost:3000 (tsx watch)

# 3. Worker (second terminal)
cd backend
npm run dev:worker

# 4. Demo client (optional, third terminal)
cd demo-client
npm install
VITE_API_BASE_URL=http://localhost:3000 VITE_API_KEY=dev-local-key-change-me npm run dev
```

In this mode there is one API process and no HAProxy, so multi-instance behavior
(shared rate limit, per-replica circuit breakers, failover) is not exercised. Use the
full Compose stack for that ([docker.md](docker.md)).

## Smoke test

```bash
API=http://localhost:3000   # or http://localhost:8080 for the Compose stack
AUTH="Authorization: Bearer dev-local-key-change-me"

curl -s $API/api/health | jq

SERVICE_ID=$(curl -s -H "$AUTH" $API/api/services | jq -r '.data[0].id')
DAY=$(date -u -d tomorrow +%F)
SLOT_ID=$(curl -s -H "$AUTH" "$API/api/services/$SERVICE_ID/slots?date=$DAY" | jq -r '.data[0].id')

KEY=$(uuidgen)
curl -s -X POST $API/api/bookings -H "$AUTH" \
  -H 'content-type: application/json' \
  -H "Idempotency-Key: $KEY" \
  -d "{\"serviceId\":\"$SERVICE_ID\",\"slotId\":\"$SLOT_ID\",\"customerName\":\"Ada\",\"customerEmail\":\"ada@example.com\"}" | jq

# Same key again → 200, replayed: true
curl -s -X POST $API/api/bookings -H "$AUTH" \
  -H 'content-type: application/json' \
  -H "Idempotency-Key: $KEY" \
  -d "{\"serviceId\":\"$SERVICE_ID\",\"slotId\":\"$SLOT_ID\",\"customerName\":\"Ada\",\"customerEmail\":\"ada@example.com\"}" | jq
```

The worker log should show `EMAIL_SENT booking confirmation` for the new booking. Cancel it:

```bash
BOOKING_ID=…   # from the create response
curl -s -X POST -H "$AUTH" $API/api/bookings/$BOOKING_ID/cancel | jq
```

## Tests

```bash
cd backend
npm run typecheck
npm run test:unit                             # no infrastructure needed

# Concurrency tests: need Postgres reachable via DATABASE_URL (backend/.env) and migrated.
RUN_INTEGRATION=1 npm run test:concurrency
```

| Script | Contents |
|---|---|
| `test:unit` | 4 files, 22 tests: Booking transitions, `withRetry`, `CircuitBreaker`, `CreateBookingUseCase` with mocks, `CatalogCache`, API-key/admin middleware, config validation, `CancelBookingUseCase` |
| `test:concurrency` | Real Postgres, skipped unless `RUN_INTEGRATION=1`. `slot-claim.test.ts`: two concurrent claims, one wins. `booking-cancel.test.ts`: 10 concurrent cancels → one transition; re-claim race after cancel; cancel refused for `pending_payment`. |
| `test:integration`, `test:api` | Directories exist but are **empty**; these scripts currently find no tests. |
| `test` | All of the above |

`slot-claim.test.ts` inserts a service named "Concurrency Test" (and a slot in 2031) and
does not clean them up, so that service then appears in the catalog. `booking-cancel.test.ts`
cleans up after itself. Prefer a throwaway database.

## Useful commands

```bash
# Redis keys
docker compose exec redis redis-cli --scan --pattern 'slotbook:*'

# Postgres shell
docker compose exec postgres psql -U slotbook -d slotbook

# Orphan check: booked slots without a confirmed booking
docker compose exec postgres psql -U slotbook -d slotbook -c "
  SELECT s.id, s.starts_at, b.status
    FROM time_slots s
    LEFT JOIN bookings b ON b.slot_id = s.id AND b.status IN ('confirmed','pending_payment')
   WHERE s.status = 'booked' AND (b.id IS NULL OR b.status = 'pending_payment');"

# RabbitMQ queues
docker compose exec rabbitmq rabbitmqctl list_queues name messages_ready messages_unacknowledged
```

RabbitMQ management UI: http://localhost:15673 (credentials from `.env`; `slotbook` /
`slotbook` by default, bound to localhost).
