// SPDX-License-Identifier: AGPL-3.0-only
import { loadEnv } from './config/env.js';
import { createLogger } from './shared/logger/logger.js';
import { FailureSimulator } from './infrastructure/resilience/FailureSimulator.js';
import { createDatabase } from './infrastructure/database/pool.js';
import { createMessaging } from './infrastructure/messaging/rabbitmq.js';
import { LoggingNotificationSender } from './infrastructure/external-services/NotificationSender.js';
import {
  BookingCreatedConsumer,
  bindBookingCreatedConsumer,
} from './interfaces/consumers/BookingCreatedConsumer.js';

/**
 * Notification worker process — composition root for the consumer path.
 * Scales independently from HTTP API instances.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({ ...env, INSTANCE_ID: `${env.INSTANCE_ID}-worker` });
  const failures = new FailureSimulator({
    failPayment: false,
    failRedis: false,
    failDatabase: false,
    failBrokerPublish: false,
    paymentLatencyMs: 0,
  });

  const db = createDatabase(env, logger, failures);
  const messaging = await createMessaging(env, logger, failures, () => {
    process.kill(process.pid, 'SIGTERM');
  });
  const notifications = new LoggingNotificationSender(db, logger);
  const consumer = new BookingCreatedConsumer(notifications, logger);

  const stop = await bindBookingCreatedConsumer({
    messaging,
    queue: env.NOTIFICATION_QUEUE,
    consumer,
    logger,
  });

  logger.info({ queue: env.NOTIFICATION_QUEUE }, 'Notification worker started');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Worker shutting down');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    try {
      await stop().catch(() => undefined); // channel may already be gone
      await messaging.close();
      await db.close();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during worker shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
