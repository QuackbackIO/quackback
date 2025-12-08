# Contributing to Quackback

Thank you for your interest in contributing to Quackback! This guide will help you get started.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/quackback/quackback.git
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
├── apps/web/              # Next.js application
│   ├── app/               # App Router pages and API routes
│   ├── components/        # UI and feature components
│   └── lib/               # Utilities, auth config, services
├── packages/
│   ├── db/                # Database (Drizzle schema, migrations, queries)
│   ├── domain/            # Business logic (services, result types)
│   ├── email/             # Email service (Resend)
│   ├── integrations/      # Third-party integrations
│   └── shared/            # Shared types, constants, utilities
├── ee/                    # Enterprise Edition features (SSO, SCIM, etc.)
└── docker-compose.yml     # Local PostgreSQL
```

## Architecture

Quackback follows a **modular monolith** architecture with clear separation of concerns:

### Domain Layer (`packages/domain/`)

- **Services**: Business logic with `Result<T, E>` error handling
- **Errors**: Domain-specific error types
- **Types**: Input/output types for service operations

### Data Layer (`packages/db/`)

- **Repositories**: Data access with clean interfaces
- **Unit of Work**: Transaction management with RLS context
- **Migrations**: Drizzle ORM migrations

### API Layer (`apps/web/app/api/`)

- **Route handlers**: Map HTTP to service calls
- **Validation**: Zod schemas for request validation
- **Error mapping**: Domain errors to HTTP responses

## Development Guidelines

### Code Style

- **Files**: kebab-case (`user-profile.tsx`)
- **Components**: PascalCase (`UserProfile`)
- **Functions**: camelCase (`getUserProfile`)
- **Database tables**: snake_case (`feedback_items`)

### Writing Services

Services should:

1. Return `Result<T, E>` for error handling
2. Use `withUnitOfWork()` for database transactions
3. Validate input and authorization
4. Keep business logic testable and framework-agnostic

```typescript
async createPost(input: CreatePostInput, ctx: ServiceContext): Promise<Result<Post, PostError>> {
  return withUnitOfWork(ctx.organizationId, async (uow) => {
    // Validate
    if (!input.title?.trim()) {
      return err(PostError.validationError('Title is required'))
    }

    // Execute business logic
    const post = await new PostRepository(uow.db).create({...})

    return ok(post)
  })
}
```

### Writing API Routes

API routes should:

1. Use `withApiHandler` for auth and error handling
2. Call services, not database directly
3. Map domain errors to HTTP status codes

```typescript
export const POST = withApiHandler(async (request, { validation }) => {
  const body = await request.json()
  const input = validateBody(schema, body)

  const ctx = buildServiceContext(validation)
  const result = await getPostService().createPost(input, ctx)

  if (!result.success) {
    throw new ApiError(result.error.message, mapErrorToStatus(result.error))
  }

  return successResponse(result.value, 201)
})
```

### Multi-tenancy

Quackback uses PostgreSQL Row Level Security (RLS) for tenant isolation:

- All data tables have `organization_id`
- The `app_user` role enforces RLS policies
- Use `withUnitOfWork()` to set tenant context

### Testing

```bash
# Run all tests
bun run test

# Run specific test file
bun run test packages/db/src/foo.test.ts

# Run E2E tests
cd apps/web && bun run test:e2e
```

## Developer Certificate of Origin

We use the [Developer Certificate of Origin (DCO)](https://developercertificate.org/) for contributions. By submitting a pull request, you certify that you wrote the code or have the right to submit it.

Sign your commits with:

```bash
git commit -s -m "Your commit message"
```

This adds a `Signed-off-by` line to your commit. If you forget, you can amend:

```bash
git commit --amend -s
```

## Pull Request Process

1. Fork the repository
2. Create a feature branch from `master`
3. Make your changes
4. Sign your commits (see above)
5. Ensure all tests pass
6. Submit a pull request

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

Quackback is licensed under BSL-1.1. See [LICENSE](LICENSE) for details.
