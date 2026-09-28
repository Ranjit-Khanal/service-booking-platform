import { FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createBooking } from '@/api/bookings';
import { fetchService, fetchServiceSlots } from '@/api/services';
import { ApiError } from '@/api/client';
import type { TimeSlot } from '@/api/types';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { ErrorAlert } from '@/components/ErrorAlert';
import { LoadingState } from '@/components/LoadingState';
import { mediaForService } from '@/data/catalogMedia';
import { useAsync } from '@/hooks/useAsync';
import {
  formatDateTime,
  formatDuration,
  formatPrice,
  formatSlotTime,
  isSlotOpen,
  todayIsoDate,
} from '@/utils/format';

const EMAIL_KEY = 'slotbook.customerEmail';

export function ServiceDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [date, setDate] = useState(todayIsoDate());
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState(() => localStorage.getItem(EMAIL_KEY) ?? '');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: service, error: serviceError, loading: serviceLoading } = useAsync(
    () => fetchService(id),
    [id],
  );

  const {
    data: slots,
    error: slotsError,
    loading: slotsLoading,
  } = useAsync(() => fetchServiceSlots(id, date), [id, date]);

  const availableSlots = useMemo(() => (slots ?? []).filter(isSlotOpen), [slots]);
  const selectedSlot: TimeSlot | undefined = availableSlots.find((s) => s.id === selectedSlotId);
  const media = mediaForService(service?.name ?? '');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedSlotId || !service) {
      setSubmitError('Choose an available slot before booking.');
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    const idempotencyKey = crypto.randomUUID();

    try {
      const booking = await createBooking(
        {
          serviceId: service.id,
          slotId: selectedSlotId,
          customerName: customerName.trim(),
          customerEmail: customerEmail.trim(),
        },
        idempotencyKey,
      );
      localStorage.setItem(EMAIL_KEY, customerEmail.trim());
      navigate('/confirmation', {
        state: {
          booking: {
            ...booking,
            serviceName: service.name,
            startsAt: selectedSlot?.startsAt,
          },
          idempotencyKey,
        },
      });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Booking failed';
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (serviceLoading) {
    return <LoadingState label="Loading service…" />;
  }

  if (serviceError || !service) {
    return (
      <div className="page-enter">
        <ErrorAlert message={serviceError ?? 'Service not found'} />
        <Link to="/services">Back to services</Link>
      </div>
    );
  }

  return (
    <div className="page-enter">
      <Breadcrumbs items={[{ label: 'Services', to: '/services' }, { label: service.name }]} />
      <div className="detail-hero">
        <img src={media.imageUrl} alt={media.imageAlt} />
        <div className="detail-hero__copy">
          <p className="hero__eyebrow">{media.categoryLabel}</p>
          <h1 className="section-title">{service.name}</h1>
          <p className="muted">{service.description ?? media.blurb}</p>
          <p className="detail-hero__meta">
            {[formatDuration(service.durationMinutes), formatPrice(service.priceCents, service.currency)]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <ul className="chip-list">
            <li className="chip">Instant confirmation</li>
            <li className="chip">Free rescheduling</li>
            <li className="chip">Secure payment</li>
          </ul>
          <Link to="/services" className="text-link">
            ← All services
          </Link>
        </div>
      </div>

      <section className="booking-panel">
        <h2 className="section-title" style={{ fontSize: '1.45rem' }}>
          Book a slot
        </h2>

        <div className="field" style={{ marginBottom: '1rem', maxWidth: '16rem' }}>
          <label htmlFor="slot-date">Date</label>
          <input
            id="slot-date"
            type="date"
            value={date}
            min={todayIsoDate()}
            onChange={(e) => {
              setDate(e.target.value);
              setSelectedSlotId(null);
            }}
          />
        </div>

        {slotsLoading && <LoadingState label="Loading slots…" />}
        {slotsError && <ErrorAlert message={slotsError} />}
        {!slotsLoading && !slotsError && (
          <>
            {availableSlots.length === 0 ? (
              <p className="muted">No open slots for this date. Try another day.</p>
            ) : (
              <div className="slot-grid" role="listbox" aria-label="Available time slots">
                {availableSlots.map((slot) => {
                  const selected = selectedSlotId === slot.id;
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`slot-btn${selected ? ' slot-btn--selected' : ''}`}
                      onClick={() => setSelectedSlotId(slot.id)}
                    >
                      {formatSlotTime(slot.startsAt)}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        <form className="form-stack" style={{ marginTop: '1.5rem' }} onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="customer-name">Your name</label>
            <input
              id="customer-name"
              required
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              autoComplete="name"
            />
          </div>
          <div className="field">
            <label htmlFor="customer-email">Email</label>
            <input
              id="customer-email"
              type="email"
              required
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          {selectedSlot && (
            <p className="muted" style={{ margin: 0 }}>
              Selected: {formatDateTime(selectedSlot.startsAt)}
            </p>
          )}
          {submitError && <ErrorAlert message={submitError} />}
          <button type="submit" className="btn btn--accent" disabled={submitting || !selectedSlotId}>
            {submitting ? 'Booking…' : 'Confirm booking'}
          </button>
        </form>
      </section>
    </div>
  );
}
