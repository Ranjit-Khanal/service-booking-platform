// SPDX-License-Identifier: AGPL-3.0-only
export interface Service {
  id: string;
  name: string;
  description?: string;
  durationMinutes?: number;
  priceCents?: number;
  currency?: string;
  category?: string;
}

export interface TimeSlot {
  id: string;
  serviceId: string;
  startsAt: string;
  endsAt: string;
  status: 'open' | 'held' | 'booked' | string;
  version?: number;
}

export interface Booking {
  id: string;
  serviceId: string;
  serviceName?: string;
  slotId?: string;
  customerName?: string;
  customerEmail: string;
  amountCents?: number;
  currency?: string;
  status?: string;
  paymentReference?: string | null;
  createdAt?: string;
  replayed?: boolean;
  /** Present when API returns mapped start time from joins (optional). */
  startsAt?: string;
}

export interface CreateBookingPayload {
  serviceId: string;
  slotId: string;
  customerName: string;
  customerEmail: string;
}

export interface HealthStatus {
  status?: string;
  instanceId?: string;
  checks?: Record<string, boolean | { status?: string; ok?: boolean }>;
  circuitBreaker?: string;
  failures?: FailureFlags;
  [key: string]: unknown;
}

export interface FailureFlags {
  failPayment?: boolean;
  failRedis?: boolean;
  failDatabase?: boolean;
  failBrokerPublish?: boolean;
  paymentLatencyMs?: number;
}
