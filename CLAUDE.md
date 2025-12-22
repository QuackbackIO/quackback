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
| **Auth**          | Better-auth with emailOTP plugin               |
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

## Workspace Model

Quackback uses a single-workspace model:

- One workspace per installation
- Team members have roles: `owner` > `admin` > `member`
- Portal users (public feedback submitters) have role `user`
- Fresh installations show an onboarding wizard to create the owner account and workspace

## Next.js 16 Notes

- Uses `proxy.ts` instead of `middleware.ts` (Next.js 16 feature)
- The proxy handles route protection and redirects

## Commands

```bash
# Development
bun run dev           # Start dev server (auto-migrates)
bun run build         # Build for production (Node.js)
bun run lint          # Run ESLint
bun run test          # Run all Vitest tests
bun run test <file>   # Run single test file (e.g., bun run test packages/db/src/foo.test.ts)

# Database
bun run db:generate   # Generate migrations from schema changes
bun run db:migrate    # Run migrations (creates tables)
bun run db:studio     # Open Drizzle Studio
bun run db:seed       # Seed demo data (requires migrations first)
bun run db:reset      # Reset database (destructive, then run db:migrate)

# Cloudflare Workers Deployment
cd apps/web
bun run build:cf      # Build for Cloudflare Workers
bun run preview:cf    # Build and preview locally with wrangler
bun run deploy:cf     # Build and deploy to Cloudflare
```

## Deployment

Single-tenant deployment using standard Next.js:

```bash
DATABASE_URL="postgresql://..."          # PostgreSQL connection
ROOT_URL="https://your-domain.com"       # Required for absolute URLs (emails, OAuth)
BETTER_AUTH_SECRET="..."                 # Auth secret (generate with: openssl rand -base64 32)
BETTER_AUTH_URL="https://your-domain.com"
```

- Uses standard `next build` output
- Deploy via Docker, Vercel, or any Node.js host
- On first visit, you'll be guided through onboarding to create your account and workspace

## Key Conventions

- **Files**: kebab-case (`user-profile.tsx`)
- **Components**: PascalCase (`UserProfile`)
- **Functions**: camelCase (`getUserProfile`)
- **Database tables**: snake_case (`feedback_items`)
- **Server Components by default**, `'use client'` only when needed

## App Route Groups

Routes in `apps/web/app/` are organized by route groups:

- `(portal)/` - Public portal (feedback boards, roadmap)
- `(auth)/` - Portal user auth (login, signup)
- `(admin-auth)/` - Team member auth (admin login/signup)
- `admin/` - Admin dashboard (requires team role)
- `onboarding/` - User onboarding flow
- `settings/` - User settings
- `api/` - API routes

## Database Notes

- Drizzle ORM for type-safe database access
- Better-auth tables: `user`, `session`, `account`, `settings`, `member`, `invitation`
- Application tables: `boards`, `posts`, `comments`, `votes`, `tags`, `roadmaps`, `changelog_entries`, `statuses`

## Auth and Tenant Context

Database queries use `requireAuth` or `requireTenantRole` helpers:

```typescript
// Require authenticated user
const { session, user } = await requireAuth()

// Require team member role
const { settings, member } = await requireTenantRole(['owner', 'admin'])
```

## Environment Variables

See `.env.example` for all available variables. Key ones:

| Variable              | Description                           |
| --------------------- | ------------------------------------- |
| `DATABASE_URL`        | PostgreSQL connection string          |
| `BETTER_AUTH_SECRET`  | Auth secret (generate with openssl)   |
| `BETTER_AUTH_URL`     | Base URL for auth (same as ROOT_URL)  |
| `ROOT_URL`            | Public app URL (for emails, OAuth)    |

## Local Development

- Main app: `http://localhost:3000`

## Demo Credentials

After running `bun run db:seed`:

- Email: `demo@example.com`
- Uses email OTP authentication (code sent to email, logged to console in dev)

## Git Commits

- Never add co-author trailers to commits
