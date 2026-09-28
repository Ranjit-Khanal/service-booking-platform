import { apiFetch, unwrapEntity, unwrapList } from './client';
import type { Service, TimeSlot } from './types';

export async function fetchServices(): Promise<Service[]> {
  const payload = await apiFetch<unknown>('/api/services');
  return unwrapList<Service>(payload);
}

export async function fetchService(id: string): Promise<Service> {
  const payload = await apiFetch<unknown>(`/api/services/${encodeURIComponent(id)}`);
  return unwrapEntity<Service>(payload);
}

export async function fetchServiceSlots(serviceId: string, date: string): Promise<TimeSlot[]> {
  const query = new URLSearchParams({ date });
  const payload = await apiFetch<unknown>(
    `/api/services/${encodeURIComponent(serviceId)}/slots?${query.toString()}`,
  );
  return unwrapList<TimeSlot>(payload, ['data', 'items', 'slots']);
}
