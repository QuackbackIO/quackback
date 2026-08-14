# Security & trust

Quackback is designed so product and support teams can run customer feedback and conversations on infrastructure they control.

## Self-host

- **AGPL-3.0** — you can run Quackback on your own infrastructure with no seat tax.
- Data stays in **your PostgreSQL** (and Redis-compatible store). There is no required third-party analytics plane for core product data.
- Enterprise images can enable **SSO / SAML, SCIM, and audit logs** (see `deploy/self-hosted`).

## Cloud

- Workspaces are isolated; commercial limits and entitlements are projected from the control plane into `settings.tier_limits` / cloud projection columns.
- Operators should treat audit logs, SSO, and IP allowlists as the compliance surface for regulated buyers.

## AI & Connectors

- Quinn write tools (built-in and MCP **Connectors**) are permissioned **Ask for approval / Always allow / Deny**.
- Connector auth tokens are encrypted at rest (`assistant-connector-auth`).
- Custom HTTP actions keep secret headers encrypted and response fields allowlisted before they reach the model.

## Reporting

For vulnerability reports, email security@quackback.io (or open a private security advisory on GitHub). Do not file public issues for sensitive disclosures.
