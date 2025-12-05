# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Quackback is an open-source customer feedback platform. Collect, organize, and act on user feedback with public boards, roadmaps, and changelogs.

**License**: BSL-1.1 (Business Source License)

## Quick Start

```bash
bun run setup    # One-time setup
bun run dev      # Start dev server
```

Open http://localhost:3000

## Tech Stack

| Layer             | Technology                                     |
| ----------------- | ---------------------------------------------- |
| **Framework**     | Next.js 16 (App Router)                        |
| **Database**      | PostgreSQL with Drizzle ORM                    |
| **Auth**          | Better-auth with organizations plugin          |
| **Multi-tenancy** | Subdomain-based with Better-auth organizations |
| **Runtime**       | Bun 1.3.3+                                     |
| **Styling**       | Tailwind CSS v4                                |
| **UI Components** | shadcn/ui                                      |
| **Testing**       | Vitest                                         |
| **Validation**    | Zod                                            |

## Repository Structure

```
quackback/
├── apps/web/              # Next.js application
│   ├── app/               # App Router pages and API routes
│   ├── components/        # UI and feature components
│   └── lib/               # Utilities, auth config
├── packages/
│   ├── db/                # Drizzle schema, migrations, queries
│   ├── domain/            # Business logic
│   ├── email/             # Email service (Resend)
│   ├── integrations/      # GitHub, Slack, Discord
│   └── shared/            # Types, constants, utilities
├── scripts/               # Development scripts
└── docker-compose.yml     # Local PostgreSQL
```

## Multi-tenancy Model

- Uses **Better-auth organizations plugin** with full tenant isolation
- **Main domain**: `localhost:3000` (dev) / `quackback.io` (prod)
- **Tenant subdomains**: `{org-slug}.localhost:3000` (dev) / `{org-slug}.quackback.io` (prod)
- **Domain resolution**: Uses `workspace_domain` table to map domains to organizations (supports custom domains)
- Users are scoped to a single organization (`organizationId` on user table)
- Per-subdomain session cookies (no cross-subdomain session sharing)
- OAuth flows through main domain with one-time DB token transfer via `trustLogin` plugin
- Data tables reference `organization_id` for isolation
- Team roles: `owner` > `admin` > `member`; Portal users have role `user`

## Next.js 16 Notes

- Uses `proxy.ts` instead of `middleware.ts` (Next.js 16 feature)
- The proxy handles route protection and redirects
- Domain-to-organization resolution happens in `lib/tenant.ts` via database lookup

## Commands

```bash
# Development
bun run dev           # Start dev server (auto-migrates)
bun run build         # Build for production
bun run lint          # Run ESLint
bun run test          # Run all Vitest tests
bun run test <file>   # Run single test file (e.g., bun run test packages/db/src/foo.test.ts)

# Database
bun run db:push       # Push schema to database
bun run db:generate   # Generate migrations
bun run db:migrate    # Run migrations
bun run db:studio     # Open Drizzle Studio
bun run db:seed       # Seed demo data
bun run db:reset      # Reset database (destructive)
bun run reset         # Reset + push + seed (full reset)
```

## Key Conventions

- **Files**: kebab-case (`user-profile.tsx`)
- **Components**: PascalCase (`UserProfile`)
- **Functions**: camelCase (`getUserProfile`)
- **Database tables**: snake_case (`feedback_items`)
- **Multi-tenancy**: `organization_id` on all data tables
- **Server Components by default**, `'use client'` only when needed

## App Route Groups

Routes in `apps/web/app/` are organized by route groups:

- `(main)/` - Main domain routes (landing, create-workspace, accept-invitation)
- `(tenant)/` - Tenant subdomain routes
  - `(public)/` - Public portal (feedback boards, roadmap)
  - `admin/` - Admin dashboard (requires team role)
  - `onboarding/` - User onboarding flow
- `(auth)/` - Auth-related pages
- `api/` - API routes (public and authenticated)

## Database Notes

- Drizzle ORM for type-safe database access
- Better-auth tables: `user`, `session`, `account`, `organization`, `member`, `invitation`
- Application tables: `boards`, `posts`, `comments`, `votes`, `tags`, `roadmaps`, `changelog_entries`, `statuses`
- RLS policies use `app.organization_id` session variable for tenant isolation

## RLS and Tenant Context

Database queries requiring tenant isolation use `withTenantContext` or `withAuthenticatedTenant`:

```typescript
// In API routes - validates auth and sets RLS context
const result = await withApiTenantContext(organizationId, async ({ db }) => {
  return db.query.posts.findMany() // RLS auto-filters by org
})

// In server components - redirects on auth failure
const { withRLS } = await requireAuthenticatedTenant()
const posts = await withRLS((db) => db.query.posts.findMany())
```

The tenant context (`packages/db/src/tenant-context.ts`) sets PostgreSQL session variables and switches to the `app_user` role for RLS policy enforcement.

## Environment Variables

See `.env.example` for all available variables. Key ones:

| Variable              | Description                           |
| --------------------- | ------------------------------------- |
| `DATABASE_URL`        | PostgreSQL connection string          |
| `BETTER_AUTH_SECRET`  | Auth secret (auto-generated by setup) |
| `NEXT_PUBLIC_APP_URL` | Public app URL                        |

## Local Development

The app uses `*.localhost` subdomains which resolve automatically in modern browsers:

- Main app: `http://localhost:3000`
- Tenant portals: `http://{org-slug}.localhost:3000`

## Demo Credentials

After running `bun run db:seed`:

- Email: `demo@example.com`
- Password: `demo1234`
- Organization: Acme Corp (`http://acme.localhost:3000`)

## Git Commits

- Never add co-author trailers to commits
