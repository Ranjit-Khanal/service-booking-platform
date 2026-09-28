// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from 'react-router-dom';
import { fetchServices } from '@/api/services';
import { ErrorAlert } from '@/components/ErrorAlert';
import { LoadingState } from '@/components/LoadingState';
import { mediaForService } from '@/data/catalogMedia';
import { useAsync } from '@/hooks/useAsync';
import { formatDuration, formatPrice } from '@/utils/format';

export function ServicesPage() {
  const { data: services, error, loading } = useAsync(() => fetchServices(), []);

  return (
    <div className="page-enter">
      <div className="section-head">
        <h1 className="section-title">Services</h1>
        <p className="muted">Live catalog from the SlotBook API — prices and durations included.</p>
      </div>

      {loading && <LoadingState label="Fetching services…" />}
      {error && <ErrorAlert message={error} />}
      {!loading && !error && services && services.length === 0 && (
        <p className="muted">No services are listed yet.</p>
      )}
      {!loading && !error && services && services.length > 0 && (
        <div className="service-grid">
          {services.map((service, index) => {
            const media = mediaForService(service.name);
            return (
              <Link
                key={service.id}
                to={`/services/${service.id}`}
                className="service-card stagger-item"
                style={{ animationDelay: `${index * 0.06}s` }}
              >
                <div className="service-card__media">
                  <img src={media.imageUrl} alt={media.imageAlt} loading="lazy" />
                  <span className="service-card__badge">{media.categoryLabel}</span>
                </div>
                <div className="service-card__body">
                  <h2>{service.name}</h2>
                  <p>{service.description ?? media.blurb}</p>
                  <p className="service-card__meta">
                    {[formatDuration(service.durationMinutes), formatPrice(service.priceCents, service.currency)]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
