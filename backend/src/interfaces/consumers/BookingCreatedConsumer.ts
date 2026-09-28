// SPDX-License-Identifier: AGPL-3.0-only
import type { ConsumeMessage } from 'amqplib';
import type {
  BookingCreatedEvent,
  DomainEvent,
  NotificationSender,
} from '../../domain/services/EventPublisher.js';
import type { Logger } from '../../shared/logger/logger.js';
import type { Messaging } from '../../infrastructure/messaging/rabbitmq.js';

/**
 * Queue-side counterpart to an HTTP controller.
 *
 * HTTP:  Request  → Controller → Use Case
 * AMQP:  Message  → Consumer  → NotificationSender
 *
 * Lives in interfaces/ so transport concerns (parse event, ack/retry/DLQ)
 * stay out of application/domain. Side effects go through NotificationSender.
 */
export class BookingCreatedConsumer {
  constructor(
    private readonly notifications: NotificationSender,
    private readonly logger: Logger,
  ) {}

  handle = async (event: DomainEvent, _msg: ConsumeMessage): Promise<void> => {
    if (event.type !== 'booking.created') {
      this.logger.warn({ type: (event as { type?: string }).type }, 'Ignoring unexpected event type');
      return;
    }

    const e = event as BookingCreatedEvent;
    const log = this.logger.child({
      correlationId: e.correlationId,
      bookingId: e.bookingId,
      consumer: 'BookingCreatedConsumer',
    });

    log.info('Processing booking.created');
    await this.notifications.sendBookingConfirmation({
      to: e.customerEmail,
      customerName: e.customerName,
      bookingId: e.bookingId,
      correlationId: e.correlationId,
    });
    log.info('booking.created processed');
  };
}

/**
 * Binds the consumer to RabbitMQ with ack / retry / DLQ semantics.
 * Transport details stay in infrastructure; this is the interfaces wiring helper.
 */
export async function bindBookingCreatedConsumer(opts: {
  messaging: Messaging;
  queue: string;
  consumer: BookingCreatedConsumer;
  logger: Logger;
  maxRetries?: number;
}): Promise<() => Promise<void>> {
  const { messaging, queue, consumer, logger } = opts;
  const maxRetries = opts.maxRetries ?? 3;
  const { channel } = messaging;

  const { consumerTag } = await channel.consume(queue, async (msg) => {
    if (!msg) return;

    const correlationId = String(msg.properties.headers?.correlationId ?? 'unknown');
    const log = logger.child({ correlationId, consumer: 'notifications' });

    try {
      const event = JSON.parse(msg.content.toString('utf8')) as DomainEvent;
      await consumer.handle(event, msg);
      channel.ack(msg);
    } catch (error) {
      const retries = Number(msg.properties.headers?.['x-retry'] ?? 0);
      log.error({ err: error, retries }, 'Notification consumer failed');

      if (retries >= maxRetries) {
        // Reject without requeue → dead-letter queue
        channel.nack(msg, false, false);
        return;
      }

      // Ack original, republish with incremented retry (avoids infinite unacked loop)
      channel.ack(msg);
      channel.sendToQueue(queue, msg.content, {
        contentType: msg.properties.contentType,
        deliveryMode: msg.properties.deliveryMode,
        messageId: msg.properties.messageId,
        headers: {
          ...msg.properties.headers,
          'x-retry': retries + 1,
          correlationId,
        },
      });
    }
  });

  return async () => {
    await channel.cancel(consumerTag);
  };
}
