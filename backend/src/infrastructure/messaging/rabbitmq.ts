// SPDX-License-Identifier: AGPL-3.0-only
import amqp, { type Channel, type ChannelModel } from 'amqplib';
import type { Env } from '../../config/env.js';
import type { DomainEvent, EventPublisher } from '../../domain/services/EventPublisher.js';
import type { Logger } from '../../shared/logger/logger.js';
import type { FailureSimulator } from '../resilience/FailureSimulator.js';
import { ServiceUnavailableError } from '../../shared/errors/AppError.js';

export type Messaging = {
  publisher: EventPublisher;
  channel: Channel;
  connection: ChannelModel;
  close: () => Promise<void>;
  setupTopology: () => Promise<void>;
};

/**
 * RabbitMQ for async fan-out after booking confirmation.
 * Book focuses on HTTP resilience; messaging + DLQ is an industry extension
 * that still applies Ch8 idempotency + retry ideas at the consumer.
 */
export async function createMessaging(
  env: Pick<
    Env,
    'RABBITMQ_URL' | 'BOOKING_EVENTS_EXCHANGE' | 'NOTIFICATION_QUEUE' | 'NOTIFICATION_DLQ'
  >,
  logger: Logger,
  failures: FailureSimulator,
  /**
   * Called once if the broker connection or channel closes unexpectedly.
   * No in-process reconnect: the caller shuts down and the supervisor
   * (Compose `restart: unless-stopped`, Kubernetes) starts a fresh process.
   */
  onConnectionLost?: (reason: unknown) => void,
): Promise<Messaging> {
  const connection = await amqp.connect(env.RABBITMQ_URL);
  const channel = await connection.createChannel();

  let closing = false;
  let lostReported = false;
  const lost = (reason: unknown) => {
    if (closing || lostReported) return;
    lostReported = true;
    logger.error({ err: reason }, 'RabbitMQ connection lost');
    onConnectionLost?.(reason);
  };
  // Without these listeners an 'error' event is unhandled, and after a broker restart the
  // process keeps running with a dead channel (every publish then fails).
  connection.on('error', (err: unknown) => logger.error({ err }, 'RabbitMQ connection error'));
  connection.on('close', () => lost(new Error('RabbitMQ connection closed')));
  channel.on('error', (err: unknown) => logger.error({ err }, 'RabbitMQ channel error'));
  channel.on('close', () => lost(new Error('RabbitMQ channel closed')));

  const setupTopology = async (): Promise<void> => {
    await channel.assertExchange(env.BOOKING_EVENTS_EXCHANGE, 'topic', { durable: true });
    await channel.assertQueue(env.NOTIFICATION_DLQ, { durable: true });
    await channel.assertQueue(env.NOTIFICATION_QUEUE, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '',
        'x-dead-letter-routing-key': env.NOTIFICATION_DLQ,
      },
    });
    await channel.bindQueue(
      env.NOTIFICATION_QUEUE,
      env.BOOKING_EVENTS_EXCHANGE,
      'booking.created',
    );
    await channel.prefetch(10);
  };

  await setupTopology();

  const publisher: EventPublisher = {
    async publish(event: DomainEvent): Promise<void> {
      if (failures.shouldFailBrokerPublish()) {
        throw new ServiceUnavailableError('Simulated message broker publish failure');
      }
      const ok = channel.publish(
        env.BOOKING_EVENTS_EXCHANGE,
        event.type,
        Buffer.from(JSON.stringify(event)),
        {
          contentType: 'application/json',
          deliveryMode: 2,
          messageId: `${event.type}:${'bookingId' in event ? event.bookingId : 'unknown'}`,
          headers: {
            correlationId: event.correlationId,
          },
        },
      );
      if (!ok) {
        await new Promise<void>((resolve) => channel.once('drain', () => resolve()));
      }
      logger.info(
        { type: event.type, correlationId: event.correlationId },
        'Published domain event',
      );
    },
  };

  return {
    publisher,
    channel,
    connection,
    setupTopology,
    close: async () => {
      closing = true;
      await channel.close().catch(() => undefined);
      await connection.close().catch(() => undefined);
      logger.info('RabbitMQ connection closed');
    },
  };
}
