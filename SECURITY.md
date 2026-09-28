# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub: **Security → Report a vulnerability** on this repository
(GitHub private vulnerability reporting). Include:

- what is affected (endpoint, file, configuration),
- steps to reproduce or a proof of concept,
- the impact you expect.

You should get an acknowledgement within a week. This is a volunteer-maintained project,
so there's no formal response-time guarantee.

## Supported versions

Only the latest commit on the default branch is supported. There are no release branches.

## Scope and known limitations

SlotBook is designed for self-hosting. Several behaviors are **known and documented**
rather than vulnerabilities, for example: API keys are all-powerful (no per-key scopes),
the demo client embeds its API key in public JavaScript, and the default `.env.example`
credentials are placeholders that must be changed. See [docs/security.md](docs/security.md)
and [docs/architecture/known-limitations.md](docs/architecture/known-limitations.md) before
reporting. Reports that show these being worse than documented are welcome.
