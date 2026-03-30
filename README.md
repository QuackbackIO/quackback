<p align="center">
  <a href="https://featurepool.io">
    <img src=".github/logo.svg" alt="Featurepool Logo" width="80" height="80" />
  </a>
</p>

<h1 align="center">Featurepool</h1>

<p align="center">
  <strong>Open source feedback for teams that ship.</strong>
</p>

<p align="center">
  The open-source alternative to Canny, UserVoice, and Productboard.<br />
  Collect feedback. Prioritize what matters. Close the loop.
</p>

<p align="center">
  <a href="https://featurepool.io">Website</a> &middot;
  <a href="https://featurepool.io/docs">Docs</a> &middot;
  <a href="#get-started">Get Started</a>
</p>

<p align="center">
  <a href="https://github.com/FeaturepoolIO/featurepool/stargazers"><img src="https://img.shields.io/github/stars/FeaturepoolIO/featurepool?style=flat&color=f5a623" alt="GitHub stars" /></a>
  <a href="https://github.com/FeaturepoolIO/featurepool/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License" /></a>
  <a href="https://github.com/FeaturepoolIO/featurepool/actions"><img src="https://img.shields.io/github/actions/workflow/status/FeaturepoolIO/featurepool/ci.yml?label=CI" alt="CI" /></a>
  <a href="https://github.com/FeaturepoolIO/featurepool/issues"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome" /></a>
</p>

<p align="center">
  <img src=".github/screenshot.png" alt="Featurepool feedback portal" width="800" />
</p>

## Get Started

**Cloud** coming soon at [featurepool.io](https://featurepool.io). Join the waitlist.

**Self-hosted** anywhere with [Docker](#docker) or [one click on Railway](#one-click-deploy).

## Why Featurepool?

Most feedback tools are expensive, closed-source, and lock you in. Featurepool gives you a modern feedback system you actually own.

- **Self-host for free.** Run on your own infrastructure. No per-seat pricing.
- **Own your data.** Your feedback lives in your own database. No vendor lock-in.
- **AI-powered.** Automatic duplicate detection, AI summaries, feedback extraction from external sources, and an [MCP server](https://featurepool.io/docs/mcp) that lets AI agents search, triage, and act on feedback directly.
- **24 integrations.** Slack, Linear, Jira, GitHub, Intercom, Zendesk, and [more](#integrations) out of the box.

## Features

- **Feedback boards.** Let users vote, comment, and track status on feature requests. Vote on behalf of customers and see a full activity timeline on every post.
- **AI-powered.** Automatically detect duplicates, summarize key themes, and ingest feedback from Slack, email, and other sources so nothing slips through the cracks.
- **Embeddable widget.** Collect feedback right inside your app with a [drop-in widget](https://featurepool.io/docs/widget/installation). Works on desktop and mobile.
- **Admin inbox.** Triage incoming feedback in one place. Filter, group, dismiss, and restore deleted posts.
- **Roadmap & changelog.** Show users what's planned, in progress, and shipped. Publish updates and schedule posts for later.
- **Integrations.** [24 integrations](#integrations) including Slack, Linear, Jira, GitHub, Intercom, Zendesk, and two-way issue tracker sync.
- **API, webhooks & MCP.** Automate workflows with the REST API, outbound webhooks, and a 23-tool [MCP server](https://featurepool.io/docs/mcp) for AI agents.
- **Flexible auth.** Password, email OTP, Google, GitHub, and SSO with providers like Okta and Auth0.
- **SEO-ready.** Auto-generated sitemap and social sharing previews on every portal page.

## Integrations

Slack, Linear, Jira, GitHub, GitLab, Asana, ClickUp, Monday, Trello, Notion, Shortcut, Azure DevOps, Intercom, Zendesk, Freshdesk, HubSpot, Salesforce, Stripe, Discord, Teams, Segment, Zapier, Make, and n8n.

## Self-Hosted

### One-Click Deploy

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/featurepool?referralCode=ez8Slg&utm_source=github&utm_medium=readme&utm_campaign=deploy-button)

### Docker

```bash
git clone https://github.com/FeaturepoolIO/featurepool.git
cd featurepool
cp .env.example .env   # Edit with your configuration
docker build -t featurepool -f apps/web/Dockerfile .
docker run -p 5433:5435 --env-file .env featurepool
```

Requires PostgreSQL and a Redis-compatible store. Set `DATABASE_URL` and `REDIS_URL` in `.env`. Migrations run automatically on startup.

## Contributing

See the [Contributing Guide](CONTRIBUTING.md) to get started.

- [GitHub Discussions](https://github.com/FeaturepoolIO/featurepool/discussions) — ask questions, share ideas

### Local Development

Prerequisites: [Bun](https://bun.sh/) v1.3.7+ and [Docker](https://docker.com/)

```bash
git clone https://github.com/FeaturepoolIO/featurepool.git
cd featurepool
bun run setup    # Install deps, start Docker, run migrations
bun run db:seed  # Optional: seed demo data
bun run dev      # http://localhost:3001
```

Log in with `demo@example.com` / `password`.

### Tech Stack

- [TanStack Start](https://tanstack.com/start) + [TanStack Router](https://tanstack.com/router) · Full-stack React framework
- [PostgreSQL](https://www.postgresql.org/) + [Drizzle ORM](https://orm.drizzle.team/) · Database and type-safe ORM
- [BullMQ](https://docs.bullmq.io/) · Background job processing
- [Better Auth](https://www.better-auth.com/) · Authentication
- [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) · Styling
- [Bun](https://bun.sh/) · Runtime and package manager

<a href="https://github.com/FeaturepoolIO/featurepool/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=FeaturepoolIO/featurepool" alt="Contributors" />
</a>

## License

[AGPL-3.0](LICENSE).

- **Self-hosting** — free and fully functional, no limits
- **Modifications** — if you distribute or run a modified version as a service, open-source your changes under AGPL-3.0

Contributions require signing our [CLA](CLA.md).
