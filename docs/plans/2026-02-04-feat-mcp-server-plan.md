---
title: 'feat: MCP Server for Quackback'
type: feat
date: 2026-02-04
---

# feat: MCP Server for Quackback

## Overview

Build a Model Context Protocol (MCP) server that lets AI agents interact with Quackback — searching feedback, triaging posts, and managing the feedback lifecycle. Packaged as `packages/mcp/` in the monorepo, connecting to any Quackback instance via the existing REST API (`/api/v1/`) with API key Bearer token auth.

## Problem Statement / Motivation

Product teams collect feedback in Quackback, but AI coding assistants and automation agents can't access it. Developers building features can't ask "what are users saying about search?" without leaving their editor. Support teams can't use AI to triage and categorize incoming feedback. There's no way to incorporate real customer voice into agentic workflows.

The MCP standard is now the dominant protocol for connecting AI agents to external tools. Shipping an official MCP server makes Quackback a first-class citizen in every AI-powered workflow — from Claude Desktop to VS Code to custom agent systems.

## Proposed Solution

A standalone `@quackback/mcp` package that runs as a stdio-based MCP server. It uses the existing REST API as its backend, requiring only an instance URL and API key to connect.

### Architecture

```
┌─────────────────────┐     HTTP/JSON      ┌──────────────────────┐
│  MCP Client         │◄──── stdio ────►   │  @quackback/mcp      │
│  (Claude Desktop,   │                    │                      │
│   VS Code, CLI)     │                    │  api() helper        │──► /api/v1/posts
│                     │                    │  (thin REST calls)   │──► /api/v1/boards
└─────────────────────┘                    │                      │──► /api/v1/statuses
                                           │  Tools (6)           │──► ...
                                           │  Resources (5)       │
                                           └──────────────────────┘
                                                     │
                                                     ▼
                                           ┌──────────────────────┐
                                           │  Quackback Instance  │
                                           │  /api/v1/*           │
                                           │  Bearer qb_xxx auth  │
                                           └──────────────────────┘
```

### Tool Design: Minimal and Focused

**6 Tools (down from 10):**

| Tool               | Description                                                               | Maps to API                                  |
| ------------------ | ------------------------------------------------------------------------- | -------------------------------------------- |
| `search_feedback`  | Search posts with filtering (board, status, tags, text, sort). Paginated. | `GET /posts`                                 |
| `get_post`         | Get a single post with full details including comments.                   | `GET /posts/:id` + `GET /posts/:id/comments` |
| `triage_post`      | Set status, tags, owner, and/or official response. All fields optional.   | `PATCH /posts/:id`                           |
| `add_comment`      | Post a comment on a post. Supports threaded replies.                      | `POST /posts/:id/comments`                   |
| `create_post`      | Submit new feedback on a board.                                           | `POST /posts`                                |
| `create_changelog` | Publish a changelog entry.                                                | `POST /changelog`                            |

**Removed (YAGNI):**

- `update_post_status` — duplicates `triage_post`
- `list_recent_activity` — duplicates `search_feedback` with `sort: 'newest'`
- `get_feedback_summary` — LLM can call `search_feedback` twice and synthesize
- `manage_roadmap` — niche edge case, add later if requested

**5 MCP Resources (reference data for grounding):**

| Resource | URI                    | Description                                                                 |
| -------- | ---------------------- | --------------------------------------------------------------------------- |
| Boards   | `quackback://boards`   | All boards with id, name, slug, description, isPublic, postCount            |
| Statuses | `quackback://statuses` | All statuses with id, name, slug, color, category, isDefault, showOnRoadmap |
| Tags     | `quackback://tags`     | All tags with id, name, color                                               |
| Roadmaps | `quackback://roadmaps` | All roadmaps with id, name, slug, isPublic                                  |
| Members  | `quackback://members`  | Team members with id, name, role (no email — privacy)                       |

**No Prompts** — removed for v0.1. Users and agents can write their own queries.

### Key Design Decisions

1. **Simple pagination**: Return `nextCursor` from API if available. Let the agent decide whether to paginate. No auto-pagination.

2. **Retry with jitter**: Exponential backoff (1s, 2s, 4s) with random jitter (0.5-1.5x) to prevent thundering herd. Max 3 retries, respects `Retry-After` header.

3. **Errors as tool results**: Domain errors (404, 400, 409) returned as `{ isError: true, content: [...] }` so the LLM can see them. Only transport/auth failures throw MCP protocol errors.

4. **AbortSignal support**: All API calls accept an optional `AbortSignal` for cancellation when MCP client disconnects.

5. **Fail-fast config**: Missing `QUACKBACK_URL` or `QUACKBACK_API_KEY` throws immediately at startup, not lazily.

6. **Content attribution**: All MCP-created content attributed to the API key's owner member.

## Technical Approach

### Package Structure (Flat, 7 Files)

```
packages/mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts      # Entry point: parse env, create server, connect stdio
│   ├── server.ts     # McpServer setup, registers tools and resources
│   ├── api.ts        # Thin REST API helper with retry/auth
│   ├── tools.ts      # All 6 tools in one file
│   ├── resources.ts  # All 5 resources in one file
│   ├── types.ts      # API response types (decoupled from db schema)
│   └── errors.ts     # Error handling wrapper
└── tests/
    ├── api.test.ts
    └── server.test.ts
```

### Implementation Phases

#### Phase 1: Foundation — Package Scaffold + API Helper

**Files to create:**

- `packages/mcp/package.json`
- `packages/mcp/tsconfig.json`
- `packages/mcp/src/index.ts`
- `packages/mcp/src/api.ts`
- `packages/mcp/src/types.ts`
- `packages/mcp/src/errors.ts`

**`package.json`:**

```json
{
  "name": "@quackback/mcp",
  "version": "0.1.0",
  "private": true,
  "license": "AGPL-3.0",
  "type": "module",
  "bin": {
    "quackback-mcp": "./src/index.ts"
  },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "start": "bun run src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/server": "^2.0.0",
    "@modelcontextprotocol/core": "^2.0.0"
  },
  "peerDependencies": {
    "zod": ">=3.25.0"
  },
  "devDependencies": {
    "@modelcontextprotocol/client": "^2.0.0",
    "vitest": "^4.0.15"
  }
}
```

**`api.ts` — Thin REST helper:**

```typescript
// packages/mcp/src/api.ts
import { ApiError, AuthError } from './errors.js'

export interface ApiConfig {
  url: string
  apiKey: string
}

// Jittered exponential backoff
function jitteredDelay(attempt: number): number {
  const base = 1000 * Math.pow(2, attempt) // 1s, 2s, 4s
  const jitter = 0.5 + Math.random() // 0.5-1.5x
  return Math.floor(base * jitter)
}

export async function api<T>(
  config: ApiConfig,
  path: string,
  options: RequestInit & { signal?: AbortSignal } = {}
): Promise<T> {
  const url = `${config.url}/api/v1${path}`
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    ...options.headers,
  }

  let lastError: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { ...options, headers, signal: options.signal })

      if (res.status === 401 || res.status === 403) {
        throw new AuthError(`Authentication failed: ${res.status}`)
      }

      if (res.status === 429 || res.status >= 500) {
        const retryAfter = res.headers.get('Retry-After')
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : jitteredDelay(attempt)
        await new Promise((r) => setTimeout(r, delay))
        continue
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new ApiError(res.status, body.error || `HTTP ${res.status}`)
      }

      // Handle 204 No Content
      if (res.status === 204) return undefined as T

      return await res.json()
    } catch (err) {
      if (err instanceof AuthError) throw err
      if (err instanceof ApiError) throw err
      lastError = err as Error
    }
  }

  throw lastError || new Error('Request failed after retries')
}
```

**`types.ts` — API response types:**

```typescript
// packages/mcp/src/types.ts
// These represent REST API responses, not database schemas

export interface ApiPost {
  id: string
  title: string
  content: string | null
  voteCount: number
  commentCount: number
  boardId: string
  boardSlug?: string
  boardName?: string
  statusId: string | null
  authorName: string | null
  ownerId: string | null
  tags: { id: string; name: string; color: string }[]
  createdAt: string
  updatedAt: string
}

export interface ApiPostDetail extends ApiPost {
  contentJson: unknown
  officialResponse: string | null
  officialResponseAuthorName: string | null
  officialResponseAt: string | null
  roadmapIds: string[]
  pinnedComment: ApiComment | null
}

export interface ApiComment {
  id: string
  content: string
  authorName: string | null
  parentId: string | null
  createdAt: string
}

export interface ApiBoard {
  id: string
  name: string
  slug: string
  description: string | null
  isPublic: boolean
  postCount: number
}

export interface ApiStatus {
  id: string
  name: string
  slug: string
  color: string
  category: 'active' | 'complete' | 'closed'
  isDefault: boolean
  showOnRoadmap: boolean
}

export interface ApiTag {
  id: string
  name: string
  color: string
}

export interface ApiRoadmap {
  id: string
  name: string
  slug: string
  isPublic: boolean
}

export interface ApiMember {
  id: string
  name: string
  role: 'admin' | 'member'
  // Note: email intentionally omitted for privacy
}

export interface ApiChangelogEntry {
  id: string
  title: string
  content: string
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    cursor: string | null
    hasMore: boolean
    total?: number
  }
}
```

**`errors.ts` — Error handling:**

```typescript
// packages/mcp/src/errors.ts
import type { CallToolResult } from '@modelcontextprotocol/core'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

// Wrapper for tool handlers — returns domain errors as tool results
export function withErrorHandling<T>(
  handler: (input: T) => Promise<CallToolResult>
): (input: T) => Promise<CallToolResult> {
  return async (input) => {
    try {
      return await handler(input)
    } catch (err) {
      // Auth errors propagate as protocol errors
      if (err instanceof AuthError) throw err

      // Domain errors returned as tool results so LLM can see them
      const message = err instanceof Error ? err.message : 'Unknown error'
      return {
        isError: true,
        content: [{ type: 'text', text: `Error: ${message}` }],
      }
    }
  }
}
```

**Tests:** Unit tests for the API helper using mocked fetch. Test: successful requests, 401/403/404/429 handling, retry logic with jitter, AbortSignal cancellation.

#### Phase 2: Tools + Resources

**Files to create:**

- `packages/mcp/src/tools.ts`
- `packages/mcp/src/resources.ts`
- `packages/mcp/src/server.ts`

**`tools.ts` — All 6 tools:**

```typescript
// packages/mcp/src/tools.ts
import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { api, type ApiConfig } from './api.js'
import { withErrorHandling } from './errors.js'
import type { ApiPost, ApiPostDetail, ApiComment, PaginatedResponse } from './types.js'

export function registerTools(server: McpServer, config: ApiConfig) {
  // search_feedback
  server.registerTool(
    'search_feedback',
    {
      description:
        'Search feedback posts with filtering by board, status, tags, text, and sort order. Returns paginated results with a cursor for fetching more.',
      inputSchema: z.object({
        query: z.string().optional().describe('Text search across post titles and content'),
        boardId: z.string().optional().describe('Filter by board TypeID (e.g., board_xxx)'),
        status: z
          .string()
          .optional()
          .describe('Filter by status slug (e.g., "open", "in_progress")'),
        tagIds: z
          .array(z.string())
          .optional()
          .describe('Filter by tag TypeIDs (comma-separated in API)'),
        sort: z.enum(['newest', 'oldest', 'votes']).default('newest').describe('Sort order'),
        limit: z.number().min(1).max(100).default(20).describe('Max results per page'),
        cursor: z.string().optional().describe('Pagination cursor from previous response'),
      }),
      annotations: { readOnlyHint: true },
    },
    withErrorHandling(async (input) => {
      const params = new URLSearchParams()
      if (input.query) params.set('search', input.query)
      if (input.boardId) params.set('boardId', input.boardId)
      if (input.status) params.set('status', input.status)
      if (input.tagIds?.length) params.set('tagIds', input.tagIds.join(','))
      params.set('sort', input.sort)
      params.set('limit', String(input.limit))
      if (input.cursor) params.set('cursor', input.cursor)

      const result = await api<PaginatedResponse<ApiPost>>(config, `/posts?${params}`)

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                posts: result.data,
                nextCursor: result.pagination.cursor,
                hasMore: result.pagination.hasMore,
                total: result.pagination.total,
              },
              null,
              2
            ),
          },
        ],
      }
    })
  )

  // get_post
  server.registerTool(
    'get_post',
    {
      description:
        'Get a single post with full details including comments, votes, tags, status, and official response.',
      inputSchema: z.object({
        postId: z.string().describe('Post TypeID (e.g., post_xxx)'),
      }),
      annotations: { readOnlyHint: true },
    },
    withErrorHandling(async ({ postId }) => {
      const [post, commentsRes] = await Promise.all([
        api<{ data: ApiPostDetail }>(config, `/posts/${postId}`),
        api<{ data: ApiComment[] }>(config, `/posts/${postId}/comments`),
      ])

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ...post.data, comments: commentsRes.data }, null, 2),
          },
        ],
      }
    })
  )

  // triage_post
  server.registerTool(
    'triage_post',
    {
      description:
        'Update a post: set status, tags, owner, and/or official response. All fields optional — only provided fields are updated.',
      inputSchema: z.object({
        postId: z.string().describe('Post TypeID to update'),
        statusId: z.string().optional().describe('New status TypeID'),
        tagIds: z.array(z.string()).optional().describe('Replace all tags with these TypeIDs'),
        ownerMemberId: z
          .string()
          .nullable()
          .optional()
          .describe('Assign to member TypeID, or null to unassign'),
        officialResponse: z
          .string()
          .nullable()
          .optional()
          .describe('Set official response text, or null to clear'),
      }),
      annotations: { idempotentHint: true },
    },
    withErrorHandling(async ({ postId, ...updates }) => {
      const result = await api<{ data: ApiPost }>(config, `/posts/${postId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      })

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      }
    })
  )

  // add_comment
  server.registerTool(
    'add_comment',
    {
      description: 'Post a comment on a feedback post. Supports threaded replies via parentId.',
      inputSchema: z.object({
        postId: z.string().describe('Post TypeID to comment on'),
        content: z.string().max(5000).describe('Comment text (max 5,000 characters)'),
        parentId: z.string().optional().describe('Parent comment TypeID for threaded reply'),
      }),
    },
    withErrorHandling(async ({ postId, content, parentId }) => {
      const result = await api<{ data: ApiComment }>(config, `/posts/${postId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content, parentId }),
      })

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      }
    })
  )

  // create_post
  server.registerTool(
    'create_post',
    {
      description:
        'Submit new feedback on a board. Requires board and title; content/status/tags optional.',
      inputSchema: z.object({
        boardId: z.string().describe('Board TypeID (use quackback://boards resource to find IDs)'),
        title: z.string().max(200).describe('Post title (max 200 characters)'),
        content: z.string().max(10000).optional().describe('Post content (max 10,000 characters)'),
        statusId: z
          .string()
          .optional()
          .describe('Initial status TypeID (defaults to board default)'),
        tagIds: z.array(z.string()).optional().describe('Tag TypeIDs to apply'),
      }),
    },
    withErrorHandling(async (input) => {
      const result = await api<{ data: ApiPost }>(config, '/posts', {
        method: 'POST',
        body: JSON.stringify(input),
      })

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      }
    })
  )

  // create_changelog
  server.registerTool(
    'create_changelog',
    {
      description: 'Create a changelog entry. Omit publishedAt to save as draft.',
      inputSchema: z.object({
        title: z.string().max(200).describe('Changelog entry title'),
        content: z.string().describe('Changelog content (markdown supported)'),
        publishedAt: z
          .string()
          .optional()
          .describe('ISO 8601 publish date (omit to save as draft)'),
      }),
    },
    withErrorHandling(async (input) => {
      const result = await api<{ data: ApiChangelogEntry }>(config, '/changelog', {
        method: 'POST',
        body: JSON.stringify(input),
      })

      return {
        content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      }
    })
  )
}
```

**`resources.ts` — All 5 resources:**

```typescript
// packages/mcp/src/resources.ts
import type { McpServer } from '@modelcontextprotocol/server'
import { api, type ApiConfig } from './api.js'
import type { ApiBoard, ApiStatus, ApiTag, ApiRoadmap, ApiMember } from './types.js'

interface ResourceConfig {
  name: string
  description: string
  fetcher: () => Promise<unknown>
}

function registerResource(server: McpServer, config: ResourceConfig) {
  const uri = `quackback://${config.name}`
  server.registerResource(
    config.name,
    uri,
    {
      description: config.description,
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(await config.fetcher(), null, 2),
        },
      ],
    })
  )
}

export function registerResources(server: McpServer, apiConfig: ApiConfig) {
  registerResource(server, {
    name: 'boards',
    description:
      'All feedback boards with id, name, slug, description, isPublic, postCount. Use board IDs when creating posts or filtering searches.',
    fetcher: () => api<{ data: ApiBoard[] }>(apiConfig, '/boards').then((r) => r.data),
  })

  registerResource(server, {
    name: 'statuses',
    description:
      'All feedback statuses with id, name, slug, color, category (active/complete/closed), isDefault, showOnRoadmap. Use status IDs when triaging posts.',
    fetcher: () => api<{ data: ApiStatus[] }>(apiConfig, '/statuses').then((r) => r.data),
  })

  registerResource(server, {
    name: 'tags',
    description:
      'All tags with id, name, color. Use tag IDs when triaging posts or filtering searches.',
    fetcher: () => api<{ data: ApiTag[] }>(apiConfig, '/tags').then((r) => r.data),
  })

  registerResource(server, {
    name: 'roadmaps',
    description: 'All roadmaps with id, name, slug, isPublic.',
    fetcher: () => api<{ data: ApiRoadmap[] }>(apiConfig, '/roadmaps').then((r) => r.data),
  })

  registerResource(server, {
    name: 'members',
    description: 'Team members with id, name, role. Use member IDs when assigning post owners.',
    fetcher: async () => {
      const members = await api<{ data: ApiMember[] }>(apiConfig, '/members')
      // Strip emails for privacy
      return members.data.map(({ id, name, role }) => ({ id, name, role }))
    },
  })
}
```

**`server.ts` — McpServer setup:**

```typescript
// packages/mcp/src/server.ts
import { McpServer } from '@modelcontextprotocol/server'
import type { ApiConfig } from './api.js'
import { registerTools } from './tools.js'
import { registerResources } from './resources.js'

export function createServer(config: ApiConfig): McpServer {
  const server = new McpServer({
    name: 'quackback-mcp',
    version: '0.1.0',
  })

  registerTools(server, config)
  registerResources(server, config)

  return server
}
```

#### Phase 3: Entry Point + Integration Tests

**`index.ts` — Entry point:**

```typescript
#!/usr/bin/env bun
// packages/mcp/src/index.ts
import { StdioServerTransport } from '@modelcontextprotocol/server'
import { createServer } from './server.js'

// Fail-fast config validation
const url = process.env.QUACKBACK_URL
const apiKey = process.env.QUACKBACK_API_KEY

if (!url) {
  console.error('Error: QUACKBACK_URL environment variable is required')
  process.exit(1)
}
if (!apiKey) {
  console.error('Error: QUACKBACK_API_KEY environment variable is required')
  process.exit(1)
}

try {
  new URL(url)
} catch {
  console.error(`Error: QUACKBACK_URL is not a valid URL: ${url}`)
  process.exit(1)
}

const server = createServer({ url, apiKey })
const transport = new StdioServerTransport()
await server.connect(transport)
```

**Integration tests (`server.test.ts`):**

- End-to-end test using `InMemoryTransport.createLinkedPair()` from `@modelcontextprotocol/core`
- Connect a test MCP client (from `@modelcontextprotocol/client`) to the server
- Mock fetch at the global level for realistic testing
- Test cases:
  - Tool discovery returns 6 tools
  - Resource discovery returns 5 resources
  - `search_feedback` returns paginated results
  - `get_post` returns post with comments
  - `triage_post` updates post and returns result
  - Error cases: 404 returns tool error, 401 throws protocol error
  - Malformed API responses handled gracefully
  - AbortSignal cancellation works

**Configuration example for Claude Desktop:**

```json
{
  "mcpServers": {
    "quackback": {
      "command": "bun",
      "args": ["run", "/path/to/quackback/packages/mcp/src/index.ts"],
      "env": {
        "QUACKBACK_URL": "https://feedback.example.com",
        "QUACKBACK_API_KEY": "qb_your_api_key_here"
      }
    }
  }
}
```

## Acceptance Criteria

### Functional Requirements

- [x] MCP server starts via stdio transport and responds to tool/resource discovery
- [x] All 6 tools callable with correct input validation and JSON responses
- [x] All 5 resources return current data from the Quackback API
- [x] `search_feedback` supports all filter combinations and returns `nextCursor`
- [x] `get_post` returns post with comments in single response
- [x] `triage_post` applies all specified fields in a single PATCH call
- [x] `create_post` creates a post and returns the new post data
- [x] `create_changelog` creates an entry with optional publish date
- [x] Retry logic handles 429 and 5xx with jittered exponential backoff
- [x] Auth errors (401/403) throw MCP protocol errors
- [x] Domain errors (404, 400) return as tool results with `isError: true`
- [x] Invalid TypeIDs return helpful error messages
- [x] Works with Bun runtime (no Node.js-specific APIs)

### Non-Functional Requirements

- [x] Package follows monorepo conventions (version 0.1.0, AGPL-3.0, type module)
- [x] All tool descriptions include `.describe()` on every Zod field
- [ ] Tool annotations (`readOnlyHint`, `idempotentHint`) set correctly
- [x] No API key leakage in error messages or tool responses
- [x] Members resource strips email for privacy

### Quality Gates

- [x] `bun run typecheck` passes
- [x] `bun run test` passes with >80% coverage
- [x] `bun run lint` passes

## Known Limitations (v0.1)

1. **No prompts**: Removed for simplicity. Users write their own queries.
2. **No auto-pagination**: Returns cursor; agent decides whether to fetch more.
3. **No roadmap management**: `manage_roadmap` tool deferred to v0.2.
4. **No summary tool**: LLM can call `search_feedback` with different params.
5. **Changelog-post linking**: REST API doesn't support it yet.
6. **Content attribution**: All content attributed to API key owner.
7. **Plain text only**: TipTap JSON (contentJson) not supported.
8. **No resource caching**: Fresh fetch on each access.

## Dependencies & Risks

**Dependencies:**

- `@modelcontextprotocol/server` ^2.0.0 (McpServer, StdioServerTransport)
- `@modelcontextprotocol/core` ^2.0.0 (types, InMemoryTransport for tests)
- `zod` ^3.25.0 (peer dependency)
- Working Quackback instance with API key for testing

**Risks:**

- **Rate limiting**: 100 req/min/IP limit. Mitigated by simple pagination (agent controls pace).
- **Pagination consistency**: Offset-based pagination can skip/duplicate items. Acceptable for v0.1.

## References

### Internal References

- API routes: `apps/web/src/routes/api/v1/`
- API auth: `apps/web/src/lib/server/domains/api/auth.ts`
- API responses: `apps/web/src/lib/server/domains/api/responses.ts`
- TypeID system: `packages/ids/src/`
- Package conventions: `packages/ids/package.json`

### External References

- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- MCP specification: https://modelcontextprotocol.io/specification/2025-11-25
- MCP server docs: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md
