# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **pre-implementation planning repository** for Quackback, an open-source customer feedback platform. The repository contains work package prompts and implementation plans - no code has been written yet.

**Project**: Quackback
**License**: BSL-1.1 (Business Source License)

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Next.js 16 (App Router) |
| **Database** | PostgreSQL with Drizzle ORM |
| **Auth** | Better-auth with organizations plugin |
| **Multi-tenancy** | Better-auth organizations (teams/orgs) |
| **Runtime** | Bun 1.3.3+ |
| **Package Manager** | Bun |
| **Styling** | Tailwind CSS |
| **Testing** | Vitest, Playwright |
| **Validation** | Zod |

## Multi-tenancy Model

- Uses **Better-auth organizations plugin** for multi-tenancy
- Users can belong to multiple organizations
- Each organization is a separate tenant with isolated data
- Data tables reference `organization_id` from Better-auth
- Roles: `owner` > `admin` > `member`

## Repository Structure

```
IMPLEMENTATION_PLAN.md      # Master plan with 10 consolidated work packages
AGENT_ALLOCATION.md         # Agent assignments and execution strategy
AGENT_PROMPTS/              # Detailed prompts for each work package (WP-01 to WP-10)
```

## Work Packages (10 Total)

| ID | Name | Dependencies |
|----|------|--------------|
| WP-01 | Project Initialization | None |
| WP-02 | Database Schema (Drizzle ORM) | WP-01 |
| WP-03 | Authentication (Better-auth + orgs) | WP-01, WP-02 |
| WP-04 | Dashboard Layout | WP-03 |
| WP-05 | Feedback CRUD | WP-02, WP-04 |
| WP-06 | Public Features (Board, Roadmap, Changelog) | WP-05 |
| WP-07 | Integrations (GitHub, Slack, Discord) | WP-05 |
| WP-08 | Embeddable Widget | WP-05 |
| WP-09 | Docker Deployment | All |
| WP-10 | Monitoring & Documentation | All |

## Using Work Packages

Each work package in `AGENT_PROMPTS/` is a self-contained implementation prompt containing:
- Overview and dependencies
- Acceptance criteria checklist
- Files to create with paths
- Implementation code snippets
- Testing checklists

**To implement a work package**: Read the corresponding `WP-XX-*.md` file and follow its instructions. Check dependencies in `AGENT_ALLOCATION.md` before starting.

## Target Architecture (Post-Implementation)

```
quackback/
├── apps/web/              # Next.js application
│   ├── app/               # App Router (auth, dashboard, public, api routes)
│   ├── components/        # UI, forms, feature components
│   └── lib/               # Utilities, auth, monitoring
├── packages/
│   ├── db/                # Drizzle schema, migrations, queries
│   ├── integrations/      # GitHub, Slack, Discord
│   ├── widget/            # Embeddable feedback widget
│   └── shared/            # Types, constants, utilities
└── docker/                # Docker deployment configs
```

## Key Conventions

- **Files**: kebab-case (`user-profile.tsx`)
- **Components**: PascalCase (`UserProfile`)
- **Functions**: camelCase (`getUserProfile`)
- **Database tables**: snake_case (`feedback_items`)
- **Multi-tenancy**: `organization_id` on all data tables (from Better-auth)
- **Server Components by default**, `'use client'` only when needed

## Database Notes

- Drizzle ORM for type-safe database access
- Better-auth creates its own tables: `user`, `session`, `account`, `organization`, `member`, `invitation`
- Application tables reference `organization_id` for data isolation
- No RLS needed - Drizzle queries filter by organization

## Commands (After WP-01 Implementation)

```bash
bun install           # Install dependencies
bun run dev           # Start development server
bun run build         # Build for production
bun run lint          # Run ESLint
bun run test          # Run Vitest tests
bun run db:generate   # Generate Drizzle migrations
bun run db:migrate    # Run migrations
bun run db:studio     # Open Drizzle Studio
```
