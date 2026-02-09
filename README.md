<p align="center">
  <a href="https://quackback.io">
    <img src=".github/logo.svg" alt="Quackback Logo" width="80" height="80" />
  </a>
</p>

<h1 align="center">Quackback</h1>

<p align="center">
  <strong>The open-source alternative to Canny, UserVoice, and Productboard.</strong>
</p>

<p align="center">
  Collect, organize, and act on customer feedback with voting boards, roadmaps, and changelogs.<br />
  Self-host for free. Managed cloud coming soon.
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

**Self-Hosted** anywhere with [Docker](#self-hosted) or [one click on Railway](#one-click-deploy).

## Why Quackback?

Most feedback tools are expensive, closed-source, and lock you into their platform. Quackback gives you a modern feedback system you actually own.

- **Self-host for free.** Run it on your own infrastructure. Managed cloud coming soon.
- **Own your data.** No vendor lock-in. Your feedback lives in your PostgreSQL database.
- **AI-native.** Built-in [MCP server](https://quackback.io/docs/mcp) lets AI agents search, triage, and act on feedback directly.
- **14 integrations.** Slack, Linear, Jira, GitHub, Intercom, Zendesk, and more out of the box.

## Features

- **Feedback Boards.** Public voting, status tracking, nested comments, reactions, and official responses.
- **Admin Inbox.** Unified triage view with filtering, bulk actions, and automatic deduplication.
- **Roadmap.** Show users what you're planning, working on, and what's shipped.
- **Changelog.** Publish updates and keep users in the loop.
- **Integrations.** Sync feedback with Slack, Linear, Jira, GitHub, Asana, ClickUp, Intercom, Zendesk, HubSpot, Discord, Teams, Shortcut, Azure DevOps, and Zapier.
- **Inbound Webhooks.** Two-way status sync with your issue tracker.
- **API & Webhooks.** API keys and outbound webhooks for custom workflows.
- **MCP Server.** Let AI agents (Claude, Cursor, etc.) interact with your feedback data via the [Model Context Protocol](https://quackback.io/docs/mcp).

## Tech Stack

- [TanStack Start](https://tanstack.com/start) + [TanStack Router](https://tanstack.com/router) · Full-stack React framework
- [PostgreSQL](https://www.postgresql.org/) + [Drizzle ORM](https://orm.drizzle.team/) · Database and type-safe ORM
- [BullMQ](https://docs.bullmq.io/) · Background job processing
- [Better Auth](https://www.better-auth.com/) · Authentication
- [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) · Styling
- [Bun](https://bun.sh/) · Runtime and package manager

## Self-Hosted

### One-Click Deploy

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/bcnu9a)

### Docker

```bash
git clone https://github.com/QuackbackIO/quackback.git
cd quackback
cp .env.example .env   # Edit with your configuration
docker build -t quackback .
docker run -p 3000:3000 --env-file .env quackback
```

Requires PostgreSQL and a Redis-compatible store. Set `DATABASE_URL` and `REDIS_URL` in `.env`.

### Local Development

Prerequisites: [Bun](https://bun.sh/) v1.3.4+ and [Docker](https://docker.com/)

```bash
git clone https://github.com/QuackbackIO/quackback.git
cd quackback
bun run setup    # Install deps, start Docker, run migrations, seed data
bun run dev      # http://localhost:3000
```

Log in with `demo@example.com` (OTP code appears in the console).

## Contributing

We'd love your help making Quackback better. See the [Contributing Guide](CONTRIBUTING.md) to get started.

- [GitHub Discussions](https://github.com/QuackbackIO/quackback/discussions) · Ask questions, share ideas

<a href="https://github.com/QuackbackIO/quackback/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=QuackbackIO/quackback" alt="Contributors" />
</a>

## License

Quackback is licensed under [AGPL-3.0](LICENSE).

- **Self-hosting**: Free and fully functional forever
- **Modifications**: If you distribute or run a modified version as a service, you must open-source your changes under AGPL-3.0

Contributions require signing our [CLA](CLA.md).

---

<p align="center">
  <sub>If Quackback is useful to you, consider giving it a star. It helps others discover the project.</sub>
</p>
