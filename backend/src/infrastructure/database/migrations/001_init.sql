-- SPDX-License-Identifier: AGPL-3.0-only
-- SlotBook schema
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS services (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  duration_minutes INT NOT NULL CHECK (duration_minutes > 0),
  price_cents   INT NOT NULL CHECK (price_cents >= 0),
  currency      TEXT NOT NULL DEFAULT 'USD',
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS time_slots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id    UUID NOT NULL REFERENCES services(id),
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('open', 'held', 'booked')),
  version       INT NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT time_slots_range CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS time_slots_service_starts_uq
  ON time_slots (service_id, starts_at);

CREATE INDEX IF NOT EXISTS time_slots_open_lookup_idx
  ON time_slots (service_id, starts_at)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS bookings (
  id                 UUID PRIMARY KEY,
  service_id         UUID NOT NULL REFERENCES services(id),
  slot_id            UUID NOT NULL REFERENCES time_slots(id),
  customer_name      TEXT NOT NULL,
  customer_email     TEXT NOT NULL,
  amount_cents       INT NOT NULL CHECK (amount_cents >= 0),
  currency           TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('pending_payment', 'confirmed', 'cancelled', 'failed')),
  idempotency_key    TEXT NOT NULL,
  payment_reference  TEXT,
  created_at         TIMESTAMPTZ NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS bookings_idempotency_uq
  ON bookings (idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS bookings_confirmed_slot_uq
  ON bookings (slot_id)
  WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS bookings_email_idx
  ON bookings (customer_email);

CREATE TABLE IF NOT EXISTS processed_events (
  event_id       TEXT PRIMARY KEY,
  processed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  correlation_id TEXT
);
