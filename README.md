<p align="center">
  <a href="https://quackback.io">
    <img src=".github/logo.svg" alt="Quackback Logo" width="80" height="80" />
  </a>
</p>

<h1 align="center">Quackback</h1>

<p align="center">
  <strong>The open-source customer feedback platform.</strong>
</p>

<p align="center">
  Collect, organize, and act on user feedback with public boards, roadmaps, and changelogs.
</p>

<p align="center">
  <a href="https://quackback.io">Website</a> •
  <a href="#features">Features</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#self-hosting">Self-Hosting</a> •
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-BSL--1.1-blue" alt="License" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome" />
</p>

<br />

<p align="center">
  <img src=".github/screenshot.png" alt="Quackback Screenshot" width="100%" />
</p>

---

## Why Quackback?

The open-source alternative to Canny, UserVoice, and Productboard. Own your data, self-host anywhere, and customize everything.

## Features

**Feedback Portal** — Public boards, voting, status tracking, nested comments with reactions, official responses

**Admin Inbox** — Unified view, powerful filtering, team assignment, tags, bulk actions

**Roadmap & Changelog** — Public roadmap, release announcements, board-specific views

**Team Management** — Multi-organization, role-based access (Owner/Admin/Member), SSO with GitHub & Google

**Integrations** _(coming soon)_ — Slack, Intercom, Zendesk, Jira, Linear, Zapier

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.3.3+ (or Node.js 20+)
- [Docker](https://docker.com/) (for PostgreSQL)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/your-org/quackback.git
cd quackback

# Run setup (installs deps, starts DB, configures env)
bun run setup

# Start the development server
bun run dev
```

Open [http://app.quackback.localhost:3000](http://app.quackback.localhost:3000)

### Demo Account

After running `bun run db:seed`, log in with `demo@example.com` / `demo1234` and visit [acme.quackback.localhost:3000](http://acme.quackback.localhost:3000).

## Self-Hosting

Deploy anywhere that runs Node.js. Requires PostgreSQL 14+ and a reverse proxy for subdomain routing.

```bash
# 1. Set up PostgreSQL and configure .env
# 2. Push schema and build
bun run db:push
bun run build

# 3. Start the server
bun run start
```

See [Self-Hosting Guide](docs/self-hosting.md) for detailed instructions.

## Roadmap

- [x] Public feedback boards with voting
- [x] Admin inbox with filtering
- [x] Nested comments with reactions
- [x] Multi-organization support
- [x] Official responses
- [ ] Public changelog
- [ ] Email notifications
- [ ] Slack integration
- [ ] Intercom / Zendesk integration
- [ ] Jira / Linear integration
- [ ] Zapier integration
- [ ] Webhooks & API keys
- [ ] Custom domains per organization
- [ ] SSO (Okta, Azure AD)

## Contributing

We welcome contributions! See our [Contributing Guide](CONTRIBUTING.md) for details.

- [GitHub Discussions](https://github.com/your-org/quackback/discussions) — Questions & ideas
- [Discord](https://discord.gg/quackback) — Chat with the community

## License

Quackback is licensed under the [Business Source License 1.1](LICENSE.md).

**TL;DR:** You can use Quackback freely for internal feedback management. For commercial use (selling as a service), please contact us for a commercial license.

The license converts to Apache 2.0 after 4 years.

## Tech Stack

Next.js 16 • PostgreSQL • Drizzle ORM • Better Auth • Tailwind CSS • shadcn/ui • Bun

---

<p align="center">
  <sub>Built with 🦆 by the Quackback team</sub>
</p>
