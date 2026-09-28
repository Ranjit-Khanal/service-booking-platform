export class ServiceOffering {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly description: string,
    readonly durationMinutes: number,
    readonly priceCents: number,
    readonly currency: string,
    readonly active: boolean,
  ) {}
}

export type SlotStatus = 'open' | 'held' | 'booked';

export class TimeSlot {
  constructor(
    readonly id: string,
    readonly serviceId: string,
    readonly startsAt: Date,
    readonly endsAt: Date,
    private _status: SlotStatus,
    private _version: number,
  ) {}

  get status(): SlotStatus {
    return this._status;
  }

  get version(): number {
    return this._version;
  }

  static rehydrate(row: {
    id: string;
    serviceId: string;
    startsAt: Date;
    endsAt: Date;
    status: SlotStatus;
    version: number;
  }): TimeSlot {
    return new TimeSlot(
      row.id,
      row.serviceId,
      row.startsAt,
      row.endsAt,
      row.status,
      row.version,
    );
  }

  markBooked(): void {
    if (this._status !== 'open' && this._status !== 'held') {
      throw new Error('Slot is not available');
    }
    this._status = 'booked';
    this._version += 1;
  }
}
