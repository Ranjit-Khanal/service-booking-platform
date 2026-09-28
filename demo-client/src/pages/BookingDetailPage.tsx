// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchBooking } from '@/api/bookings';
import type { Booking } from '@/api/types';
import { ErrorAlert } from '@/components/ErrorAlert';
import { LoadingState } from '@/components/LoadingState';
import { formatDateTime, formatPrice } from '@/utils/format';

export function BookingDetailPage() {
  const { id = '' } = useParams();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchBooking(id)
      .then((b) => {
        if (!cancelled) setBooking(b);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Not found');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <LoadingState label="Loading booking…" />;
  if (error || !booking) {
    return (
      <div className="page-enter">
        <ErrorAlert message={error ?? 'Booking not found'} />
        <Link to="/my-bookings">Back</Link>
      </div>
    );
  }

  return (
    <div className="page-enter">
      <p className="hero__eyebrow">Booking</p>
      <h1 className="section-title">{booking.id}</h1>
      <dl className="confirm-dl">
        <div>
          <dt>Status</dt>
          <dd>
            <span className="status-pill">{booking.status}</span>
          </dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{booking.customerEmail}</dd>
        </div>
        {booking.customerName && (
          <div>
            <dt>Name</dt>
            <dd>{booking.customerName}</dd>
          </div>
        )}
        {booking.amountCents != null && (
          <div>
            <dt>Amount</dt>
            <dd>{formatPrice(booking.amountCents, booking.currency)}</dd>
          </div>
        )}
        {booking.createdAt && (
          <div>
            <dt>Created</dt>
            <dd>{formatDateTime(booking.createdAt)}</dd>
          </div>
        )}
        {booking.paymentReference && (
          <div>
            <dt>Payment</dt>
            <dd>{booking.paymentReference}</dd>
          </div>
        )}
      </dl>
      <Link to="/my-bookings" className="text-link">
        ← My bookings
      </Link>
    </div>
  );
}
