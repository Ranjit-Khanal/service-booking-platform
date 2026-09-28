export type FailureFlags = {
  failPayment: boolean;
  failRedis: boolean;
  failDatabase: boolean;
  failBrokerPublish: boolean;
  paymentLatencyMs: number;
};
