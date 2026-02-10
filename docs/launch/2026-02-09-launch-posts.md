# Launch Posts — 2026-02-09

All social copy for the Quackback launch. Replace placeholders before posting:

- `[BLOG_URL]` → https://quackback.io/blog/welcome
- `[REPO_URL]` → https://github.com/QuackbackIO/quackback
- `[HN_URL]` → Hacker News submission URL (fill after posting)
- `[DOCS_URL]` → https://quackback.io/docs
- `[MCP_DOCS_URL]` → https://quackback.io/docs/mcp

---

## Hacker News (Show HN)

**Title:** Show HN: Quackback – Open-source feedback platform with an MCP server for AI agents

**Body:**

Hi HN, I'm James. I built Quackback, an open-source (AGPL-3.0) customer feedback platform — boards, voting, roadmaps, changelogs, and 23 integrations.

The main differentiator is that AI agents are first-class citizens. Quackback ships with an MCP server (Model Context Protocol) so tools like Claude, Cursor, and Windsurf can search feedback, triage posts, create changelogs, and comment — with scoped API keys and full audit trails via service principals.

Stack: TanStack Start, PostgreSQL + Drizzle, BullMQ, Better Auth, Tailwind v4 + shadcn/ui, Bun.

Self-host with Docker or one-click deploy on Railway. Managed cloud coming soon.

I'd love feedback, especially on the MCP integration — it's early and I'm shaping it based on real usage.

Code: [REPO_URL]
Blog post: [BLOG_URL]
MCP docs: [MCP_DOCS_URL]

---

## Twitter/X Thread

**Tweet 1 (Hook):**
I've been building Quackback for the last 2 months — an open-source feedback platform where AI agents are first-class citizens.

Today it's public. Here's what it does and why it exists. 🧵

**Tweet 2 (Problem):**
Feedback tools haven't changed since 2015. Board, votes, roadmap widget. Meanwhile AI agents write code, triage issues, and plan sprints.

But they can't touch customer feedback. No API. No structured data. No way in.

**Tweet 3 (MCP angle):**
Quackback ships with an MCP server out of the box. Connect Claude, Cursor, or Windsurf and your agent can:

→ Search all feedback
→ Triage posts (status, tags, owners)
→ Write official responses
→ Create changelog entries

Scoped API keys. Service principals. Full audit trail.

**Tweet 4 (Features):**
Beyond the AI stuff, it's a full feedback platform:

• Voting boards with nested comments
• Admin inbox with bulk triage
• Public roadmap
• Changelog
• 23 integrations (Slack, Linear, Jira, GitHub, Intercom, Zendesk…)
• Two-way status sync
• SSO/OIDC

**Tweet 5 (Self-host):**
It's AGPL-3.0 and self-hostable.

```
git clone github.com/QuackbackIO/quackback
bun run setup && bun run dev
```

Or one-click deploy on Railway. PostgreSQL + Redis. That's the whole dependency list.

**Tweet 6 (CTA):**
Try it out:

🔗 [REPO_URL]
📝 [BLOG_URL]
📖 [MCP_DOCS_URL]

If it's useful to you, a GitHub star helps others find it. And I'd really love feedback on the MCP server — it's new territory.

---

## Reddit r/selfhosted

**Title:** Quackback — open-source feedback platform (boards, roadmap, changelog) with Docker and Railway deploy

**Body:**

Hey r/selfhosted, I just open-sourced Quackback, a customer feedback platform I've been building for the last couple of months.

**What it does:** Voting boards, admin inbox, public roadmap, changelogs, 23 integrations (Slack, Linear, Jira, GitHub, etc.), two-way status sync with issue trackers, API + webhooks.

**Self-hosting details:**

- Docker: clone, `docker build`, `docker run`. Done.
- One-click Railway deploy (button in the README)
- Requirements: PostgreSQL + Redis-compatible store
- Stack: TanStack Start (React), Drizzle ORM, BullMQ, Better Auth, Bun runtime
- License: AGPL-3.0

**Bonus:** It ships with an MCP server so AI coding tools (Claude, Cursor, etc.) can search and triage your feedback directly. Scoped API keys with service principals for audit trails.

No telemetry, no phone-home, your data stays in your database.

Repo: [REPO_URL]
Blog post: [BLOG_URL]
Docs: [DOCS_URL]

Happy to answer any questions about the setup or stack.

---

## Reddit r/opensource

**Title:** Quackback: open-source (AGPL-3.0) feedback platform with an MCP server for AI agents

**Body:**

I just released Quackback — an open-source alternative to Canny, UserVoice, and Productboard.

**Why I built it:** Most feedback tools are closed-source, expensive, and lock you into their platform. I wanted something self-hostable where your data stays in your own PostgreSQL database.

**What makes it different:** Quackback ships with a Model Context Protocol (MCP) server. AI agents (Claude, Cursor, Windsurf) can connect and search feedback, triage posts, create changelogs, comment, and vote — with scoped permissions and full audit trails. Agents are first-class citizens, not an afterthought.

**Features:** Voting boards, admin inbox, roadmap, changelog, 23 integrations, two-way sync, SSO/OIDC, API + webhooks, background jobs via BullMQ.

**Stack:** TanStack Start, PostgreSQL + Drizzle ORM, Better Auth, Tailwind v4 + shadcn/ui, Bun.

**License:** AGPL-3.0. Self-host for free. Contributions welcome — check the contributing guide in the repo.

Repo: [REPO_URL]
Blog post: [BLOG_URL]
MCP docs: [MCP_DOCS_URL]

Would love contributions and feedback, especially around the MCP integration.

---

## LinkedIn

I've been building something for the last 2 months, and today it's public.

Quackback is an open-source customer feedback platform — the kind of tool teams use to collect feature requests, share roadmaps, and publish changelogs. Think Canny or UserVoice, but self-hostable and AGPL-3.0 licensed.

The part I'm most excited about: AI agents are first-class citizens.

Quackback ships with an MCP server (Model Context Protocol) so AI coding tools like Claude and Cursor can directly search your feedback, triage posts, assign owners, write official responses, and create changelog entries. Every action is scoped with API keys and attributed to a service principal — so you always know which agent did what.

This isn't a read-only API bolt-on. Agents use the same code paths as the admin dashboard.

The platform itself is production-ready: 23 integrations (Slack, Linear, Jira, GitHub, Intercom, Zendesk, and more), two-way status sync with issue trackers, SSO/OIDC, and a full API with webhooks.

Self-host with Docker or one-click deploy on Railway.

If you're interested in where AI meets product feedback, I'd love to hear your thoughts.

[REPO_URL]
[BLOG_URL]

---

## Dev.to / Hashnode (Technical companion post outline)

**Title:** Building an AI-native feedback platform with TanStack Start and MCP

**Outline:**

1. **Intro** — Why I chose to build a feedback tool from scratch instead of using an existing one. The gap: feedback tools ignore AI agents.

2. **Architecture overview** — TanStack Start + TanStack Router for file-based routing and server functions. Drizzle ORM for type-safe database access. TypeID system for branded entity IDs. Layer-based `lib/` architecture (shared → client → server).

3. **The MCP server** — What MCP is and why it matters for developer tools. How Quackback's MCP server works: 7 tools (search, get_details, triage_post, vote_post, add_comment, create_post, create_changelog). Direct domain service calls, no HTTP self-loop. Scoped permissions and service principals.

4. **Integrations architecture** — 23 integrations with a unified pattern. OAuth handlers, inbound webhook processing, two-way status sync. How we keep integration code isolated per provider.

5. **Auth deep dive** — Better Auth with emailOTP and social providers. Service principals for API keys and integrations. How scoped API keys work.

6. **Self-hosting** — Docker setup, Railway one-click, environment variables. PostgreSQL + Redis as the only dependencies.

7. **Lessons learned** — What worked (TanStack Start, Drizzle, BullMQ). What was harder than expected (integration testing, MCP protocol edge cases).

**CTA:** Link to [REPO_URL], [BLOG_URL], [MCP_DOCS_URL].

---

## Discord / Short-form

**Version 1 (general dev servers):**

Just open-sourced Quackback — a feedback platform (boards, roadmap, changelog, 23 integrations) with a built-in MCP server so AI agents can search and triage your feedback directly.

AGPL-3.0 · Self-host with Docker · [REPO_URL]

**Version 2 (AI/MCP-focused servers):**

Built an open-source feedback platform with a native MCP server. Agents can search posts, triage, comment, vote, and create changelogs — scoped API keys + service principals for audit trails. 7 tools, direct domain service calls.

[REPO_URL] · [MCP_DOCS_URL]

**Version 3 (self-hosting focused servers):**

New self-hosted feedback tool: Quackback. Boards, voting, roadmap, changelog, 23 integrations, SSO/OIDC. PostgreSQL + Redis. Docker or one-click Railway. AGPL-3.0.

[REPO_URL]

---

## Cross-linking map

| Post           | Links to                                     |
| -------------- | -------------------------------------------- |
| Hacker News    | [REPO_URL], [BLOG_URL], [MCP_DOCS_URL]       |
| Twitter thread | [REPO_URL], [BLOG_URL], [MCP_DOCS_URL]       |
| r/selfhosted   | [REPO_URL], [BLOG_URL], [DOCS_URL]           |
| r/opensource   | [REPO_URL], [BLOG_URL], [MCP_DOCS_URL]       |
| LinkedIn       | [REPO_URL], [BLOG_URL]                       |
| Dev.to         | [REPO_URL], [BLOG_URL], [MCP_DOCS_URL]       |
| Discord        | [REPO_URL] (+ [MCP_DOCS_URL] for AI servers) |

After HN is posted, update Twitter tweet 6 and LinkedIn with [HN_URL].

---

## Posting order

1. **GitHub** — Ensure README, screenshot, and docs are current. ✅
2. **Blog post** — Publish at [BLOG_URL]. Verify OG image renders.
3. **Hacker News** — Post Show HN. Note the URL as [HN_URL].
4. **Twitter/X** — Post thread immediately after HN. Add [HN_URL] to final tweet.
5. **Reddit r/selfhosted** — Post 1-2 hours after HN (different audience, minimal overlap).
6. **Reddit r/opensource** — Post 2-3 hours after HN.
7. **LinkedIn** — Post same day, afternoon. Update with [HN_URL] if it gains traction.
8. **Discord servers** — Drop short-form in relevant channels throughout the day.
9. **Dev.to / Hashnode** — Publish technical companion post 2-3 days later (lets the launch settle, gives a second wave of visibility).

**Timing notes:**

- HN sweet spot: Tuesday–Thursday, 8-10am ET
- Avoid posting everything simultaneously — stagger to avoid looking spammy
- Engage with comments on HN and Reddit for the first 2-3 hours
