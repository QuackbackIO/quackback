# Security & trust

Quackback is designed so product and support teams can run customer feedback and conversations on infrastructure they control.

## Self-host

- **AGPL-3.0** — run Quackback on your own infrastructure, fully functional, with no seat tax.
- Data stays in **your PostgreSQL**. There is no queue or cache service to operate beside it, and no required third-party analytics plane for product data.
- Anonymous usage statistics (version, setup and banded usage counts; never emails, names, URLs, hostnames, IP-derived location or content) are sent to PostHog once a day and can be switched off with `DISABLE_TELEMETRY=true`. [telemetry.md](telemetry.md) lists every field.
- Browser product analytics are off unless an operator sets `POSTHOG_KEY`, and then load only in the admin app.
- There is no separate enterprise image. Every self-hosted install includes **SSO through your own OIDC provider and the audit log**.

## Cloud

- Quackback Cloud runs this same codebase. Commercial state reaches a workspace only as a signed projection into a default-off settings block; a self-hosted install has no such block, is entitled to every feature, and makes no outbound control-plane request.
- Workspaces are isolated. On Cloud, SSO through your own OIDC provider and the audit log are on the Enterprise plan.

## AI & Connectors

- Quackback AI's write tools — built-in and remote MCP **Connectors** — are permissioned per tool: **Always allow / Ask for approval / Deny**. A denied tool is omitted from the model's turn entirely, not merely refused when called.
- Approving a proposed write is a teammate action behind the conversation-reply permission; view-only teammates cannot approve.
- Connector credentials are encrypted at rest and never selected into client payloads.

## Reporting

For vulnerability reports, email security@quackback.io or open a private security advisory on GitHub. Do not file public issues for sensitive disclosures.
