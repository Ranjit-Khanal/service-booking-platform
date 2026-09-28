import { loadEnv } from '../config/env.js';
import { createLogger } from '../shared/logger/logger.js';
import { FailureSimulator } from '../infrastructure/resilience/FailureSimulator.js';
import { CircuitBreaker } from '../infrastructure/resilience/CircuitBreaker.js';
import { createDatabase } from '../infrastructure/database/pool.js';
import { createRedisStack } from '../infrastructure/redis/redis.js';
import { createMessaging } from '../infrastructure/messaging/rabbitmq.js';
import { PostgresBookingRepository } from '../infrastructure/repositories/PostgresBookingRepository.js';
import { PostgresServiceRepository } from '../infrastructure/repositories/PostgresServiceRepository.js';
import { createPaymentProvider } from '../infrastructure/external-services/PaymentProviders.js';
import { CatalogCache } from '../application/services/CatalogCache.js';
import { createCacheMetrics } from '../infrastructure/cache/CachePolicy.js';
import { CreateBookingUseCase } from '../application/use-cases/CreateBookingUseCase.js';
import {
  GetBookingUseCase,
  GetServiceUseCase,
  ListBookingsByEmailUseCase,
  ListServicesUseCase,
  ListSlotsUseCase,
} from '../application/use-cases/QueryUseCases.js';
import {
  AdminController,
  BookingController,
  CatalogController,
} from '../interfaces/http/controllers/controllers.js';
import { createHttpApp } from '../interfaces/http/createHttpApp.js';

/**
 * Manual composition root (preferred DI style for this project).
 *
 * Controllers → Use Cases → Repository/Port interfaces → Postgres/Redis/Rabbit adapters
 *
 * Tradeoff vs DI container:
 * + Explicit, easy to navigate, no magic, great for interviews
 * - Becomes verbose as the graph grows; a lightweight container can help later
 */
export async function buildApp() {
  const env = loadEnv();
  const logger = createLogger(env);

  const failures = new FailureSimulator({
    failPayment: Boolean(env.FAIL_PAYMENT),
    failRedis: Boolean(env.FAIL_REDIS),
    failDatabase: Boolean(env.FAIL_DATABASE),
    failBrokerPublish: Boolean(env.FAIL_BROKER_PUBLISH),
    paymentLatencyMs: env.PAYMENT_LATENCY_MS,
  });

  const db = createDatabase(env, logger, failures);
  const redisStack = createRedisStack(env, logger, failures);
  const messaging = await createMessaging(env, logger, failures);

  const bookingRepo = new PostgresBookingRepository(db);
  const serviceRepo = new PostgresServiceRepository(db);
  const payments = createPaymentProvider(env.PAYMENT_PROVIDER, failures, logger);
  const paymentCircuit = new CircuitBreaker({
    name: 'payment',
    failureThreshold: 5,
    resetTimeoutMs: 15_000,
  });

  const cacheMetrics = createCacheMetrics();
  const catalogCache = new CatalogCache(redisStack.cache, logger, cacheMetrics);

  const createBooking = new CreateBookingUseCase({
    bookings: bookingRepo,
    services: serviceRepo,
    payments,
    events: messaging.publisher,
    idempotency: redisStack.idempotency,
    paymentCircuit,
    catalogCache,
    logger,
    idempotencyTtlSeconds: env.IDEMPOTENCY_TTL_SECONDS,
    paymentTimeoutMs: env.PAYMENT_TIMEOUT_MS,
    paymentMaxRetries: env.PAYMENT_MAX_RETRIES,
  });

  const listServices = new ListServicesUseCase(serviceRepo, catalogCache);
  const getService = new GetServiceUseCase(serviceRepo, catalogCache);
  const listSlots = new ListSlotsUseCase(serviceRepo, catalogCache);
  const getBooking = new GetBookingUseCase(bookingRepo);
  const listByEmail = new ListBookingsByEmailUseCase(bookingRepo);

  const bookingController = new BookingController(createBooking);
  const catalogController = new CatalogController(
    listServices,
    getService,
    listSlots,
    getBooking,
    listByEmail,
  );
  const adminController = new AdminController(
    failures,
    paymentCircuit,
    env,
    db,
    redisStack.redis,
    catalogCache,
  );

  const app = createHttpApp({
    env,
    logger,
    rateLimiter: redisStack.rateLimiter,
    bookings: bookingController,
    catalog: catalogController,
    admin: adminController,
  });

  return {
    app,
    env,
    logger,
    db,
    redisStack,
    messaging,
    failures,
    paymentCircuit,
  };
}
