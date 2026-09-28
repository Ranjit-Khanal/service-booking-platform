// SPDX-License-Identifier: AGPL-3.0-only
import type { BookingRepository } from '../../domain/repositories/BookingRepository.js';
import type { ServiceRepository } from '../../domain/repositories/ServiceRepository.js';
import { NotFoundError } from '../../shared/errors/AppError.js';
import type { ServiceOffering, TimeSlot } from '../../domain/entities/ServiceOffering.js';
import type { Booking } from '../../domain/entities/Booking.js';
import type { CatalogCache } from '../services/CatalogCache.js';

export class ListServicesUseCase {
  constructor(
    private readonly services: ServiceRepository,
    private readonly catalogCache: CatalogCache,
  ) {}

  async execute(): Promise<ServiceOffering[]> {
    return this.catalogCache.getActiveServices(() => this.services.listActive());
  }
}

export class GetServiceUseCase {
  constructor(
    private readonly services: ServiceRepository,
    private readonly catalogCache: CatalogCache,
  ) {}

  async execute(id: string): Promise<ServiceOffering> {
    const service = await this.catalogCache.getService(id, () => this.services.findById(id));
    if (!service) throw new NotFoundError('Service not found');
    return service;
  }
}

export class ListSlotsUseCase {
  constructor(
    private readonly services: ServiceRepository,
    private readonly catalogCache: CatalogCache,
  ) {}

  async execute(serviceId: string, dateIso: string): Promise<TimeSlot[]> {
    const day = new Date(`${dateIso}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime())) {
      throw new NotFoundError('Invalid date');
    }
    const service = await this.catalogCache.getService(serviceId, () =>
      this.services.findById(serviceId),
    );
    if (!service) throw new NotFoundError('Service not found');

    const from = day;
    const to = new Date(day);
    to.setUTCDate(to.getUTCDate() + 1);

    return this.catalogCache.getOpenSlots(serviceId, dateIso, () =>
      this.services.listOpenSlots(serviceId, from, to),
    );
  }
}

export class GetBookingUseCase {
  constructor(private readonly bookings: BookingRepository) {}

  async execute(id: string): Promise<Booking> {
    // Intentionally uncached — bookings are authoritative user state.
    const booking = await this.bookings.findById(id);
    if (!booking) throw new NotFoundError('Booking not found');
    return booking;
  }
}

export class ListBookingsByEmailUseCase {
  constructor(private readonly bookings: BookingRepository) {}

  async execute(email: string): Promise<Booking[]> {
    return this.bookings.findByEmail(email.trim().toLowerCase());
  }
}
