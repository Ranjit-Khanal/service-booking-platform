// SPDX-License-Identifier: AGPL-3.0-only
import type { CacheStore } from '../../domain/repositories/InfrastructurePorts.js';
import type { ServiceOffering, TimeSlot } from '../../domain/entities/ServiceOffering.js';
import { ServiceOffering as ServiceEntity, TimeSlot as TimeSlotEntity } from '../../domain/entities/ServiceOffering.js';
import { CacheKeys, CacheTtl, type CacheMetrics } from '../../infrastructure/cache/CachePolicy.js';
import type { Logger } from '../../shared/logger/logger.js';

type CachedService = {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceCents: number;
  currency: string;
  active: boolean;
};

type CachedSlot = {
  id: string;
  serviceId: string;
  startsAt: string;
  endsAt: string;
  status: TimeSlot['status'];
  version: number;
};

function toCachedService(s: ServiceOffering): CachedService {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    durationMinutes: s.durationMinutes,
    priceCents: s.priceCents,
    currency: s.currency,
    active: s.active,
  };
}

function fromCachedService(s: CachedService): ServiceOffering {
  return new ServiceEntity(
    s.id,
    s.name,
    s.description,
    s.durationMinutes,
    s.priceCents,
    s.currency,
    s.active,
  );
}

function toCachedSlot(s: TimeSlot): CachedSlot {
  return {
    id: s.id,
    serviceId: s.serviceId,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    status: s.status,
    version: s.version,
  };
}

function fromCachedSlot(s: CachedSlot): TimeSlot {
  return TimeSlotEntity.rehydrate({
    id: s.id,
    serviceId: s.serviceId,
    startsAt: new Date(s.startsAt),
    endsAt: new Date(s.endsAt),
    status: s.status,
    version: s.version,
  });
}

/**
 * Catalog cache facade — use cases depend on this, not raw Redis keys.
 */
export class CatalogCache {
  constructor(
    private readonly cache: CacheStore,
    private readonly logger: Logger,
    private readonly metrics: CacheMetrics,
  ) {}

  getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  async getActiveServices(loader: () => Promise<ServiceOffering[]>): Promise<ServiceOffering[]> {
    const result = await this.cache.getOrSet(
      CacheKeys.servicesActive(),
      CacheTtl.servicesListSeconds,
      async () => (await loader()).map(toCachedService),
    );
    this.record(result.source);
    this.logger.debug({ source: result.source, key: CacheKeys.servicesActive() }, 'catalog cache');
    return result.value.map(fromCachedService);
  }

  async getService(
    id: string,
    loader: () => Promise<ServiceOffering | null>,
  ): Promise<ServiceOffering | null> {
    const key = CacheKeys.service(id);
    const cached = await this.cache.get<CachedService>(key);
    if (cached) {
      this.metrics.hits += 1;
      return fromCachedService(cached);
    }

    const service = await loader();
    this.metrics.misses += 1;
    // Only positive-cache; avoid caching "not found" forever across instances.
    if (service) {
      await this.cache.set(key, toCachedService(service), CacheTtl.serviceDetailSeconds);
    }
    return service;
  }

  async getOpenSlots(
    serviceId: string,
    dateIso: string,
    loader: () => Promise<TimeSlot[]>,
  ): Promise<TimeSlot[]> {
    const key = CacheKeys.slots(serviceId, dateIso);
    const result = await this.cache.getOrSet(
      key,
      CacheTtl.openSlotsSeconds,
      async () => (await loader()).map(toCachedSlot),
    );
    this.record(result.source);
    this.logger.debug({ source: result.source, key }, 'slots cache');
    return result.value.map(fromCachedSlot);
  }

  /** After a slot is claimed/released, drop that day's slot list (+ service day prefix). */
  async invalidateSlots(serviceId: string, startsAt: Date): Promise<void> {
    const dateIso = startsAt.toISOString().slice(0, 10);
    await this.cache.del(CacheKeys.slots(serviceId, dateIso));
    // Defensive: clear any other day keys for this service if clocks skew
    const n = await this.cache.delByPrefix(CacheKeys.slotsPrefix(serviceId));
    this.metrics.invalidations += 1 + n;
    this.logger.info({ serviceId, dateIso, removed: n }, 'Invalidated slot cache');
  }

  async invalidateCatalog(): Promise<void> {
    const n = await this.cache.delByPrefix(CacheKeys.catalogPrefix());
    this.metrics.invalidations += n;
    this.logger.info({ removed: n }, 'Invalidated full catalog cache');
  }

  private record(source: 'hit' | 'miss' | 'hit-after-wait' | 'bypass'): void {
    if (source === 'hit' || source === 'hit-after-wait') this.metrics.hits += 1;
    else if (source === 'miss') this.metrics.misses += 1;
    else this.metrics.bypasses += 1;
  }
}
