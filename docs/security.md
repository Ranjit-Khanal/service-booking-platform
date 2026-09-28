# Security

SlotBook is a learning/reference project. Its security posture is that of a local demo:
several controls a public deployment needs are absent. This page states what exists so
nobody mistakes the repository for a hardened template.

## Current state

| Area | Status | Details |
|---|---|---|
| Authentication | API keys (service-to-service) | `AUTH_MODE=api_key` (default): every `/api/*` route except `/api/health` requires `Authorization: Bearer <key>` or `X-API-Key`, compared in constant time against `API_KEYS`. Startup fails if no keys are configured. `AUTH_MODE=none` disables it. No end-user accounts. |
| Authorization | Coarse | Any valid key can do everything in the public API. No per-key scopes, tenants or per-customer checks. |
| Admin endpoints | Off by default | `/api/admin/*` returns 404 unless `ADMIN_API_KEY` (≥16 chars) is set; then requires `X-Admin-Key`. Still a DoS lever when enabled (`failDatabase`), so enable only where needed. |
| Customer data access | Behind the API key only | `GET /api/bookings?email=` lists any customer's bookings (IDs, status, amounts, service/slot IDs, timestamps) given only their email address. Each returned ID can then be passed to `GET /api/bookings/:id`, which returns name and email. |
| Input validation | Manual | `CreateBookingUseCase.validate`: key ≤255, UUID IDs, name ≤200, email regex ≤320. Path IDs must be UUIDs (else 404). All SQL is parameterised (`$1…`); no SQL injection found. Not schema-driven (Zod is only used for config). |
| Config validation | Yes | Zod schema in `config/env.ts`; the process refuses to start on invalid config. |
| Secret management | Env vars | API keys and DB/broker credentials come from the root `.env` (Compose) or `backend/.env` (host). Templates contain placeholders (`dev-local-key-change-me`, `slotbook/slotbook`). `.env` files are gitignored. No secrets manager integration. |
| CORS | Configurable | `CORS_ORIGINS` (default `*`). No cookies are used; with API keys, browsers are not the intended caller anyway. |
| Security headers | Yes | `helmet()` defaults, with `Cross-Origin-Resource-Policy: cross-origin` so the SPA on :5173 can read API responses. `x-powered-by` disabled. |
| Rate limiting | Per client IP | Fixed window in Redis. Client IP from `X-Forwarded-For` via `TRUST_PROXY`; a value higher than the real proxy count lets clients spoof IPs. Health checks exempt. Reads fail open on Redis outage. |
| Connection limits | Yes | HAProxy `maxconn 200` frontend / 50 per server. |
| Payment security | N/A (no real integration) | The client never sends an amount; price is read server-side from `services.price_cents`. No card data is handled. No webhooks, so no signature verification is needed or present. Stripe/eSewa adapters are stubs. |
| Sensitive data at rest | Plain | Customer name and email in Postgres, unencrypted; no retention policy. |
| Sensitive data in transit | Plain HTTP | No TLS anywhere in the Compose stack. |
| Sensitive data in messages | Yes | `booking.created` carries customer name and email through RabbitMQ. |
| Logging | Structured (pino) | Logs contain customer email (`EMAIL_SENT` in the worker), booking IDs, idempotency keys and correlation IDs. No redaction configured. `x-request-id` / `x-correlation-id` are taken from client headers unvalidated (JSON logging prevents log-line injection, but values are attacker-controlled). |
| Error exposure | Reasonable | `AppError`s return their message and code; anything else returns a generic `Internal server error` with the correlation ID. Stack traces are not sent to clients. |
| Container user | Non-root | Backend image runs as `USER node`. |
| Exposed ports | Infra on localhost | Postgres, Redis (no password), RabbitMQ and its UI bind to `127.0.0.1`. The API (8080) and demo client (5173) bind to all interfaces. |
| Demo client | Leaks its key by design | `VITE_API_KEY` / `VITE_ADMIN_API_KEY` are compiled into public JS. Demo use only. |
| Dependency scanning | None | No `npm audit` / Dependabot / CodeQL configuration in the repo. |

## Before any non-local deployment

1. Generate real `API_KEYS` (`openssl rand -hex 32`); leave `ADMIN_API_KEY` empty unless needed.
2. Don't deploy the demo client with a real key; call SlotBook from your own backend.
3. Set `TRUST_PROXY` to the actual number of proxies in front of the API.
4. Restrict `CORS_ORIGINS`.
5. Replace all `slotbook/slotbook` credentials; set a Redis password.
6. Terminate TLS at the load balancer.
7. Configure pino `redact` for `to`, `customerEmail`, `customerName`.
8. Validate request bodies with Zod (already a dependency) including UUID formats and
   length limits.
9. Forward idempotency keys to the real payment provider; verify webhook signatures if
   webhooks are added.

## Open-source release checklist

Checked during the documentation pass (2026-09-28):

- [x] No API keys, tokens, private keys or certificates in the source tree
      (searched for common key/token patterns, `*.pem`, `*.key`, `*.crt`, `*.p12`).
- [x] `backend/.env` contains only the same local-dev values as `.env.example` and is
      gitignored.
- [x] No production database URLs, private domains or internal hostnames. The only
      external URLs are Google Fonts and Unsplash images in the demo client.
- [x] No personal machine paths in source or docs.
- [x] No customer data: seed data is synthetic.
- [ ] Provider and studio profiles in `demo-client/src/data/catalogMedia.ts` (names such as
      "Mira Shrestha", "Arjun Thapa", with photos and ratings) look like invented demo
      content. Confirm that none of them are real people before publishing.
- [x] `node_modules/`, `dist/`, logs, coverage are gitignored.
- [ ] **`.book-analysis/`** — ~1.2 MB of text extracted from a commercial book. It is
      gitignored, but it must not be published by any other route (zip upload, copying the
      directory). Delete it or move it outside the repository before publishing.
- [ ] **`demo-client/dist/`** exists on disk (build output). Gitignored; don't ship it.
- [x] `LICENSE` (GNU AGPLv3, official text) added; see [licensing.md](licensing.md).
- [x] Git history checked (one commit, pushed to GitHub): no `.env`, `.book-analysis/`,
      `node_modules/` or build output was ever committed; `git check-ignore` confirms they
      are ignored.
- [ ] Consider an automated secret scan (e.g. gitleaks) in CI once history exists.
- [x] `SECURITY.md` added. **Enable GitHub private vulnerability reporting** in the
      repository settings, or the instructions there won't work.
- [ ] Unsplash images are hot-linked; check the Unsplash license terms fit your use, or
      replace them.

## Reporting vulnerabilities

See [SECURITY.md](../SECURITY.md).
