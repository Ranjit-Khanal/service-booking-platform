export type CircuitState = 'closed' | 'open' | 'half_open';

export type CircuitBreakerOptions = {
  failureThreshold: number;
  resetTimeoutMs: number;
  name: string;
  now?: () => number;
};

/**
 * Circuit breaker — Ch8 "Circuit Breaker Pattern".
 * After consecutive failures, short-circuit calls until reset timeout elapses.
 */
export class CircuitBreaker {
  private failures = 0;
  private state: CircuitState = 'closed';
  private openedAt = 0;
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? Date.now;
  }

  getState(): CircuitState {
    this.maybeHalfOpen();
    return this.state;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeHalfOpen();
    if (this.state === 'open') {
      throw new Error(`Circuit open for ${this.options.name}`);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private maybeHalfOpen(): void {
    if (this.state === 'open' && this.now() - this.openedAt >= this.options.resetTimeoutMs) {
      this.state = 'half_open';
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failures += 1;
    if (this.state === 'half_open' || this.failures >= this.options.failureThreshold) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }
}
