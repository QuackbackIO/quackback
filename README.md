<p align="center">
  <a href="https://quackback.io">
    <img src=".github/logo.svg" alt="Quackback Logo" width="80" height="80" />
  </a>
</p>

<h1 align="center">Quackback</h1>

<p align="center">
  <strong>Open source feedback for teams that ship.</strong>
</p>

<p align="center">
  The open-source alternative to Canny, UserVoice, and Productboard.<br />
  Collect feedback. Prioritize what matters. Close the loop.
</p>

<p align="center">
  <a href="https://quackback.io">Website</a> &middot;
  <a href="https://quackback.io/docs">Docs</a> &middot;
  <a href="#get-started">Get Started</a>
</p>

<p align="center">
  <a href="https://github.com/QuackbackIO/quackback/stargazers"><img src="https://img.shields.io/github/stars/QuackbackIO/quackback?style=flat&color=f5a623" alt="GitHub stars" /></a>
  <a href="https://github.com/QuackbackIO/quackback/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License" /></a>
  <a href="https://github.com/QuackbackIO/quackback/actions"><img src="https://img.shields.io/github/actions/workflow/status/QuackbackIO/quackback/ci.yml?label=CI" alt="CI" /></a>
  <a href="https://github.com/QuackbackIO/quackback/issues"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome" /></a>
</p>

<p align="center">
  <img src=".github/screenshot.png" alt="Quackback feedback portal" width="800" />
</p>

## Get Started

**Cloud** coming soon at [quackback.io](https://quackback.io). Join the waitlist.

**Self-hosted** anywhere with [Docker](#docker) or [one click on Railway](#one-click-deploy).

## Why Quackback?

Most feedback tools are expensive, closed-source, and lock you in. Quackback gives you a modern feedback system you actually own.

- **Self-host for free.** Run on your own infrastructure. No per-seat pricing.
- **Own your data.** Your feedback lives in your PostgreSQL database. No vendor lock-in.
- **AI-powered.** Automatic duplicate detection, AI summaries, and a 17-tool [MCP server](https://quackback.io/docs/mcp) that lets AI agents search, triage, and act on feedback directly.
- **24 integrations.** Slack, Linear, Jira, GitHub, Intercom, Zendesk, and [more](#integrations) out of the box.

## Features

- **Feedback boards.** Public voting, status tracking, nested comments, reactions, and comment locking.
- **AI duplicate detection.** Automatically finds duplicate posts using hybrid vector + full-text search and suggests which to merge.
- **AI summaries.** Key quotes, suggested next steps, and staleness detection on feedback posts.
- **Embeddable widget.** Drop a script tag into your app and collect feedback without leaving the page.
- **Admin inbox.** Unified triage view with filtering, bulk actions, and soft delete with 30-day restore.
- **Roadmap.** Show users what you're planning, working on, and what's shipped.
- **Changelog.** Publish updates, schedule for later, and close the loop when features ship.
- **Integrations.** [24 integrations](#integrations) including two-way status sync with your issue tracker via inbound webhooks.
- **API & webhooks.** REST API, API keys, and outbound webhooks for custom workflows.
- **MCP server.** 17 tools for AI agents to search, triage, comment, merge posts, manage roadmaps, and publish changelogs via the [Model Context Protocol](https://quackback.io/docs/mcp). Supports API key and OAuth 2.1 authentication.
- **Flexible auth.** Password, email OTP, OAuth social logins (Google, GitHub), and custom OIDC providers (Okta, Auth0, Keycloak).
- **SEO-ready.** Auto-generated sitemap, Open Graph and Twitter Card meta tags, and robots.txt on every portal page.

## Integrations

Slack, Linear, Jira, GitHub, GitLab, Asana, ClickUp, Monday, Trello, Notion, Shortcut, Azure DevOps, Intercom, Zendesk, Freshdesk, HubSpot, Salesforce, Stripe, Discord, Teams, Segment, Zapier, Make, and n8n.

## Tech Stack

- [TanStack Start](https://tanstack.com/start) + [TanStack Router](https://tanstack.com/router) · Full-stack React framework
- [PostgreSQL](https://www.postgresql.org/) + [Drizzle ORM](https://orm.drizzle.team/) · Database and type-safe ORM
- [BullMQ](https://docs.bullmq.io/) · Background job processing
- [Better Auth](https://www.better-auth.com/) · Authentication
- [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) · Styling
- [Bun](https://bun.sh/) · Runtime and package manager

## Self-Hosted

### One-Click Deploy

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/quackback?referralCode=ez8Slg&utm_source=github&utm_medium=readme&utm_campaign=deploy-button)

### Docker

```bash
git clone https://github.com/QuackbackIO/quackback.git
cd quackback
cp .env.example .env   # Edit with your configuration
docker build -t quackback -f apps/web/Dockerfile .
docker run -p 3000:3000 --env-file .env quackback
```

Requires PostgreSQL and a Redis-compatible store. Set `DATABASE_URL` and `REDIS_URL` in `.env`. Migrations run automatically on startup.

### Local Development

Prerequisites: [Bun](https://bun.sh/) v1.3.7+ and [Docker](https://docker.com/)

```bash
git clone https://github.com/QuackbackIO/quackback.git
cd quackback
bun run setup    # Install deps, start Docker, run migrations
bun run db:seed  # Optional: seed demo data
bun run dev      # http://localhost:3000
```

Log in with `demo@example.com` / `password`.

## Contributing

See the [Contributing Guide](CONTRIBUTING.md) to get started.

- [GitHub Discussions](https://github.com/QuackbackIO/quackback/discussions) — ask questions, share ideas

<a href="https://github.com/QuackbackIO/quackback/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=QuackbackIO/quackback" alt="Contributors" />
</a>

## License

[AGPL-3.0](LICENSE).

- **Self-hosting** — free and fully functional, no limits
- **Modifications** — if you distribute or run a modified version as a service, open-source your changes under AGPL-3.0

Contributions require signing our [CLA](CLA.md).
