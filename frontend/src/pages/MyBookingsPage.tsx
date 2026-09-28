import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchBookingsByEmail } from '@/api/bookings';
import type { Booking } from '@/api/types';
import { ErrorAlert } from '@/components/ErrorAlert';
import { LoadingState } from '@/components/LoadingState';
import { formatDateTime, formatPrice } from '@/utils/format';

const EMAIL_KEY = 'slotbook.customerEmail';

export function MyBookingsPage() {
  const [email, setEmail] = useState(() => localStorage.getItem(EMAIL_KEY) ?? '');
  const [queryEmail, setQueryEmail] = useState<string | null>(null);
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setQueryEmail(trimmed);
    localStorage.setItem(EMAIL_KEY, trimmed);

    try {
      setBookings(await fetchBookingsByEmail(trimmed));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load bookings');
      setBookings(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-enter">
      <div className="section-head">
        <h1 className="section-title">My bookings</h1>
        <p className="muted">Look up reservations with the email used at checkout.</p>
      </div>

      <form className="form-stack" onSubmit={handleSearch} style={{ marginBottom: '2rem' }}>
        <div className="field">
          <label htmlFor="lookup-email">Email</label>
          <input
            id="lookup-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Searching…' : 'Find bookings'}
        </button>
      </form>

      {error && <ErrorAlert message={error} />}
      {loading && <LoadingState />}
      {!loading && queryEmail && bookings && bookings.length === 0 && (
        <p className="muted">No bookings found for {queryEmail}.</p>
      )}
      {!loading && bookings && bookings.length > 0 && (
        <div className="booking-list">
          {bookings.map((booking) => (
            <article key={booking.id} className="booking-row">
              <div>
                <h2>{booking.serviceName ?? `Booking ${booking.id.slice(0, 8)}`}</h2>
                <p className="muted">
                  {booking.createdAt ? formatDateTime(booking.createdAt) : booking.id}
                </p>
              </div>
              <div className="booking-row__meta">
                {booking.amountCents != null && (
                  <span>{formatPrice(booking.amountCents, booking.currency)}</span>
                )}
                {booking.status && <span className="status-pill">{booking.status}</span>}
                <Link to={`/bookings/${booking.id}`} className="text-link">
                  Details
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}

      <p style={{ marginTop: '2rem' }}>
        <Link to="/services">Book a new service</Link>
      </p>
    </div>
  );
}
