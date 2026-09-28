import { Link } from 'react-router-dom';
import { ABOUT_IMAGE } from '@/data/catalogMedia';

export function AboutPage() {
  return (
    <div className="page-enter">
      <div className="story-layout">
        <img className="story-layout__image" src={ABOUT_IMAGE} alt="Quiet studio seating area" />
        <div>
          <p className="hero__eyebrow">About</p>
          <h1 className="section-title">Built for honest schedules</h1>
          <p className="muted">
            SlotBook is a service booking platform that treats time as inventory. When the last slot is
            claimed, concurrent requests cannot invent a second one. Confirmations travel through a
            queue so the booking path stays fast even when email delivery is slow.
          </p>
          <p className="muted">
            We run studios in Kathmandu and Lalitpur for beauty, wellness, and consulting — with the
            same API powering the public site and the ops panel.
          </p>
          <div className="hero-bleed__actions" style={{ marginTop: '1.5rem' }}>
            <Link to="/studios" className="btn">
              Visit our studios
            </Link>
            <Link to="/providers" className="btn btn--secondary">
              Meet the team
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
