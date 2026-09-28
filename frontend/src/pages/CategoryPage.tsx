import { Link, useParams } from 'react-router-dom';
import { fetchServices } from '@/api/services';
import { ErrorAlert } from '@/components/ErrorAlert';
import { LoadingState } from '@/components/LoadingState';
import { CATEGORIES, mediaForService, type ServiceCategory } from '@/data/catalogMedia';
import { useAsync } from '@/hooks/useAsync';
import { formatDuration, formatPrice } from '@/utils/format';

export function CategoryPage() {
  const { slug = '' } = useParams();
  const category = CATEGORIES.find((c) => c.slug === slug);
  const { data: services, error, loading } = useAsync(() => fetchServices(), []);

  const filtered =
    services?.filter((s) => mediaForService(s.name).category === (slug as ServiceCategory)) ?? [];

  if (!category) {
    return (
      <div className="page-enter">
        <ErrorAlert message="Unknown category" />
        <Link to="/services">Browse all services</Link>
      </div>
    );
  }

  return (
    <div className="page-enter">
      <div className="category-banner">
        <img src={category.imageUrl} alt="" />
        <div>
          <p className="hero__eyebrow">Category</p>
          <h1 className="section-title">{category.title}</h1>
          <p className="muted">{category.description}</p>
        </div>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorAlert message={error} />}
      {!loading && filtered.length === 0 && (
        <p className="muted">No services in this category right now.</p>
      )}
      <div className="service-grid">
        {filtered.map((service) => {
          const media = mediaForService(service.name);
          return (
            <Link key={service.id} to={`/services/${service.id}`} className="service-card">
              <div className="service-card__media">
                <img src={media.imageUrl} alt={media.imageAlt} loading="lazy" />
              </div>
              <div className="service-card__body">
                <h2>{service.name}</h2>
                <p className="service-card__meta">
                  {[formatDuration(service.durationMinutes), formatPrice(service.priceCents)]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
