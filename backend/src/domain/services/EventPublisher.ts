export type BookingCreatedEvent = {
  type: 'booking.created';
  bookingId: string;
  serviceId: string;
  slotId: string;
  customerEmail: string;
  customerName: string;
  amountCents: number;
  currency: string;
  occurredAt: string;
  correlationId: string;
};

export type DomainEvent = BookingCreatedEvent;

export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
}

export interface NotificationSender {
  sendBookingConfirmation(input: {
    to: string;
    customerName: string;
    bookingId: string;
    correlationId: string;
  }): Promise<void>;
}
