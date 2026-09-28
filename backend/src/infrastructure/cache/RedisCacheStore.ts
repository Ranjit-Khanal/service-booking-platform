import type { CacheStore } from '../../domain/repositories/InfrastructurePorts.js';
import type { Logger } from '../../shared/logger/logger.js';
import type { Redis as RedisClient } from 'ioredis';
import type { FailureSimulator } from '../resilience/FailureSimulator.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Redis-backed cache with fail-open reads and single-flight getOrSet.
 */
export function createRedisCacheStore(
  redis: RedisClient,
  keyPrefix: string,
  logger: Logger,
  failures: FailureSimulator,
): CacheStore {
  const full = (key: string) => `${keyPrefix}cache:${key}`;

  const safe = async <T>(op: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    if (failures.shouldFailRedis()) {
      logger.warn({ op }, 'Cache bypassed (simulated Redis failure)');
      return fallback;
    }
    try {
      return await fn();
    } catch (err) {
      logger.warn({ err, op }, 'Cache operation failed; treating as miss/bypass');
      return fallback;
    }
  };

  const store: CacheStore = {
    async get<T>(key: string): Promise<T | null> {
      return safe(
        'get',
        async () => {
          const raw = await redis.get(full(key));
          return raw ? (JSON.parse(raw) as T) : null;
        },
        null,
      );
    },

    async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
      await safe(
        'set',
        async () => {
          await redis.set(full(key), JSON.stringify(value), 'EX', Math.max(1, ttlSeconds));
        },
        undefined,
      );
    },

    async del(key: string): Promise<void> {
      await safe(
        'del',
        async () => {
          await redis.del(full(key));
        },
        undefined,
      );
    },

    async delByPrefix(prefix: string): Promise<number> {
      return safe(
        'delByPrefix',
        async () => {
          const match = full(prefix) + '*';
          let cursor = '0';
          let removed = 0;
          do {
            const [next, keys] = await redis.scan(cursor, 'MATCH', match, 'COUNT', 100);
            cursor = next;
            if (keys.length > 0) {
              removed += await redis.del(...keys);
            }
          } while (cursor !== '0');
          return removed;
        },
        0,
      );
    },

    async getOrSet<T>(
      key: string,
      ttlSeconds: number,
      loader: () => Promise<T>,
      options?: { lockTtlSeconds?: number; waitMs?: number },
    ): Promise<{ value: T; source: 'hit' | 'miss' | 'hit-after-wait' | 'bypass' }> {
      const lockTtlSeconds = options?.lockTtlSeconds ?? 3;
      const waitMs = options?.waitMs ?? 40;

      const hit = await store.get<T>(key);
      if (hit !== null) {
        return { value: hit, source: 'hit' };
      }

      if (failures.shouldFailRedis()) {
        const value = await loader();
        return { value, source: 'bypass' };
      }

      const lockKey = full(`lock:${key}`);
      let acquired = false;
      try {
        const set = await redis.set(lockKey, '1', 'EX', lockTtlSeconds, 'NX');
        acquired = set === 'OK';
      } catch (err) {
        logger.warn({ err, key }, 'Cache lock failed; loading without lock');
        const value = await loader();
        await store.set(key, value, ttlSeconds);
        return { value, source: 'miss' };
      }

      if (!acquired) {
        await sleep(waitMs);
        const again = await store.get<T>(key);
        if (again !== null) {
          return { value: again, source: 'hit-after-wait' };
        }
      }

      try {
        const value = await loader();
        await store.set(key, value, ttlSeconds);
        return { value, source: 'miss' };
      } finally {
        if (acquired) {
          await redis.del(lockKey).catch(() => undefined);
        }
      }
    },
  };

  return store;
}
