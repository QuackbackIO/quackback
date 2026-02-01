# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Quackback is an open-source customer feedback platform. Collect, organize, and act on user feedback with public boards, roadmaps, and changelogs.

**License**: AGPL-3.0 (core), proprietary (ee/)

## Quick Start

```bash
bun run setup    # One-time setup (deps, Docker, migrations, seed)
bun run dev      # Start dev server at http://localhost:3000
```

Login: `demo@example.com` (OTP code appears in console)

## Commands

```bash
# Development
bun run dev              # Start dev server (self-hosted mode)
bun run dev:cloud        # Start in cloud multi-tenant mode
bun run build            # Build for production

# Database
bun run db:generate      # Generate migrations from schema changes
bun run db:migrate       # Run pending migrations
bun run db:studio        # Open Drizzle Studio
bun run db:seed          # Seed demo data
bun run db:reset         # Reset database (destructive)

# Testing
bun run test             # Run Vitest tests
bun run test <file>      # Run single test file
bun run test:e2e         # Run Playwright E2E tests
bun run test:e2e:ui      # E2E with interactive UI
bun run test:e2e:headed  # E2E in headed browser

# Code Quality
bun run lint             # ESLint + Prettier checks
bun run typecheck        # TypeScript type checking (in apps/web)
```

## Tech Stack

| Layer      | Technology                                    |
| ---------- | --------------------------------------------- |
| Framework  | TanStack Start + TanStack Router (file-based) |
| Database   | PostgreSQL + Drizzle ORM                      |
| Auth       | Better Auth with emailOTP plugin              |
| Runtime    | Bun 1.3.7+                                    |
| Styling    | Tailwind CSS v4 + shadcn/ui                   |
| Validation | Zod                                           |
| State      | TanStack Query (server) + Zustand (client)    |

## Architecture

```
apps/web/                    # TanStack Start application
├── src/routes/              # File-based routing (TanStack Router)
├── src/components/          # UI and feature components
├── src/lib/                 # Core utilities (layer-based architecture)
│   ├── core/                # Infrastructure (db, types)
│   ├── types/               # Shared type definitions
│   ├── server-functions/    # TanStack server functions (RPC)
│   ├── hooks/               # React Query hooks (queries only)
│   ├── mutations/           # React Query mutations
│   ├── events/              # Event dispatch & handlers
│   ├── stores/              # Zustand client state
│   ├── posts/               # Post service modules
│   ├── comments/            # Comment service & types
│   ├── auth/                # Better Auth configuration
│   ├── tenant/              # Multi-tenant context
│   └── settings/            # Workspace settings

packages/                    # Shared packages (AGPL-3.0)
├── db/                      # Drizzle schema, migrations, seed
├── ids/                     # TypeID system (branded UUIDs)
├── email/                   # Email service (Resend + React Email)
└── integrations/            # Slack integration

ee/packages/                 # Enterprise Edition (proprietary)
├── sso/                     # SSO/SAML authentication
├── scim/                    # SCIM user provisioning
└── audit/                   # Audit logging
```

### Route Groups (TanStack Router)

- `_portal/` - Public feedback portal (boards, posts)
- `admin/` - Admin dashboard (inbox, roadmap, settings)
- `auth.*` - Portal user authentication
- `admin.login/signup` - Team member authentication
- `api/` - API routes

### Server Functions Pattern

Server functions use `createServerFn` from TanStack Start:

```typescript
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'

const schema = z.object({ title: z.string().min(1) })

export const createPostFn = createServerFn({ method: 'POST' })
  .validator(schema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin', 'member'] })
    return createPost(data, auth.member)
  })
```

### lib/ Layer Architecture

The `lib/` directory follows a layer-based architecture with clear responsibilities:

| Layer               | Purpose                          | Import Direction                 |
| ------------------- | -------------------------------- | -------------------------------- |
| `core/`             | Infrastructure (db, config)      | Can import from packages/        |
| `types/`            | Shared type definitions          | Can import from core/            |
| `server-functions/` | TanStack RPC layer               | Can import from services, types  |
| `hooks/`            | React Query hooks (queries only) | Can import from server-functions |
| `mutations/`        | React Query mutations            | Can import from server-functions |
| `events/`           | Event dispatch & handlers        | Can import from services         |
| `stores/`           | Zustand client state             | Can import from types            |
| `{feature}/`        | Business logic services          | Can import from core/, types/    |

**Key conventions**:

- Hooks: `use-{feature}-query.ts` for queries, mutations in `mutations/`
- Services: Split by domain (`post.service.ts`, `post.query.ts`, `post.voting.ts`)
- Import direction: lib/ never imports from components/
- No file should exceed 400 lines (services) or 300 lines (hooks)

### Service Layer

Services in `src/lib/{feature}/` throw typed errors:

```typescript
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/shared/errors'

export async function createPost(input: CreatePostInput, author: Author) {
  if (!input.title?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Title is required')
  }
  // ... business logic
}
```

### Database Access

Always import from `@/lib/db`, not `@quackback/db`:

```typescript
import { db, posts, eq, and, desc } from '@/lib/db'

const post = await db.query.posts.findFirst({
  where: eq(posts.id, postId),
  with: { board: true, status: true },
})
```

The `db` export is a proxy that handles:

- Self-hosted: Singleton postgres.js connection
- Cloud: Tenant DB from AsyncLocalStorage context

### TypeIDs

All entities use branded TypeIDs: `post_01h455vb4pex5vsknk084sn02q`

```typescript
import { createId, toUuid, type PostId, type BoardId } from '@quackback/ids'

const postId = createId('post') // => PostId (branded type)
const uuid = toUuid(postId) // => raw UUID string
```

### Multi-Tenancy (Cloud vs Self-Hosted)

- **Self-hosted**: Single workspace, `DATABASE_URL` singleton
- **Cloud**: Multi-tenant via domain resolution
  - `server.ts` resolves tenant from request domain
  - Tenant context stored in `AsyncLocalStorage`
  - Per-tenant Neon databases

Build variants controlled by env vars:

- `EDITION=self-hosted|cloud`
- `INCLUDE_EE=true|false`

## Auth Context

```typescript
// Require authenticated team member with role check
const auth = await requireAuth({ roles: ['admin', 'member'] })
// auth.user, auth.member, auth.settings

// Just require authentication
const auth = await requireAuth()
```

## Environment Variables

Key variables (see `.env.example`):

- `DATABASE_URL` - PostgreSQL connection string
- `BETTER_AUTH_SECRET` - Auth secret (32+ chars)
- `BETTER_AUTH_URL` - Auth callback URL
- `ROOT_URL` - Public instance URL

## Conventions

- **Files**: kebab-case (`user-profile.tsx`)
- **Components**: PascalCase (`UserProfile`)
- **Functions**: camelCase (`getUserProfile`)
- **Database**: snake_case (`post_tags`)
- Use React Server Components by default, `'use client'` only when needed

## Git Commits

- Never add co-author trailers to commits
