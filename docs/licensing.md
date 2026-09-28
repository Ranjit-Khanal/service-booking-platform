# Licensing

This page describes how the repository is organised for licensing today, and how it
could accommodate separately licensed code in the future. It is a technical description,
not legal advice. If licensing matters for your use, read the license itself and consult
a lawyer.

## Community edition

Everything in this repository is the community edition. There is no other edition today:
no enterprise features, no paid modules, no license checks, no activation keys and no
telemetry.

The community edition is the complete product:

| Area | Included |
|---|---|
| Booking API | services and slots (read), booking create / get / list-by-email / cancel |
| Booking lifecycle | `pending_payment → confirmed \| failed`, `confirmed → cancelled` |
| Correctness | Postgres transactions and row locks, idempotency keys, idempotent consumer |
| Infrastructure | PostgreSQL, Redis, RabbitMQ, notification worker, retries, DLQ, circuit breaker, graceful shutdown |
| Operations | Docker Compose self-hosting, HAProxy load balancing, health checks, failure injection |
| Auth | API keys for client applications, admin key for operator endpoints |
| Docs | architecture, API (OpenAPI), distributed-systems deep dives, ADRs |
| Demo client | React reference client |

Some things you might expect from a booking platform **do not exist yet, in any edition**:
customer and provider entities, provider assignment, real-time (WebSocket) updates, catalog
management endpoints, real payment and email integrations. They are open for contribution
to the community edition. See [architecture/known-limitations.md](architecture/known-limitations.md).

## Current license

The community edition is licensed under the **GNU Affero General Public License, version 3**
(`AGPL-3.0-only`). The full text is in [LICENSE](../LICENSE), unmodified, as published by the
Free Software Foundation at <https://www.gnu.org/licenses/agpl-3.0.txt>.

How that is expressed in the repository:

- `LICENSE` at the repository root.
- `"license": "AGPL-3.0-only"` in `backend/package.json` and `demo-client/package.json`.
- A one-line `SPDX-License-Identifier: AGPL-3.0-only` comment at the top of each TypeScript
  and SQL source file in `backend/` and `demo-client/`.

For what the license permits and requires, read the license. In summary, it grants
permission to use, study, modify and redistribute the software, including running it as a
network service, subject to its conditions. Section 13 adds a condition about offering
source code to users who interact with a modified version over a network. The license text
is authoritative; this summary is not.

## Contribution model

Contributions are welcome and are accepted under the same license as the project
(AGPL-3.0-only): by submitting a contribution, you offer it under the project's license.
There is **no Contributor License Agreement (CLA)** and no copyright assignment. Contributors
keep the copyright in their contributions. See [CONTRIBUTING.md](../CONTRIBUTING.md).

### Future consideration: contributor terms

If the project later offers the same code under a second (e.g. commercial) license, the
maintainer would need the right to do so for every contribution. With inbound = outbound
AGPL contributions and no CLA, that right isn't obtained automatically. Options people use
include a CLA, a copyright assignment, or asking contributors for permission at that time.
Nothing like this is in place, and none is planned yet. It is recorded here so that
contributors and the maintainer can see the question in advance.

This does **not** affect a future model where proprietary modules are *separate code* (next
section): the community code would stay AGPL, and new proprietary modules would be written
under their own terms.

## Future enterprise boundary

No enterprise functionality exists, and no placeholder code, directories or feature flags
for it have been added. The boundary is architectural. It uses seams that already exist.

### The seams

```text
backend/src/
  domain/            ports: BookingRepository, PaymentProvider, EventPublisher, NotificationSender, …
  application/       use cases depend only on ports
  infrastructure/    community adapters (Postgres, Redis, RabbitMQ, mock payment, logging notifier)
  interfaces/        HTTP routes, middleware (auth), AMQP consumers
  composition/
    buildApp.ts      ← the single place where concrete implementations are chosen and wired
```

A separately licensed module could extend the system without editing community code by:

1. **Implementing an existing port.** Example: an SSO-aware auth middleware, a different
   `PaymentProvider`, an audit-logging `EventPublisher` decorator.
2. **Adding routes.** `createHttpApp` mounts routers explicitly; an extra router can be
   mounted by the composition root.
3. **Consuming events.** `booking.created` goes to a topic exchange, so an additional
   consumer (e.g. compliance export) can bind its own queue without touching the producer.

### How proprietary code could be kept separate

If this is ever done, the structural rules would be:

- Proprietary code lives in its **own top-level directory or package**, with its **own
  LICENSE file**, never interleaved in `backend/src`.
- Community code **never imports** from it. The dependency points one way: optional
  module → community ports.
- The community build must work, and pass its tests, with that directory absent.
- Wiring happens in the composition root through a small, explicit extension hook (e.g. an
  optional list of modules passed to `buildApp`). That hook would be added together with
  the first real module, not before.

Whether code that plugs into AGPL-licensed code in this way can be distributed under
different terms is a legal question, not an architectural one. The structure above keeps
the options open. It doesn't answer that question.

### Examples of functionality that *could* be separate in future

Examples only. None of these exist or are planned on a timeline:

- enterprise SSO (SAML/OIDC for operator access)
- advanced organisation and team management
- audit and compliance tooling (immutable audit logs, data-retention policies, exports)
- advanced administration consoles
- multi-tenant controls (per-tenant keys, quotas, isolation)
- managed cloud hosting and enterprise support (services rather than code)

Anything in the "does not exist yet" list above (providers, assignment, real-time updates,
catalog management, real payment/email adapters) belongs in the community edition.

## Third-party dependencies

Dependencies are not covered by this project's license. Each retains its own license, and
users should review those terms. The table below reflects the `license` field declared by
each package in the lockfiles on 2026-09-28. It is a snapshot, not a compatibility analysis.

### npm packages

| | Runtime (direct) | All installed (incl. transitive and dev) |
|---|---|---|
| `backend` | amqplib, cors, express, express-rate-limit, helmet, ioredis, nanoid, pg, pino, pino-http, uuid, zod: MIT; dotenv: BSD-2-Clause | 263 packages: MIT 213, Apache-2.0 25, MPL-2.0 12, ISC 10, BSD-3-Clause 2, BSD-2-Clause 1 |
| `demo-client` | react, react-dom, react-router-dom: MIT | 125 packages: MIT 116, ISC 5, Apache-2.0 2, BSD-3-Clause 1, CC-BY-4.0 1 |

Worth knowing:

- The MPL-2.0 packages are `lightningcss` and its platform binaries, pulled in as
  **development** dependencies (via the Vitest/Vite toolchain), not shipped in the backend
  runtime.
- `caniuse-lite` (CC-BY-4.0) is a demo-client **build-time** dependency.
- `nanoid`, `uuid`, `express-rate-limit` and `pino-http` are declared in
  `backend/package.json` but not imported anywhere; they could be removed.

Regenerate the snapshot with any license reporter, e.g. `npx license-checker --summary` in
each package directory.

### Container images (pulled at runtime, not included in the repository)

| Image | Version observed | Notes |
|---|---|---|
| `postgres:16-alpine` | 16.15 | PostgreSQL License |
| `redis:7-alpine` | 7.4.11 | **Redis 7.4 is distributed under source-available licenses (RSALv2 / SSPLv1), not an OSI-approved license.** Review whether that fits your deployment. Protocol-compatible alternatives include Valkey (BSD-3-Clause) and Redis 8.x, which adds an AGPLv3 option. Both are untested with this project. |
| `rabbitmq:3.13-management-alpine` | 3.13.7 | MPL-2.0 |
| `haproxy:2.9-alpine` | 2.9.15 | GPL-2.0 (see HAProxy's own LICENSE for the exact terms) |
| `nginx:1.27-alpine` (demo client) | not pulled locally | BSD-2-Clause |
| `node:22-alpine` (build/runtime base) | not pulled locally | Node.js: MIT; the image includes other OS packages with their own licenses |

Each image also contains operating-system packages (Alpine) under their own licenses.

### Assets used by the demo client

- **Fonts:** Fraunces and Source Sans 3, loaded from Google Fonts at runtime (not bundled).
  Both are published by Google Fonts under the SIL Open Font License; verify on the fonts'
  pages.
- **Images:** photos hot-linked from `images.unsplash.com` (not bundled). Their use is
  governed by the Unsplash License. Replace them if that doesn't fit your deployment.
- **Provider/studio names, bios and ratings** in `demo-client/src/data/catalogMedia.ts`
  appear to be invented demo content. The maintainer should confirm that none refer to real
  people before publishing.

### Code provenance

The project states that the code was written for it, applying concepts from *Distributed
Systems with Node.js* (Thomas Hunter II, O'Reilly) rather than copying the book's samples;
see [BOOK_KNOWLEDGE_MAP.md](BOOK_KNOWLEDGE_MAP.md). No line-by-line comparison against the
book's published code was performed during this review. No vendored third-party source
files or generated code were found in `backend/src` or `demo-client/src`. The maintainer's local `.book-analysis/` notes (extracted book text) are
gitignored and **must never be committed or distributed**.
