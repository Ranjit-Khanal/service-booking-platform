/**
 * Application cache port.
 *
 * Strategy: cache-aside (lazy load) with Redis as the shared store so all API
 * instances see the same entries under horizontal scale (book Ch9).
 *
 * Cache reads are fail-open: Redis outages become cache misses, not 503s.
 * Idempotency / rate-limit stay fail-closed elsewhere.
 */
export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Delete every key matching prefix (SCAN + DEL). */
  delByPrefix(prefix: string): Promise<number>;

  /**
   * Cache-aside with single-flight lock to reduce stampede when TTL expires.
   * Only one instance runs `loader`; others briefly wait then re-read.
   */
  getOrSet<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
    options?: { lockTtlSeconds?: number; waitMs?: number },
  ): Promise<{ value: T; source: 'hit' | 'miss' | 'hit-after-wait' | 'bypass' }>;
}

export type IdempotencyRecord = {
  key: string;
  requestHash: string;
  statusCode: number;
  body: unknown;
  createdAt: string;
};

export interface IdempotencyStore {
  get(key: string): Promise<IdempotencyRecord | null>;
  begin(
    key: string,
    requestHash: string,
    ttlSeconds: number,
  ): Promise<'acquired' | 'in_progress' | 'completed'>;
  complete(key: string, record: Omit<IdempotencyRecord, 'key'>, ttlSeconds: number): Promise<void>;
}

export interface RateLimiter {
  consume(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; remaining: number; resetMs: number }>;
}
