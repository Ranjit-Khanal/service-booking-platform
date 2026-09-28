// SPDX-License-Identifier: AGPL-3.0-only
import { NavLink, Outlet, useLocation } from 'react-router-dom';

const PRIMARY = [
  { to: '/services', label: 'Services' },
  { to: '/studios', label: 'Studios' },
  { to: '/providers', label: 'Providers' },
  { to: '/my-bookings', label: 'My bookings' },
];

const SECONDARY = [
  { to: '/how-it-works', label: 'How it works' },
  { to: '/about', label: 'About' },
  { to: '/faq', label: 'FAQ' },
  { to: '/ops', label: 'Ops' },
];

export function Layout() {
  const { pathname } = useLocation();
  const flush = pathname === '/';

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="site-header__inner">
          <NavLink to="/" className="brand-link" end>
            <span className="brand-link__title">SlotBook</span>
            <span className="brand-link__tagline">Reserve your time with care</span>
          </NavLink>
          <nav className="site-nav" aria-label="Primary">
            {PRIMARY.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? 'active' : undefined)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="site-header__sub">
          <nav className="site-nav site-nav--sub" aria-label="Secondary">
            {SECONDARY.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? 'active' : undefined)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className={flush ? 'site-main site-main--flush' : 'site-main'}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="site-footer__inner">
          <div className="site-footer__brand">
            <strong className="brand-link__title" style={{ fontSize: '1.25rem' }}>
              SlotBook
            </strong>
            <p className="muted" style={{ margin: '0.5rem 0 0' }}>
              Real-time appointment booking for beauty, wellness, and consulting studios across the
              valley.
            </p>
          </div>
          <div className="site-footer__col">
            <h3>Explore</h3>
            <ul className="site-footer__links">
              <li>
                <NavLink to="/services">Services</NavLink>
              </li>
              <li>
                <NavLink to="/studios">Studios</NavLink>
              </li>
              <li>
                <NavLink to="/providers">Providers</NavLink>
              </li>
            </ul>
          </div>
          <div className="site-footer__col">
            <h3>Support</h3>
            <ul className="site-footer__links">
              <li>
                <NavLink to="/how-it-works">How it works</NavLink>
              </li>
              <li>
                <NavLink to="/faq">FAQ</NavLink>
              </li>
              <li>
                <NavLink to="/my-bookings">My bookings</NavLink>
              </li>
            </ul>
          </div>
          <div className="site-footer__col">
            <h3>Company</h3>
            <ul className="site-footer__links">
              <li>
                <NavLink to="/about">About</NavLink>
              </li>
              <li>
                <NavLink to="/ops">System status</NavLink>
              </li>
            </ul>
          </div>
        </div>
        <div className="site-footer__bottom">
          <span>© {new Date().getFullYear()} SlotBook. All rights reserved.</span>
          <span>Beauty · Wellness · Consulting</span>
        </div>
      </footer>
    </div>
  );
}
