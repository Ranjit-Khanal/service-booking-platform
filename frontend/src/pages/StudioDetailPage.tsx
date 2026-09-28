import { Link, useParams } from 'react-router-dom';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { ErrorAlert } from '@/components/ErrorAlert';
import { RatingStars } from '@/components/RatingStars';
import { PROVIDERS, STUDIOS } from '@/data/catalogMedia';

export function StudioDetailPage() {
  const { slug = '' } = useParams();
  const studio = STUDIOS.find((s) => s.slug === slug);

  if (!studio) {
    return (
      <div className="page-enter">
        <ErrorAlert message="Studio not found" />
        <Link to="/studios">All studios</Link>
      </div>
    );
  }

  const team = PROVIDERS.filter((p) => p.studioSlug === studio.slug);

  return (
    <div className="page-enter">
      <Breadcrumbs items={[{ label: 'Studios', to: '/studios' }, { label: studio.name }]} />
      <div className="detail-hero detail-hero--tall">
        <img src={studio.imageUrl} alt={`${studio.name} interior`} />
        <div className="detail-hero__copy">
          <p className="hero__eyebrow">{studio.city}</p>
          <h1 className="section-title">{studio.name}</h1>
          <RatingStars rating={studio.rating} reviewCount={studio.reviewCount} />
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            {studio.address}
          </p>
          <p className="detail-hero__meta">{studio.hours}</p>
          <p className="muted">{studio.description}</p>
          <ul className="chip-list">
            {studio.amenities.map((a) => (
              <li key={a} className="chip">
                {a}
              </li>
            ))}
          </ul>
          <div className="hero-bleed__actions">
            <Link to="/services" className="btn btn--accent">
              Book a service
            </Link>
            <Link to="/studios" className="btn btn--secondary">
              All studios
            </Link>
          </div>
        </div>
      </div>

      {team.length > 0 && (
        <section className="home-section" style={{ padding: '0 0 2.5rem' }}>
          <div className="section-head">
            <h2 className="section-title" style={{ fontSize: '1.4rem' }}>
              Team at this studio
            </h2>
          </div>
          <div className="provider-grid">
            {team.map((person) => (
              <Link key={person.slug} to={`/providers/${person.slug}`} className="provider-card">
                <img src={person.imageUrl} alt={person.name} loading="lazy" />
                <div>
                  <h2>{person.name}</h2>
                  <p className="muted">{person.role}</p>
                  <RatingStars rating={person.rating} reviewCount={person.reviewCount} />
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
