# Domain Layer Testing Guide

This directory contains test utilities and documentation for testing domain services in the Quackback application.

## Test Organization

```
packages/domain/src/
├── __tests__/
│   ├── README.md           # This file
│   └── test-utils.ts       # Shared test utilities and factories
├── boards/
│   ├── board.service.ts
│   └── board.service.test.ts
├── posts/
│   ├── post.service.ts
│   └── post.service.test.ts
└── ... (other domain modules)
```

Tests are co-located with their services using the `.test.ts` suffix. The `__tests__/` directory contains shared utilities used across all domain tests.

## Mocking Strategy

All domain service tests follow a **standard mocking pattern** to ensure consistency and maintainability:

### 1. Use `vi.hoisted()` for Constructor Mocking

Mock repository instances must be hoisted to be available when `vi.mock()` runs at module initialization:

```typescript
const { mockBoardRepo, mockPostRepo } = vi.hoisted(() => ({
  mockBoardRepo: {
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  mockPostRepo: {
    findById: vi.fn(),
    create: vi.fn(),
  },
}))
```

### 2. Use `vi.mock()` at Module Level

Mock the entire `@quackback/db` module at the top level, after imports:

```typescript
vi.mock('@quackback/db', () => ({
  withUnitOfWork: vi.fn(),
  BoardRepository: vi.fn(),
  PostRepository: vi.fn(),
}))
```

### 3. Use `beforeEach()` for Test Setup

Configure mock implementations in `beforeEach()` to ensure clean state per test:

```typescript
beforeEach(async () => {
  vi.clearAllMocks()

  const dbModule = await import('@quackback/db')

  // Use function() syntax for constructor mocking
  vi.mocked(dbModule.BoardRepository).mockImplementation(function () {
    return mockBoardRepo
  })

  // Mock withUnitOfWork to pass through to callback
  vi.mocked(dbModule.withUnitOfWork).mockImplementation(async (_orgId, callback) =>
    callback({ db: {} as any })
  )

  service = new MyService()
})
```

### 4. Constructor Mocking Syntax

Always use `function() {}` syntax (NOT arrow functions) for constructor mocking:

```typescript
// Correct
vi.mocked(dbModule.MyRepository).mockImplementation(function () {
  return mockRepoInstance
})

// Wrong - arrow functions don't work as constructors
vi.mocked(dbModule.MyRepository).mockImplementation(() => mockRepoInstance)
```

### 5. Import Mocked Modules in beforeEach

Use dynamic imports to access mocked modules:

```typescript
const dbModule = await import('@quackback/db')
vi.mocked(dbModule.BoardRepository).mockImplementation(...)
```

## Shared Test Utilities

The `test-utils.ts` file provides factories and helpers to reduce boilerplate:

### Entity Factories

Create mock entities with sensible defaults and optional overrides:

```typescript
const post = createMockPost({ title: 'Custom Title', status: 'in-progress' })
const board = createMockBoard({ name: 'Feature Requests' })
const tag = createMockTag({ name: 'bug' })
const comment = createMockComment({ content: 'Great idea!' })
const vote = createMockVote({ userId: 'user-123' })
const status = createMockStatus({ name: 'Completed' })
```

### Repository Mock Factories

Create repository mocks with all standard methods:

```typescript
const mockBoardRepo = createMockBoardRepository()
const mockPostRepo = createMockPostRepository()
const mockTagRepo = createMockTagRepository()
const mockCommentRepo = createMockCommentRepository()
const mockVoteRepo = createMockVoteRepository()
const mockStatusRepo = createMockStatusRepository()
```

### Service Context Factory

Create a complete service context with user info and organization:

```typescript
const ctx = createMockServiceContext({
  user: { id: 'user-123', role: 'admin' },
  organizationId: 'org-456',
})
```

### Result Helpers

Type-safe helpers for Result type assertions:

```typescript
const result = await service.getById('123', ctx)

if (isOk(result)) {
  console.log(result.value) // TypeScript knows this is the success value
}

if (isErr(result)) {
  console.log(result.error) // TypeScript knows this is the error
}
```

## Test Categories

Domain tests cover multiple scenarios to ensure robust error handling:

### 1. Happy Path Tests

Test successful operations with valid inputs:

```typescript
it('should create post when all inputs are valid', async () => {
  const ctx = createMockServiceContext()
  mockBoardRepo.findById.mockResolvedValue(createMockBoard())
  mockPostRepo.create.mockResolvedValue(createMockPost())

  const result = await service.create({ title: 'New Post', boardId: '123' }, ctx)

  expect(result.success).toBe(true)
})
```

### 2. Validation Error Tests

Test input validation for:

- Empty strings
- Whitespace-only strings
- Length limits (min/max)
- Invalid formats

```typescript
it('should return validation error when title is empty', async () => {
  const result = await service.create({ title: '', boardId: '123' }, ctx)

  expect(result.success).toBe(false)
  if (!result.success) {
    expect(result.error.type).toBe('validation')
  }
})
```

### 3. Authorization Tests

Test role-based access control for all user roles:

- `owner` - Full access
- `admin` - Administrative access
- `member` - Team member access
- `user` - Portal user (limited access)

```typescript
it('should return forbidden error when user is not admin', async () => {
  const ctx = createMockServiceContext({ user: { role: 'user' } })

  const result = await service.delete('123', ctx)

  expect(result.success).toBe(false)
  if (!result.success) {
    expect(result.error.type).toBe('forbidden')
  }
})
```

### 4. Not Found Error Tests

Test handling of missing resources:

```typescript
it('should return not found error when board does not exist', async () => {
  mockBoardRepo.findById.mockResolvedValue(null)

  const result = await service.getById('nonexistent', ctx)

  expect(result.success).toBe(false)
  if (!result.success) {
    expect(result.error.type).toBe('not_found')
  }
})
```

### 5. Database Error Tests

Test handling of database failures:

```typescript
it('should return database error when repository throws', async () => {
  mockPostRepo.create.mockRejectedValue(new Error('Connection failed'))

  const result = await service.create({ title: 'Post', boardId: '123' }, ctx)

  expect(result.success).toBe(false)
  if (!result.success) {
    expect(result.error.type).toBe('database')
  }
})
```

## Naming Conventions

### Test Files

Use the `.test.ts` suffix and match the service name:

- `board.service.ts` -> `board.service.test.ts`
- `post.service.ts` -> `post.service.test.ts`

### Describe Blocks

Structure tests with nested describe blocks:

1. Service name (outer)
2. Method name (inner)

```typescript
describe('BoardService', () => {
  describe('create', () => {
    it('should create board when inputs are valid', () => {})
  })

  describe('update', () => {
    it('should update board when user is authorized', () => {})
  })
})
```

### Test Names

Use "should X when Y" format for clarity:

- "should return board when found"
- "should return validation error when title is empty"
- "should return forbidden error when user lacks permission"

## Complete Example

Here's a minimal but complete example following all conventions:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PostService } from '../post.service'
import {
  createMockServiceContext,
  createMockPost,
  createMockBoard,
  createMockPostRepository,
  createMockBoardRepository,
} from '../../__tests__/test-utils'

// Step 1: Hoisted mocks for constructor mocking
const { mockPostRepo, mockBoardRepo } = vi.hoisted(() => ({
  mockPostRepo: createMockPostRepository(),
  mockBoardRepo: createMockBoardRepository(),
}))

// Step 2: Module-level mock
vi.mock('@quackback/db', () => ({
  withUnitOfWork: vi.fn(),
  PostRepository: vi.fn(),
  BoardRepository: vi.fn(),
}))

describe('PostService', () => {
  let service: PostService

  // Step 3: beforeEach setup
  beforeEach(async () => {
    vi.clearAllMocks()

    const dbModule = await import('@quackback/db')

    // Step 4: Constructor mocking with function() syntax
    vi.mocked(dbModule.PostRepository).mockImplementation(function () {
      return mockPostRepo
    })
    vi.mocked(dbModule.BoardRepository).mockImplementation(function () {
      return mockBoardRepo
    })
    vi.mocked(dbModule.withUnitOfWork).mockImplementation(async (_orgId, callback) =>
      callback({ db: {} as any })
    )

    service = new PostService()
  })

  describe('getById', () => {
    it('should return post when found', async () => {
      const ctx = createMockServiceContext()
      const mockPost = createMockPost({ id: 'post-123', title: 'Test Post' })
      mockPostRepo.findById.mockResolvedValue(mockPost)

      const result = await service.getById('post-123', ctx)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.id).toBe('post-123')
        expect(result.value.title).toBe('Test Post')
      }
    })

    it('should return not found error when post does not exist', async () => {
      const ctx = createMockServiceContext()
      mockPostRepo.findById.mockResolvedValue(null)

      const result = await service.getById('nonexistent', ctx)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('not_found')
      }
    })
  })

  describe('create', () => {
    it('should create post when all inputs are valid', async () => {
      const ctx = createMockServiceContext({ user: { role: 'admin' } })
      const mockBoard = createMockBoard({ id: 'board-123' })
      const mockPost = createMockPost({ title: 'New Post', boardId: 'board-123' })

      mockBoardRepo.findById.mockResolvedValue(mockBoard)
      mockPostRepo.create.mockResolvedValue(mockPost)

      const result = await service.create(
        { title: 'New Post', boardId: 'board-123', description: 'Description' },
        ctx
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.title).toBe('New Post')
      }
    })

    it('should return validation error when title is empty', async () => {
      const ctx = createMockServiceContext()

      const result = await service.create(
        { title: '', boardId: 'board-123', description: 'Description' },
        ctx
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('validation')
      }
    })

    it('should return forbidden error when user lacks permission', async () => {
      const ctx = createMockServiceContext({ user: { role: 'user' } })

      const result = await service.create(
        { title: 'New Post', boardId: 'board-123', description: 'Description' },
        ctx
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('forbidden')
      }
    })
  })
})
```

## Running Tests

```bash
# Run all domain tests
bun run test packages/domain

# Run specific test file
bun run test packages/domain/src/posts/post.service.test.ts

# Run tests in watch mode
bun run test --watch packages/domain

# Run with coverage
bun run test --coverage packages/domain
```

## Best Practices

1. **Always clear mocks** - Use `vi.clearAllMocks()` in `beforeEach()`
2. **Test error paths** - Don't only test happy paths
3. **Use type guards** - Check `result.success` before accessing `result.value` or `result.error`
4. **Keep tests isolated** - Each test should be independent and not rely on state from other tests
5. **Use factories** - Leverage `test-utils.ts` factories to reduce boilerplate
6. **Test authorization** - Always test role-based access control
7. **Mock at the boundary** - Mock repositories, not internal service methods
8. **Follow naming conventions** - Consistent naming makes tests easier to navigate

## Common Pitfalls

1. Using arrow functions for constructor mocking (use `function()` instead)
2. Forgetting to clear mocks between tests
3. Not using `vi.hoisted()` for mocks referenced in `vi.mock()`
4. Accessing `result.value` without checking `result.success` first
5. Testing implementation details instead of behavior
6. Creating brittle tests that break with refactoring

## Additional Resources

- [Vitest Documentation](https://vitest.dev/)
- [Vitest Mocking Guide](https://vitest.dev/guide/mocking.html)
- [Domain Layer Architecture](/packages/domain/README.md)
