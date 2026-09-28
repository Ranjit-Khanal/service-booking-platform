// SPDX-License-Identifier: AGPL-3.0-only
export type BookingStatus = 'pending_payment' | 'confirmed' | 'cancelled' | 'failed';

export class Booking {
  private constructor(
    readonly id: string,
    readonly serviceId: string,
    readonly slotId: string,
    readonly customerName: string,
    readonly customerEmail: string,
    readonly amountCents: number,
    readonly currency: string,
    private _status: BookingStatus,
    readonly idempotencyKey: string,
    private _paymentReference: string | null,
    readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  get status(): BookingStatus {
    return this._status;
  }

  get paymentReference(): string | null {
    return this._paymentReference;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  static create(input: {
    id: string;
    serviceId: string;
    slotId: string;
    customerName: string;
    customerEmail: string;
    amountCents: number;
    currency: string;
    idempotencyKey: string;
    now?: Date;
  }): Booking {
    const now = input.now ?? new Date();
    return new Booking(
      input.id,
      input.serviceId,
      input.slotId,
      input.customerName.trim(),
      input.customerEmail.trim().toLowerCase(),
      input.amountCents,
      input.currency,
      'pending_payment',
      input.idempotencyKey,
      null,
      now,
      now,
    );
  }

  static rehydrate(row: {
    id: string;
    serviceId: string;
    slotId: string;
    customerName: string;
    customerEmail: string;
    amountCents: number;
    currency: string;
    status: BookingStatus;
    idempotencyKey: string;
    paymentReference: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): Booking {
    return new Booking(
      row.id,
      row.serviceId,
      row.slotId,
      row.customerName,
      row.customerEmail,
      row.amountCents,
      row.currency,
      row.status,
      row.idempotencyKey,
      row.paymentReference,
      row.createdAt,
      row.updatedAt,
    );
  }

  confirm(paymentReference: string, now = new Date()): void {
    if (this._status !== 'pending_payment') {
      throw new Error(`Cannot confirm booking in status ${this._status}`);
    }
    this._status = 'confirmed';
    this._paymentReference = paymentReference;
    this._updatedAt = now;
  }

  markFailed(now = new Date()): void {
    if (this._status === 'confirmed') {
      throw new Error('Cannot fail a confirmed booking');
    }
    this._status = 'failed';
    this._updatedAt = now;
  }

  cancel(now = new Date()): void {
    if (this._status !== 'confirmed' && this._status !== 'pending_payment') {
      throw new Error(`Cannot cancel booking in status ${this._status}`);
    }
    this._status = 'cancelled';
    this._updatedAt = now;
  }
}
