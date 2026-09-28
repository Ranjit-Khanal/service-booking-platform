import { Link } from 'react-router-dom';
import { RatingStars } from '@/components/RatingStars';
import { CATEGORIES, HERO_IMAGE, PROVIDERS, TESTIMONIALS, TRUST_STATS } from '@/data/catalogMedia';

export function HomePage() {
  return (
    <div className="page-enter home">
      <section className="hero-bleed" aria-label="SlotBook">
        <img className="hero-bleed__image" src={HERO_IMAGE} alt="" />
        <div className="hero-bleed__veil" />
        <div className="hero-bleed__content">
          <p className="hero__eyebrow">Appointments without the chaos</p>
          <h1 className="hero-bleed__brand">SlotBook</h1>
          <p className="hero-bleed__lead">
            Reserve beauty, wellness, and consulting time in studios that actually keep the schedule
            honest.
          </p>
          <div className="hero-bleed__actions">
            <Link to="/services" className="btn btn--accent">
              Browse services
            </Link>
            <Link to="/how-it-works" className="btn btn--ghost">
              How it works
            </Link>
          </div>
        </div>
      </section>

      <section className="home-section" aria-label="SlotBook by the numbers">
        <div className="stats-bar">
          {TRUST_STATS.map((stat) => (
            <div key={stat.label} className="stats-bar__item">
              <span className="stats-bar__value">{stat.value}</span>
              <span className="stats-bar__label">{stat.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="home-section">
        <div className="section-head">
          <h2 className="section-title">Explore by category</h2>
          <p className="muted">Pick a lane, then choose a time that is still open.</p>
        </div>
        <div className="media-grid">
          {CATEGORIES.map((cat) => (
            <Link key={cat.slug} to={`/categories/${cat.slug}`} className="media-tile">
              <img src={cat.imageUrl} alt="" loading="lazy" />
              <div className="media-tile__body">
                <h3>{cat.title}</h3>
                <p>{cat.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="home-section">
        <div className="section-head">
          <h2 className="section-title">Meet a few specialists</h2>
          <p className="muted">Real people behind the calendar, with the reviews to back them up.</p>
        </div>
        <div className="provider-grid">
          {PROVIDERS.map((person) => (
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

      <section className="home-section">
        <div className="section-head">
          <h2 className="section-title">What people book us for</h2>
          <p className="muted">A few words from recent SlotBook customers.</p>
        </div>
        <div className="testimonial-grid">
          {TESTIMONIALS.map((t) => (
            <figure key={t.author} className="testimonial-card">
              <blockquote className="testimonial-card__quote">{t.quote}</blockquote>
              <figcaption className="testimonial-card__meta">
                <strong>{t.author}</strong> · {t.context}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="home-section home-cta">
        <div>
          <h2 className="section-title">Already booked?</h2>
          <p className="muted">Look up your confirmation with the email you used at checkout.</p>
        </div>
        <Link to="/my-bookings" className="btn">
          Find my bookings
        </Link>
      </section>
    </div>
  );
}
