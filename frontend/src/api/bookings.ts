import { apiFetch, unwrapEntity, unwrapList } from './client';
import type { Booking, CreateBookingPayload, FailureFlags, HealthStatus } from './types';

export async function createBooking(
  payload: CreateBookingPayload,
  idempotencyKey: string,
): Promise<Booking> {
  const body = await apiFetch<unknown>('/api/bookings', {
    method: 'POST',
    body: JSON.stringify(payload),
    idempotencyKey,
  });
  return unwrapEntity<Booking>(body);
}

export async function fetchBooking(id: string): Promise<Booking> {
  const payload = await apiFetch<unknown>(`/api/bookings/${encodeURIComponent(id)}`);
  return unwrapEntity<Booking>(payload);
}

export async function fetchBookingsByEmail(email: string): Promise<Booking[]> {
  const query = new URLSearchParams({ email });
  const payload = await apiFetch<unknown>(`/api/bookings?${query.toString()}`);
  return unwrapList<Booking>(payload, ['data', 'items', 'bookings']);
}

export async function fetchHealth(): Promise<HealthStatus> {
  return apiFetch<HealthStatus>('/api/health');
}

export async function postAdminFailures(payload: FailureFlags): Promise<FailureFlags> {
  const result = await apiFetch<{ data?: FailureFlags } | FailureFlags>('/api/admin/failures', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (result && typeof result === 'object' && 'data' in result && result.data) {
    return result.data;
  }
  return result as FailureFlags;
}
