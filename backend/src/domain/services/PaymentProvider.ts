// SPDX-License-Identifier: AGPL-3.0-only
export type ChargeInput = {
  amountCents: number;
  currency: string;
  customerEmail: string;
  bookingId: string;
  idempotencyKey: string;
  correlationId: string;
};

export type PaymentResult = {
  success: true;
  reference: string;
  provider: string;
} | {
  success: false;
  retryable: boolean;
  code: string;
  message: string;
};

/**
 * Compile-time contract for payment gateways.
 * Erased at runtime — adapters implement this shape; DI wires the concrete class.
 */
export interface PaymentProvider {
  readonly name: string;
  charge(input: ChargeInput): Promise<PaymentResult>;
}
