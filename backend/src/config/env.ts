import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  INSTANCE_ID: z.string().default('api-local'),

  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  REDIS_URL: z.string().min(1),
  REDIS_KEY_PREFIX: z.string().default('slotbook:'),

  RABBITMQ_URL: z.string().min(1),
  BOOKING_EVENTS_EXCHANGE: z.string().default('booking.events'),
  NOTIFICATION_QUEUE: z.string().default('notifications'),
  NOTIFICATION_DLQ: z.string().default('notifications.dlq'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),

  PAYMENT_PROVIDER: z.enum(['mock', 'stripe', 'esewa']).default('mock'),
  PAYMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  PAYMENT_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),

  IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  FAIL_PAYMENT: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  FAIL_REDIS: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  FAIL_DATABASE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  FAIL_BROKER_PUBLISH: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  PAYMENT_LATENCY_MS: z.coerce.number().int().nonnegative().default(0),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}
