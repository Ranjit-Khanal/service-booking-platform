import { apiFetch } from './client';
import type { FailureFlags, HealthStatus } from './types';
import { fetchHealth, postAdminFailures } from './bookings';

export { fetchHealth, postAdminFailures };
export type { FailureFlags, HealthStatus };

/** @deprecated use postAdminFailures from bookings — kept for OpsPage imports */
export async function getFailures(): Promise<FailureFlags> {
  return apiFetch<{ data: FailureFlags }>('/api/admin/failures').then((r) =>
    'data' in r && r.data ? r.data : (r as FailureFlags),
  );
}
