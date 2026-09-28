// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from 'react-router-dom';

const STEPS = [
  {
    title: 'Choose a service',
    body: 'Browse beauty, wellness, or consulting. Each listing shows duration and price from Postgres.',
  },
  {
    title: 'Pick an open slot',
    body: 'Only open inventory appears. Concurrent bookings use row locks so the last slot cannot double-sell.',
  },
  {
    title: 'Confirm once',
    body: 'Your browser sends an Idempotency-Key. Network retries return the same booking instead of charging twice.',
  },
  {
    title: 'Get notified',
    body: 'After payment, a worker sends confirmation asynchronously — the HTTP response does not wait on email.',
  },
];

export function HowItWorksPage() {
  return (
    <div className="page-enter">
      <div className="section-head">
        <h1 className="section-title">How it works</h1>
        <p className="muted">A short path from browsing to a confirmed reservation.</p>
      </div>
      <ol className="steps">
        {STEPS.map((step, i) => (
          <li key={step.title} className="steps__item">
            <span className="steps__num">{i + 1}</span>
            <div>
              <h2>{step.title}</h2>
              <p className="muted">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <Link to="/services" className="btn btn--accent" style={{ marginTop: '1.5rem' }}>
        Start with services
      </Link>
    </div>
  );
}
