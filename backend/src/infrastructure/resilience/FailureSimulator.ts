import type { FailureFlags } from '../../shared/types/FailureFlags.js';

/**
 * In-process failure injection for resilience demos.
 * Mutable at runtime via admin API so ops can flip switches without redeploy.
 */
export class FailureSimulator {
  private flags: FailureFlags;

  constructor(initial: FailureFlags) {
    this.flags = { ...initial };
  }

  get(): FailureFlags {
    return { ...this.flags };
  }

  set(partial: Partial<FailureFlags>): FailureFlags {
    this.flags = { ...this.flags, ...partial };
    return this.get();
  }

  shouldFailPayment(): boolean {
    return this.flags.failPayment;
  }

  shouldFailRedis(): boolean {
    return this.flags.failRedis;
  }

  shouldFailDatabase(): boolean {
    return this.flags.failDatabase;
  }

  shouldFailBrokerPublish(): boolean {
    return this.flags.failBrokerPublish;
  }

  paymentLatencyMs(): number {
    return this.flags.paymentLatencyMs;
  }
}
