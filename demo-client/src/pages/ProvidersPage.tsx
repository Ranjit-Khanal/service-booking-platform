// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from 'react-router-dom';
import { RatingStars } from '@/components/RatingStars';
import { PROVIDERS } from '@/data/catalogMedia';

export function ProvidersPage() {
  return (
    <div className="page-enter">
      <div className="section-head">
        <h1 className="section-title">Providers</h1>
        <p className="muted">Specialists behind the SlotBook calendar.</p>
      </div>
      <div className="provider-grid">
        {PROVIDERS.map((person) => (
          <Link key={person.slug} to={`/providers/${person.slug}`} className="provider-card">
            <img src={person.imageUrl} alt={person.name} loading="lazy" />
            <div>
              <h2>{person.name}</h2>
              <p className="muted">{person.role}</p>
              <p className="provider-card__focus">{person.focus}</p>
              <RatingStars rating={person.rating} reviewCount={person.reviewCount} />
              <ul className="chip-list">
                {person.specialties.slice(0, 2).map((s) => (
                  <li key={s} className="chip">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
