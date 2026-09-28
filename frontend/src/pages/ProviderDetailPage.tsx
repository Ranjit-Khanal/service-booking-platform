import { Link, useParams } from 'react-router-dom';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { ErrorAlert } from '@/components/ErrorAlert';
import { RatingStars } from '@/components/RatingStars';
import { PROVIDERS, STUDIOS } from '@/data/catalogMedia';

export function ProviderDetailPage() {
  const { slug = '' } = useParams();
  const person = PROVIDERS.find((p) => p.slug === slug);

  if (!person) {
    return (
      <div className="page-enter">
        <ErrorAlert message="Provider not found" />
        <Link to="/providers">All providers</Link>
      </div>
    );
  }

  const studio = STUDIOS.find((s) => s.slug === person.studioSlug);

  return (
    <div className="page-enter">
      <Breadcrumbs items={[{ label: 'Providers', to: '/providers' }, { label: person.name }]} />
      <div className="provider-detail">
        <img src={person.imageUrl} alt={person.name} />
        <div>
          <p className="hero__eyebrow">{person.role}</p>
          <h1 className="section-title">{person.name}</h1>
          <RatingStars rating={person.rating} reviewCount={person.reviewCount} />
          <p className="muted" style={{ marginTop: '0.85rem' }}>
            {person.bio}
          </p>
          <p className="detail-hero__meta">
            {person.yearsExperience} years experience · Focus: {person.focus}
          </p>
          <ul className="chip-list">
            {person.specialties.map((s) => (
              <li key={s} className="chip">
                {s}
              </li>
            ))}
          </ul>
          {studio && (
            <p className="muted" style={{ marginTop: '1rem' }}>
              Usually based at{' '}
              <Link to={`/studios/${studio.slug}`} className="text-link">
                {studio.name}
              </Link>
              , {studio.city}.
            </p>
          )}
          <p className="muted">
            Sessions are booked against shared service inventory — availability updates the moment a
            slot is claimed, so you never fight a phantom opening.
          </p>
          <div className="hero-bleed__actions">
            <Link to="/services" className="btn btn--accent">
              See services
            </Link>
            <Link to="/providers" className="btn btn--secondary">
              All providers
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
