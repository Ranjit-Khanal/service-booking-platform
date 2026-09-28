// SPDX-License-Identifier: AGPL-3.0-only
import type { Redis as RedisClient } from 'ioredis';
import { Redis } from 'ioredis';
import type { Env } from '../../config/env.js';
import type { Logger } from '../../shared/logger/logger.js';
import type {
  CacheStore,
  IdempotencyRecord,
  IdempotencyStore,
  RateLimiter,
} from '../../domain/repositories/InfrastructurePorts.js';
import type { FailureSimulator } from '../resilience/FailureSimulator.js';
import { ServiceUnavailableError } from '../../shared/errors/AppError.js';
import { createRedisCacheStore } from '../cache/RedisCacheStore.js';

export type RedisClients = {
  redis: RedisClient;
  cache: CacheStore;
  idempotency: IdempotencyStore;
  rateLimiter: RateLimiter;
  close: () => Promise<void>;
};

/**
 * Redis roles in SlotBook (book Ch9 Distributed Primitives):
 * 1. Catalog cache (fail-open) — CacheStore / CatalogCache
 * 2. Idempotency keys (fail-closed) — SET NX
 * 3. Distributed rate limit (fail-closed) — INCR
 *
 * Without a shared Redis, each API instance would diverge on all three.
 */
export function createRedisStack(
  env: Pick<Env, 'REDIS_URL' | 'REDIS_KEY_PREFIX'>,
  logger: Logger,
  failures: FailureSimulator,
): RedisClients {
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    retryStrategy: (times: number) => {
      const schedule = [100, 250, 500, 1000, 2000, 5000];
      return schedule[times - 1] ?? 5000;
    },
  });

  redis.on('error', (err: Error) => logger.error({ err }, 'Redis error'));

  const prefix = env.REDIS_KEY_PREFIX;
  const k = (key: string) => `${prefix}${key}`;

  const guardClosed = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (failures.shouldFailRedis()) {
      throw new ServiceUnavailableError('Simulated Redis failure');
    }
    return fn();
  };

  // Fail-open catalog cache (separate from fail-closed idempotency/rate-limit)
  const cache = createRedisCacheStore(redis, prefix, logger, failures);

  const idempotency: IdempotencyStore = {
    async get(key: string): Promise<IdempotencyRecord | null> {
      return guardClosed(async () => {
        const raw = await redis.get(k(`idem:${key}`));
        return raw ? (JSON.parse(raw) as IdempotencyRecord) : null;
      });
    },

    async begin(key: string, requestHash: string, ttlSeconds: number) {
      return guardClosed(async () => {
        const fullKey = k(`idem:${key}`);
        const inflight = JSON.stringify({
          key,
          requestHash,
          status: 'in_progress',
          createdAt: new Date().toISOString(),
        });
        const set = await redis.set(fullKey, inflight, 'EX', ttlSeconds, 'NX');
        if (set === 'OK') return 'acquired';

        const existingRaw = await redis.get(fullKey);
        if (!existingRaw) return 'acquired';
        const existing = JSON.parse(existingRaw) as IdempotencyRecord & { status?: string };
        if (existing.status === 'in_progress') return 'in_progress';
        return 'completed';
      });
    },

    async complete(key: string, record: Omit<IdempotencyRecord, 'key'>, ttlSeconds: number) {
      await guardClosed(async () => {
        const payload: IdempotencyRecord = { key, ...record };
        await redis.set(k(`idem:${key}`), JSON.stringify(payload), 'EX', ttlSeconds);
      });
    },
  };

  const rateLimiter: RateLimiter = {
    async consume(key, limit, windowMs) {
      return guardClosed(async () => {
        const bucket = Math.floor(Date.now() / windowMs);
        const redisKey = k(`rl:${key}:${bucket}`);
        const count = await redis.incr(redisKey);
        if (count === 1) {
          await redis.pexpire(redisKey, windowMs);
        }
        const ttl = await redis.pttl(redisKey);
        const remaining = Math.max(0, limit - count);
        return {
          allowed: count <= limit,
          remaining,
          resetMs: ttl > 0 ? ttl : windowMs,
        };
      });
    },
  };

  return {
    redis,
    cache,
    idempotency,
    rateLimiter,
    close: async () => {
      await redis.quit();
      logger.info('Redis connection closed');
    },
  };
}
