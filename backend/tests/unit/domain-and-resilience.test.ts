import { describe, expect, it } from 'vitest';
import { Booking } from '../../src/domain/entities/Booking.js';
import { withRetry } from '../../src/infrastructure/resilience/retry.js';
import { CircuitBreaker } from '../../src/infrastructure/resilience/CircuitBreaker.js';

describe('Booking entity', () => {
  it('transitions pending → confirmed', () => {
    const booking = Booking.create({
      id: 'b1',
      serviceId: 's1',
      slotId: 'slot1',
      customerName: 'Ada',
      customerEmail: 'ada@example.com',
      amountCents: 1000,
      currency: 'USD',
      idempotencyKey: 'k1',
    });
    expect(booking.status).toBe('pending_payment');
    booking.confirm('pay_1');
    expect(booking.status).toBe('confirmed');
    expect(booking.paymentReference).toBe('pay_1');
  });

  it('rejects confirm after failed', () => {
    const booking = Booking.create({
      id: 'b2',
      serviceId: 's1',
      slotId: 'slot1',
      customerName: 'Ada',
      customerEmail: 'ada@example.com',
      amountCents: 1000,
      currency: 'USD',
      idempotencyKey: 'k2',
    });
    booking.markFailed();
    expect(() => booking.confirm('x')).toThrow();
  });
});

describe('withRetry', () => {
  it('retries retryable failures then succeeds', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('transient');
        return 'ok';
      },
      {
        maxAttempts: 5,
        baseDelayMs: 1,
        maxDelayMs: 5,
        isRetryable: () => true,
        sleep: async () => undefined,
      },
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('does not retry forever', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new Error('always');
        },
        {
          maxAttempts: 3,
          baseDelayMs: 1,
          maxDelayMs: 5,
          isRetryable: () => true,
          sleep: async () => undefined,
        },
      ),
    ).rejects.toThrow('always');
    expect(attempts).toBe(3);
  });
});

describe('CircuitBreaker', () => {
  it('opens after consecutive failures', async () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 2,
      resetTimeoutMs: 1000,
      now: () => now,
    });

    await expect(breaker.exec(async () => { throw new Error('x'); })).rejects.toThrow();
    await expect(breaker.exec(async () => { throw new Error('x'); })).rejects.toThrow();
    expect(breaker.getState()).toBe('open');
    await expect(breaker.exec(async () => 'ok')).rejects.toThrow(/Circuit open/);

    now = 1001;
    expect(breaker.getState()).toBe('half_open');
    await expect(breaker.exec(async () => 'ok')).resolves.toBe('ok');
    expect(breaker.getState()).toBe('closed');
  });
});
