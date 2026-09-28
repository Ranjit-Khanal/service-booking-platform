// SPDX-License-Identifier: AGPL-3.0-only
import type { ServiceOffering, TimeSlot } from '../entities/ServiceOffering.js';

export interface ServiceRepository {
  listActive(): Promise<ServiceOffering[]>;
  findById(id: string): Promise<ServiceOffering | null>;
  listOpenSlots(serviceId: string, from: Date, to: Date): Promise<TimeSlot[]>;
  findSlotById(slotId: string): Promise<TimeSlot | null>;

  /**
   * Atomically claim an open slot using row-level locking / optimistic version check.
   * Returns the updated slot, or null if unavailable.
   */
  claimSlot(slotId: string, expectedVersion?: number): Promise<TimeSlot | null>;

  releaseSlot(slotId: string): Promise<void>;
}
