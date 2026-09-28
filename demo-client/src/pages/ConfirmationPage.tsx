// SPDX-License-Identifier: AGPL-3.0-only
import { Link, useLocation } from 'react-router-dom';
import type { Booking } from '@/api/types';
import { formatDateTime } from '@/utils/format';
import { mediaForService } from '@/data/catalogMedia';

type ConfirmationState = {
  booking?: Booking;
  idempotencyKey?: string;
};

export function ConfirmationPage() {
  const location = useLocation();
  const state = (location.state ?? {}) as ConfirmationState;
  const booking = state.booking;
  const media = mediaForService(booking?.serviceName ?? '');

  if (!booking) {
    return (
      <div className="page-enter">
        <h1 className="section-title">Confirmation</h1>
        <p className="muted">No booking details in this session.</p>
        <Link to="/services" className="btn" style={{ marginTop: '1rem' }}>
          Browse services
        </Link>
      </div>
    );
  }

  const when = booking.startsAt;

  return (
    <div className="page-enter confirm-layout">
      <img className="confirm-layout__image" src={media.imageUrl} alt="" />
      <div>
        <div className="alert alert--success">
          <h1 className="section-title" style={{ marginTop: 0 }}>
            Booking confirmed
          </h1>
          <p style={{ marginBottom: 0 }}>
            Thanks{booking.customerName ? `, ${booking.customerName}` : ''}. Your reservation is locked
            in SlotBook.
          </p>
        </div>

        <dl className="confirm-dl">
          <div>
            <dt>Confirmation ID</dt>
            <dd>{booking.id}</dd>
          </div>
          {booking.serviceName && (
            <div>
              <dt>Service</dt>
              <dd>{booking.serviceName}</dd>
            </div>
          )}
          {when && (
            <div>
              <dt>When</dt>
              <dd>{formatDateTime(when)}</dd>
            </div>
          )}
          <div>
            <dt>Email</dt>
            <dd>{booking.customerEmail}</dd>
          </div>
          {booking.status && (
            <div>
              <dt>Status</dt>
              <dd>
                <span className="status-pill status-pill--ok">{booking.status}</span>
              </dd>
            </div>
          )}
        </dl>

        {state.idempotencyKey && (
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Idempotency key: <code>{state.idempotencyKey}</code>
          </p>
        )}

        <div className="hero-bleed__actions" style={{ marginTop: '1.5rem' }}>
          <Link to="/my-bookings" className="btn">
            View my bookings
          </Link>
          <Link to="/services" className="btn btn--secondary">
            Book another
          </Link>
        </div>
      </div>
    </div>
  );
}
