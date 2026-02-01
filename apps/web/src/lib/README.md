# lib/ Directory Structure

This directory uses explicit **server/client separation** for maximum clarity.

```
lib/
├── client/          # Client-side only (React)
├── server/          # Server-side only (Node.js)
└── shared/          # Used by both
```

## Directory Overview

### `shared/` - Common Code

Code that runs on both client and server. Must be **client-safe** (no Node.js APIs).

| Directory  | Purpose                      |
| ---------- | ---------------------------- |
| `types/`   | TypeScript type definitions  |
| `schemas/` | Zod validation schemas       |
| `utils/`   | Utility functions (cn, etc.) |
| `theme/`   | Theme configuration          |

```typescript
import { type InboxFilters } from '@/lib/shared/types'
import { postSchema } from '@/lib/shared/schemas'
import { cn } from '@/lib/shared/utils'
```

### `client/` - React Code

Client-side React hooks and state. Runs in the browser.

| Directory    | Purpose                          |
| ------------ | -------------------------------- |
| `hooks/`     | React Query hooks (queries only) |
| `mutations/` | React Query mutation hooks       |
| `queries/`   | Query key factories              |
| `stores/`    | Zustand client state             |

```typescript
import { useInboxPosts } from '@/lib/client/hooks'
import { useCreatePost } from '@/lib/client/mutations'
import { usePostStore } from '@/lib/client/stores'
```

### `server/` - Server Code

Server-side business logic. Runs on Node.js only.

| Directory    | Purpose                           |
| ------------ | --------------------------------- |
| `functions/` | TanStack server functions (RPC)   |
| `domains/`   | Business logic services by domain |
| `events/`    | Event dispatch & handlers         |
| `auth/`      | Better Auth configuration         |
| `tenant/`    | Multi-tenant context              |
| `config/`    | Server configuration              |
| `db.ts`      | Database connection               |

```typescript
import { db, posts, eq } from '@/lib/server/db'
import { createPost } from '@/lib/server/domains/posts'
import { createPostFn } from '@/lib/server/functions/posts'
```

## Import Rules

1. **shared/** can be imported from anywhere
2. **client/** can only be imported from client code (components, hooks)
3. **server/** can only be imported from server code (server functions, API routes)
4. **lib/** never imports from **components/**

## Domain Structure

Business logic lives in `server/domains/{feature}/`:

```
server/domains/posts/
├── post.service.ts      # CRUD operations
├── post.query.ts        # Query builders
├── post.voting.ts       # Vote logic
├── post.status.ts       # Status transitions
├── post.permissions.ts  # Permission checks
├── post.types.ts        # Domain types
└── index.ts             # Barrel exports
```

## Conventions

- **Hooks**: `use-{feature}-query.ts` for queries
- **Mutations**: All in `client/mutations/`, named by domain
- **Services**: Max 400 lines, split by responsibility
- **Hooks**: Max 300 lines, queries only (no mutations)
