// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true');

const envSchema = z
  .object({
    // SERVER
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    INSTANCE_ID: z.string().default('api-local'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /** Express `trust proxy`: "false", "true", a hop count ("1"), or a subnet list. */
    TRUST_PROXY: z.string().default('false'),
    CORS_ORIGINS: z.string().default('*'),

    // DATABASE
    DATABASE_URL: z.string().min(1),
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),

    // REDIS
    REDIS_URL: z.string().min(1),
    REDIS_KEY_PREFIX: z.string().default('slotbook:'),

    // MESSAGE_BROKER
    RABBITMQ_URL: z.string().min(1),
    BOOKING_EVENTS_EXCHANGE: z.string().default('booking.events'),
    NOTIFICATION_QUEUE: z.string().default('notifications'),
    NOTIFICATION_DLQ: z.string().default('notifications.dlq'),

    // AUTH
    /** `api_key`: every /api route except /api/health needs a key from API_KEYS. `none`: open. */
    AUTH_MODE: z.enum(['api_key', 'none']).default('api_key'),
    API_KEYS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      ),
    /** Unset → /api/admin/* is disabled (404). */
    ADMIN_API_KEY: z.string().optional(),

    // RATE LIMITING
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),

    // BOOKING / PAYMENT
    PAYMENT_PROVIDER: z.enum(['mock', 'stripe', 'esewa']).default('mock'),
    PAYMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
    PAYMENT_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
    IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),

    // FAILURE SIMULATION (demo only)
    FAIL_PAYMENT: bool,
    FAIL_REDIS: bool,
    FAIL_DATABASE: bool,
    FAIL_BROKER_PUBLISH: bool,
    PAYMENT_LATENCY_MS: z.coerce.number().int().nonnegative().default(0),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === 'api_key' && env.API_KEYS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['API_KEYS'],
        message: 'required when AUTH_MODE=api_key (comma-separated list), or set AUTH_MODE=none',
      });
    }
    if (env.ADMIN_API_KEY !== undefined && env.ADMIN_API_KEY.length < 16) {
      ctx.addIssue({
        code: 'custom',
        path: ['ADMIN_API_KEY'],
        message: 'must be at least 16 characters (leave unset to disable admin routes)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const input = { ...raw };
  // Treat `ADMIN_API_KEY=` (empty) as unset so .env templates can leave it blank.
  if (input.ADMIN_API_KEY === '') delete input.ADMIN_API_KEY;

  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}

/** Parse TRUST_PROXY into the value Express expects. */
export function trustProxyValue(raw: string): boolean | number | string {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}
