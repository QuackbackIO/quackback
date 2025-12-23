# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Quackback is an open-source customer feedback platform. Collect, organize, and act on user feedback with public boards, roadmaps, and changelogs.

**License**: AGPL-3.0 (core), proprietary (ee/)

## Quick Start

```bash
bun run setup    # One-time setup
bun run dev      # Start dev server
```

Open http://localhost:3000

## Tech Stack

| Layer             | Technology                       |
| ----------------- | -------------------------------- |
| **Framework**     | Next.js 16 (App Router)          |
| **Database**      | PostgreSQL with Drizzle ORM      |
| **Auth**          | Better-auth with emailOTP plugin |
| **Runtime**       | Bun 1.3.3+                       |
| **Styling**       | Tailwind CSS v4                  |
| **UI Components** | shadcn/ui                        |
| **Testing**       | Vitest                           |
| **Validation**    | Zod                              |

## Commands

```bash
# Development
bun run dev           # Start dev server (auto-migrates)
bun run build         # Build for production
bun run lint          # Run ESLint
bun run test          # Run all Vitest tests
bun run test <file>   # Run single test (e.g., bun run test packages/db/src/foo.test.ts)

# Database
bun run db:generate   # Generate migrations from schema changes
bun run db:migrate    # Run migrations
bun run db:studio     # Open Drizzle Studio
bun run db:seed       # Seed demo data
bun run db:reset      # Reset database (destructive)
```

## Architecture

Quackback follows a **modular monolith** architecture:

```
apps/web/           # Next.js app (API routes, pages, components)
├── app/            # App Router (route groups below)
└── lib/            # Utilities, auth config

packages/
├── db/             # Drizzle schema, migrations, repositories, Unit of Work
├── domain/         # Business logic services with Result<T,E> error handling
├── ids/            # TypeID system (branded UUIDs: post_xxx, board_xxx)
├── email/          # Email service (Resend)
├── integrations/   # GitHub, Slack, Discord
└── shared/         # Types, constants, utilities

ee/                 # Enterprise features (SSO, SCIM) - proprietary license
```

### Service Layer (`packages/domain/`)

Services return `Result<T, E>` for type-safe error handling:

```typescript
import { ok, err, type Result } from '@quackback/domain'

async createPost(input: CreatePostInput, ctx: ServiceContext): Promise<Result<Post, PostError>> {
  if (!input.title?.trim()) {
    return err(PostError.validationError('Title is required'))
  }
  return withUnitOfWork(async (uow) => {
    const post = await uow.posts.create({...})
    return ok(post)
  })
}
```

### Unit of Work (`packages/db/`)

Database transactions use the Unit of Work pattern with lazy-loaded repositories:

```typescript
import { withUnitOfWork } from '@quackback/db'

const result = await withUnitOfWork(async (uow) => {
  const post = await uow.posts.findById(postId)
  await uow.votes.create({ postId, userId })
  return post
})
```

### API Routes (`apps/web/app/api/`)

Use `withApiHandler` for auth, role checking, and error handling:

```typescript
import {
  withApiHandler,
  validateBody,
  successResponse,
  buildServiceContext,
} from '@/lib/api-handler'

export const POST = withApiHandler(
  async (request, { validation }) => {
    const body = await request.json()
    const input = validateBody(schema, body)
    const ctx = buildServiceContext(validation)
    const result = await getPostService().createPost(input, ctx)
    if (!result.success) throw new ApiError(result.error.message, 400)
    return successResponse(result.value, 201)
  },
  { roles: ['owner', 'admin'] }
)
```

### TypeIDs (`packages/ids/`)

All entities use branded TypeIDs (UUIDv7 with prefix): `post_01h455vb4pex5vsknk084sn02q`

```typescript
import { createId, parseId } from '@quackback/ids'
const postId = createId('post') // => PostId (branded type)
const parsed = parseId('post_xxx', 'post') // validates and returns PostId
```

## App Route Groups

Routes in `apps/web/app/`:

- `(portal)/` - Public portal (feedback boards, roadmap)
- `(auth)/` - Portal user auth
- `(admin-auth)/` - Team member auth
- `admin/` - Admin dashboard (requires team role)
- `api/` - API routes

## Workspace Model

Single-tenant: one workspace per installation.

- Roles: `owner` > `admin` > `member` > `user` (portal users)
- Fresh installs show onboarding wizard

## Key Conventions

- **Files**: kebab-case (`user-profile.tsx`)
- **Components**: PascalCase (`UserProfile`)
- **Functions**: camelCase (`getUserProfile`)
- **Database tables**: snake_case (`feedback_items`)
- **Server Components by default**, `'use client'` only when needed

## Auth Context

```typescript
// Require authenticated user
const { session, user } = await requireAuth()

// Require team member role
const { settings, member } = await requireTenantRole(['owner', 'admin'])
```

## Environment Variables

See `.env.example`. Key ones: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ROOT_URL`

## Demo Credentials

After `bun run db:seed`: Email `demo@example.com` (OTP code logged to console)

## Git Commits

- Never add co-author trailers to commits
