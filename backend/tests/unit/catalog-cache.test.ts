// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { CatalogCache } from '../../src/application/services/CatalogCache.js';
import { ServiceOffering, TimeSlot } from '../../src/domain/entities/ServiceOffering.js';
import type { CacheStore } from '../../src/domain/repositories/InfrastructurePorts.js';
import { createCacheMetrics } from '../../src/infrastructure/cache/CachePolicy.js';
import pino from 'pino';

function memoryCache(): CacheStore & { store: Map<string, { value: unknown; exp: number }> } {
  const store = new Map<string, { value: unknown; exp: number }>();
  return {
    store,
    async get<T>(key: string) {
      const row = store.get(key);
      if (!row || row.exp < Date.now()) {
        store.delete(key);
        return null;
      }
      return row.value as T;
    },
    async set<T>(key: string, value: T, ttlSeconds: number) {
      store.set(key, { value, exp: Date.now() + ttlSeconds * 1000 });
    },
    async del(key: string) {
      store.delete(key);
    },
    async delByPrefix(prefix: string) {
      let n = 0;
      for (const key of [...store.keys()]) {
        if (key.startsWith(prefix)) {
          store.delete(key);
          n += 1;
        }
      }
      return n;
    },
    async getOrSet<T>(key, ttlSeconds, loader) {
      const hit = await this.get<T>(key);
      if (hit !== null) return { value: hit, source: 'hit' as const };
      const value = await loader();
      await this.set(key, value, ttlSeconds);
      return { value, source: 'miss' as const };
    },
  };
}

describe('CatalogCache', () => {
  it('cache-aside: second listActive call is a hit', async () => {
    const cache = memoryCache();
    const catalog = new CatalogCache(cache, pino({ level: 'silent' }), createCacheMetrics());
    const loader = vi.fn(async () => [
      new ServiceOffering('1', 'Cut', 'd', 45, 1000, 'USD', true),
    ]);

    await catalog.getActiveServices(loader);
    await catalog.getActiveServices(loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(catalog.getMetrics().hits).toBe(1);
    expect(catalog.getMetrics().misses).toBe(1);
  });

  it('invalidates slot keys after booking inventory changes', async () => {
    const cache = memoryCache();
    const catalog = new CatalogCache(cache, pino({ level: 'silent' }), createCacheMetrics());
    const starts = new Date('2030-01-02T10:00:00Z');
    const loader = vi.fn(async () => [
      TimeSlot.rehydrate({
        id: 's1',
        serviceId: 'svc',
        startsAt: starts,
        endsAt: new Date('2030-01-02T11:00:00Z'),
        status: 'open',
        version: 1,
      }),
    ]);

    await catalog.getOpenSlots('svc', '2030-01-02', loader);
    expect(loader).toHaveBeenCalledTimes(1);

    await catalog.invalidateSlots('svc', starts);
    await catalog.getOpenSlots('svc', '2030-01-02', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
