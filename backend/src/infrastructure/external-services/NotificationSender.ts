// SPDX-License-Identifier: AGPL-3.0-only
import type { NotificationSender } from '../../domain/services/EventPublisher.js';
import type { Logger } from '../../shared/logger/logger.js';
import type { Db } from '../database/pool.js';

/**
 * Idempotent consumer side-effect: processed_events table prevents duplicate emails
 * when RabbitMQ redelivers (at-least-once).
 */
export class LoggingNotificationSender implements NotificationSender {
  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
  ) {}

  async sendBookingConfirmation(input: {
    to: string;
    customerName: string;
    bookingId: string;
    correlationId: string;
  }): Promise<void> {
    const eventId = `booking.created:${input.bookingId}:email`;
    const inserted = await this.db.query(
      `INSERT INTO processed_events (event_id, correlation_id)
       VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [eventId, input.correlationId],
    );

    if (inserted.rowCount === 0) {
      this.logger.info(
        { bookingId: input.bookingId, correlationId: input.correlationId },
        'Duplicate notification suppressed (idempotent consumer)',
      );
      return;
    }

    // In production this would call SES/SendGrid/etc.
    this.logger.info(
      {
        to: input.to,
        customerName: input.customerName,
        bookingId: input.bookingId,
        correlationId: input.correlationId,
      },
      'EMAIL_SENT booking confirmation',
    );
  }
}
