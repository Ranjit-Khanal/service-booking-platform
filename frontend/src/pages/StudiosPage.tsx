import { Link } from 'react-router-dom';
import { RatingStars } from '@/components/RatingStars';
import { STUDIOS } from '@/data/catalogMedia';

export function StudiosPage() {
  return (
    <div className="page-enter">
      <div className="section-head">
        <h1 className="section-title">Studios</h1>
        <p className="muted">Walk-in welcome windows vary — booking online locks your slot.</p>
      </div>
      <div className="studio-grid">
        {STUDIOS.map((studio) => (
          <article key={studio.slug} className="studio-card">
            <img src={studio.imageUrl} alt={`${studio.name} interior`} loading="lazy" />
            <div className="studio-card__body">
              <h2>{studio.name}</h2>
              <RatingStars rating={studio.rating} reviewCount={studio.reviewCount} />
              <p className="muted" style={{ marginTop: '0.5rem' }}>
                {studio.address}
                <br />
                {studio.city}
              </p>
              <p className="studio-card__hours">{studio.hours}</p>
              <Link to={`/studios/${studio.slug}`} className="text-link">
                Studio details →
              </Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
