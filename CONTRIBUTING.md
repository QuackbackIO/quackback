# Contributing to Quackback

Thank you for your interest in contributing to Quackback! This guide will help you get started.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/quackbackio/quackback.git
cd quackback

# Run setup (installs dependencies, starts Docker, runs migrations, seeds demo data)
bun run setup

# Start development server
bun run dev
```

Open http://localhost:3000 to see the app.

## Project Structure

```
quackback/
├── apps/web/              # TanStack Start application
│   ├── src/
│   │   ├── routes/        # File-based routing (TanStack Router)
│   │   ├── components/    # UI and feature components
│   │   └── lib/           # Business logic, auth config, services
│   └── e2e/               # Playwright E2E tests
├── packages/
│   ├── db/                # Database (Drizzle schema, migrations)
│   ├── ids/               # TypeID system (branded UUIDs)
│   └── email/             # Email service (Resend + React Email)
├── ee/                    # Enterprise Edition features (SSO, SCIM, etc.)
└── docker-compose.yml     # Local PostgreSQL 18
```

## Architecture

Quackback uses **TanStack Start** with **TanStack Router** for file-based routing and server functions.

### Server Functions (`apps/web/src/lib/server-functions/`)

Type-safe RPC endpoints using `createServerFn`:

```typescript
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

export const createPostFn = createServerFn({ method: 'POST' })
  .validator(z.object({ title: z.string().min(1) }))
  .handler(async ({ data }) => {
    const auth = await requireAuth()
    return createPost(data, auth.member)
  })
```

### Service Layer (`apps/web/src/lib/{feature}/`)

Business logic with typed error handling:

```typescript
import { ValidationError } from '@/lib/shared/errors'

export async function createPost(input: CreatePostInput, author: Author) {
  if (!input.title?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Title is required')
  }
  // Business logic...
}
```

### Database Access

Always import from `@/lib/db`, not `@quackback/db`:

```typescript
import { db, posts, eq } from '@/lib/db'

const post = await db.query.posts.findFirst({
  where: eq(posts.id, postId),
})
```

### Architecture

- Single workspace, `DATABASE_URL` singleton

## Development Guidelines

### Code Style

- **Files**: kebab-case (`user-profile.tsx`)
- **Components**: PascalCase (`UserProfile`)
- **Functions**: camelCase (`getUserProfile`)
- **Database tables**: snake_case (`post_tags`)

### Testing

```bash
# Run all tests
bun run test

# Run specific test file
bun run test path/to/test.ts

# Run E2E tests
bun run test:e2e
```

## Contributor License Agreement

We require all contributors to sign our [Contributor License Agreement (CLA)](CLA.md) before we can accept contributions.

**Why a CLA?**

The CLA allows Quackback to:

- Offer the software under dual licenses (AGPL-3.0 for open source, commercial for enterprise)
- Defend the project against legal issues
- Ensure clean IP ownership for all contributions

**How it works:**

1. Submit your pull request
2. A CLA assistant bot will check if you've signed the CLA
3. If not, the bot will prompt you to sign by commenting on the PR
4. Once signed, your signature applies to all future contributions

The CLA is based on the Apache Individual Contributor License Agreement and grants Quackback the right to use your contributions under any license terms.

## Pull Request Process

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Ensure all tests pass
5. Submit a pull request
6. Sign the CLA when prompted by the bot

### PR Guidelines

- Keep PRs focused and reasonably sized
- Include tests for new functionality
- Update documentation if needed
- Follow the existing code style

## Reporting Issues

Please use GitHub Issues for:

- Bug reports
- Feature requests
- Questions

When reporting bugs, include:

- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, browser, etc.)

## License

Quackback core is licensed under AGPL-3.0. See [LICENSE](LICENSE) for details.
