// SPDX-License-Identifier: AGPL-3.0-only
export type Money = {
  readonly amountCents: number;
  readonly currency: string;
};

export function money(amountCents: number, currency = 'USD'): Money {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error('amountCents must be a non-negative integer');
  }
  return Object.freeze({ amountCents, currency });
}

export function formatMoney(m: Money): string {
  return `${(m.amountCents / 100).toFixed(2)} ${m.currency}`;
}
