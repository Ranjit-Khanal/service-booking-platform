// SPDX-License-Identifier: AGPL-3.0-only
import type { ChargeInput, PaymentProvider, PaymentResult } from '../../domain/services/PaymentProvider.js';
import type { FailureSimulator } from '../resilience/FailureSimulator.js';
import type { Logger } from '../../shared/logger/logger.js';
import { randomUUID } from 'node:crypto';

/**
 * Strategy/Adapter pattern: application depends on PaymentProvider,
 * not on Stripe/eSewa/Mock. Swap via composition root.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  constructor(
    private readonly failures: FailureSimulator,
    private readonly logger: Logger,
  ) {}

  async charge(input: ChargeInput): Promise<PaymentResult> {
    const log = this.logger.child({
      correlationId: input.correlationId,
      provider: this.name,
      bookingId: input.bookingId,
    });

    const latency = this.failures.paymentLatencyMs();
    if (latency > 0) {
      await new Promise((r) => setTimeout(r, latency));
    }

    if (this.failures.shouldFailPayment()) {
      log.warn('Simulated payment failure');
      return {
        success: false,
        retryable: true,
        code: 'SIMULATED_FAILURE',
        message: 'Simulated payment provider failure',
      };
    }

    const reference = `mock_${randomUUID()}`;
    log.info({ reference, amountCents: input.amountCents }, 'Payment charged');
    return { success: true, reference, provider: this.name };
  }
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';

  constructor(private readonly logger: Logger) {}

  async charge(input: ChargeInput): Promise<PaymentResult> {
    // Adapter stub — real Stripe SDK would live here.
    this.logger.info(
      { correlationId: input.correlationId, bookingId: input.bookingId },
      'Stripe adapter stub charging',
    );
    return {
      success: true,
      reference: `stripe_${randomUUID()}`,
      provider: this.name,
    };
  }
}

export class EsewaPaymentProvider implements PaymentProvider {
  readonly name = 'esewa';

  constructor(private readonly logger: Logger) {}

  async charge(input: ChargeInput): Promise<PaymentResult> {
    this.logger.info(
      { correlationId: input.correlationId, bookingId: input.bookingId },
      'eSewa adapter stub charging',
    );
    return {
      success: true,
      reference: `esewa_${randomUUID()}`,
      provider: this.name,
    };
  }
}

export function createPaymentProvider(
  name: 'mock' | 'stripe' | 'esewa',
  failures: FailureSimulator,
  logger: Logger,
): PaymentProvider {
  switch (name) {
    case 'stripe':
      return new StripePaymentProvider(logger);
    case 'esewa':
      return new EsewaPaymentProvider(logger);
    default:
      return new MockPaymentProvider(failures, logger);
  }
}
