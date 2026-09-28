// SPDX-License-Identifier: AGPL-3.0-only
const FAQS = [
  {
    q: 'Can two people book the same last slot?',
    a: 'No. The API claims slots inside a Postgres transaction with row-level locking. One request wins; the other gets a conflict.',
  },
  {
    q: 'What if my payment request times out?',
    a: 'Retry with the same Idempotency-Key. SlotBook returns the original result instead of creating a second booking.',
  },
  {
    q: 'Why do I get a confirmation email later?',
    a: 'Notifications are queued. The booking itself is confirmed before email delivery, so SMTP lag cannot roll back your slot.',
  },
  {
    q: 'Which studios can I visit?',
    a: 'Thamel, Patan, and Boudha — see Studios for hours and addresses. Inventory is shared in this demo catalog.',
  },
  {
    q: 'How do I find a past booking?',
    a: 'Open My bookings and search with the email used at checkout.',
  },
];

export function FaqPage() {
  return (
    <div className="page-enter">
      <div className="section-head">
        <h1 className="section-title">FAQ</h1>
        <p className="muted">Practical answers for guests and operators.</p>
      </div>
      <div className="faq-list">
        {FAQS.map((item) => (
          <details key={item.q} className="faq-item">
            <summary>{item.q}</summary>
            <p className="muted">{item.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
