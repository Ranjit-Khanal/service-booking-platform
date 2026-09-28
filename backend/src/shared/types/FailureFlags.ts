// SPDX-License-Identifier: AGPL-3.0-only
export type FailureFlags = {
  failPayment: boolean;
  failRedis: boolean;
  failDatabase: boolean;
  failBrokerPublish: boolean;
  paymentLatencyMs: number;
};
