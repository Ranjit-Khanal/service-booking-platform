# ADR 0008: API-key authentication for client applications

Status: Accepted (2026-09-28)

## Context

The backend had no authentication. To run as a service that other applications integrate
with, it needs to know that a caller is an allowed application. It does not need to own
end-user identity: the integrating application already has users, sessions and login.
Admin endpoints (failure injection) were public and could take the service down.

## Options considered

1. **Own user accounts** (signup, login, sessions/JWT issuance).
2. **Verify externally issued JWTs** (OIDC provider's JWKS; per-user claims).
3. **Static API keys per client application**, sent as `Authorization: Bearer`.
4. mTLS between services.

## Decision

Option 3. `AUTH_MODE=api_key` (default) with `API_KEYS` as a comma-separated list, compared
in constant time. `/api/health` is exempt. Admin routes use a separate `ADMIN_API_KEY` and
are disabled when it is unset. `AUTH_MODE=none` exists for local experiments. Configuration
fails fast if `api_key` mode has no keys.

## Consequences

- One middleware and three env vars. Nothing to store, no dependency on an identity provider.
- The integrating application is trusted to pass the right customer name/email. SlotBook
  cannot tell customers apart beyond that.
- Any key can access any booking. Suitable for a single tenant with one or a few backend
  integrations.
- Browser clients would have to embed the key. The demo client does, and is documented
  as demo-only.

## Trade-offs

- No per-key scopes, rate limits, rotation API or audit trail. Rotation means adding the
  new key to `API_KEYS`, deploying, then removing the old one.
- Option 2 would allow per-user authorization ("only see your own bookings") without SlotBook
  owning accounts. It's the natural next step if multi-tenant or browser-direct access is
  needed. It requires a customer identifier on bookings, which the schema doesn't have.
- Option 1 was rejected as building an identity provider inside a booking service.
