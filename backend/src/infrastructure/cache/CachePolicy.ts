/**
 * Explicit cache key + TTL policy for SlotBook.
 *
 * What we cache (read-heavy, eventually consistent OK):
 * - active service catalog
 * - individual service detail
 * - open slots for a service/day (very short TTL)
 *
 * What we NEVER cache:
 * - bookings (authoritative, user-specific, mutate often)
 * - payment results (use idempotency store instead)
 * - health checks
 */
export const CacheKeys = {
  servicesActive: () => 'catalog:services:active',
  service: (id: string) => `catalog:service:${id}`,
  /** Open slots for one service on one UTC date (YYYY-MM-DD). */
  slots: (serviceId: string, dateIso: string) => `catalog:slots:${serviceId}:${dateIso}`,
  slotsPrefix: (serviceId: string) => `catalog:slots:${serviceId}:`,
  catalogPrefix: () => 'catalog:',
} as const;

export const CacheTtl = {
  /** Catalog changes rarely in this product. */
  servicesListSeconds: 60,
  serviceDetailSeconds: 120,
  /**
   * Slot inventory is hot and mutates on every booking.
   * Short TTL + explicit invalidation on book = low stale window.
   */
  openSlotsSeconds: 8,
} as const;

export type CacheMetrics = {
  hits: number;
  misses: number;
  bypasses: number;
  invalidations: number;
};

export function createCacheMetrics(): CacheMetrics {
  return { hits: 0, misses: 0, bypasses: 0, invalidations: 0 };
}
