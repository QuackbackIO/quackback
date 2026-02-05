---
title: 'feat: Optimize MCP tools with unified search, get_details, and rich descriptions'
type: feat
date: 2026-02-05
---

# Optimize MCP Tools

## Overview

Optimize the Quackback MCP server for better agentic performance by unifying search and detail-fetching tools, enriching all tool descriptions with usage examples, and adding MCP tool annotations. Same tool count (6), more capable, better agent accuracy.

## Problem Statement / Motivation

1. **Changelog gap**: We can `create_changelog` but agents can't search or read them — no discovery path.
2. **Description quality**: Anthropic's testing showed adding usage examples improves tool parameter accuracy from 72% to 90%. Our current descriptions are functional but lack examples.
3. **Missing annotations**: MCP supports `readOnlyHint`, `destructiveHint`, `idempotentHint` — these help agents reason about side effects before calling tools. We don't use them.
4. **PostHog pattern**: PostHog's MCP uses unified search across all entities. With our TypeID system, we can do this more elegantly — `get_details` can auto-route by prefix without needing an `entity` parameter.

## Proposed Solution

Replace 2 tools, enhance all 6:

| Before             | After              | Change                                  |
| ------------------ | ------------------ | --------------------------------------- |
| `search_feedback`  | `search`           | Add changelog search via `entity` param |
| `get_post`         | `get_details`      | Auto-route by TypeID prefix             |
| `triage_post`      | `triage_post`      | Add examples + annotations              |
| `add_comment`      | `add_comment`      | Add examples + annotations              |
| `create_post`      | `create_post`      | Add examples + annotations              |
| `create_changelog` | `create_changelog` | Add examples + annotations              |

## Technical Approach

### Unified `search` Tool

**Schema:**

```typescript
// apps/web/src/lib/server/mcp/tools.ts
const searchSchema = {
  entity: z
    .enum(['posts', 'changelogs'])
    .default('posts')
    .describe('Entity type to search. Defaults to posts.'),
  query: z.string().optional().describe('Text search across titles and content'),
  sort: z
    .enum(['newest', 'oldest', 'votes'])
    .default('newest')
    .describe('Sort order. "votes" only applies to posts.'),
  limit: z.number().min(1).max(100).default(20).describe('Max results per page'),
  cursor: z.string().optional().describe('Pagination cursor from previous response'),
  // Post-specific filters (ignored for changelogs)
  boardId: z.string().optional().describe('Filter posts by board TypeID (ignored for changelogs)'),
  status: z
    .string()
    .optional()
    .describe(
      'Filter by status. For posts: slug like "open", "in_progress". For changelogs: "draft", "published", "scheduled", "all".'
    ),
  tagIds: z
    .array(z.string())
    .optional()
    .describe('Filter posts by tag TypeIDs (ignored for changelogs)'),
}
```

**Cursor strategy**: Encode entity type in cursor to prevent cross-entity cursor misuse:

```typescript
// Cursor format: base64({ entity: 'posts', offset: 20 }) or base64({ entity: 'changelogs', cursor: 'changelog_01...' })
function encodeSearchCursor(entity: string, value: number | string): string
function decodeSearchCursor(cursor?: string): { entity: string; offset?: number; cursor?: string }
```

**Dispatch:**

- `entity === 'posts'` → call `listInboxPosts()` with offset pagination
- `entity === 'changelogs'` → call `listChangelogs()` with ID cursor pagination

### Unified `get_details` Tool

**Schema:**

```typescript
// apps/web/src/lib/server/mcp/tools.ts
const getDetailsSchema = {
  id: z
    .string()
    .describe(
      'TypeID of the entity to fetch (e.g., post_01abc..., changelog_01xyz...). Entity type is auto-detected from the prefix.'
    ),
}
```

**Dispatch using `getTypeIdPrefix()` from `@quackback/ids`:**

```typescript
import { getTypeIdPrefix } from '@quackback/ids'

const prefix = getTypeIdPrefix(args.id)
switch (prefix) {
  case 'post':
  // getPostWithDetails() + getCommentsWithReplies() in parallel
  case 'changelog':
  // getChangelogById()
  default:
  // Return error: "Unsupported entity type: {prefix}. Supported: post, changelog"
}
```

### Tool Description Examples

Each tool gets 1-3 realistic examples in its description. Pattern:

```typescript
server.tool(
  'search',
  `Search feedback posts or changelog entries. Returns paginated results with a cursor for fetching more.

Examples:
- Search all posts: search()
- Search by text: search({ query: "dark mode" })
- Filter by board: search({ boardId: "board_01abc...", status: "open" })
- Search changelogs: search({ entity: "changelogs", status: "published" })
- Sort by votes: search({ sort: "votes", limit: 10 })`,
  searchSchema,
  handler
)
```

### MCP Tool Annotations

```typescript
// Read tools
server.tool('search', description, schema, handler, {
  annotations: { readOnlyHint: true, openWorldHint: false },
})
server.tool('get_details', description, schema, handler, {
  annotations: { readOnlyHint: true, openWorldHint: false },
})

// Write tools
server.tool('triage_post', description, schema, handler, {
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
})
// ... same pattern for add_comment, create_post, create_changelog
```

## Acceptance Criteria

### Phase 1: Unified Search + Get Details

- [x] Replace `search_feedback` with `search` tool in `apps/web/src/lib/server/mcp/tools.ts`
  - [x] `entity: "posts"` (default) calls `listInboxPosts()` with existing offset cursor logic
  - [x] `entity: "changelogs"` calls `listChangelogs()` with ID cursor logic
  - [x] Entity-encoded cursor prevents cross-entity cursor misuse
  - [x] Post-specific filters (`boardId`, `tagIds`) are silently ignored for changelogs
  - [x] Changelog `status` filter supports `draft` | `published` | `scheduled` | `all`
  - [x] `sort: "votes"` silently falls back to `newest` for changelogs
- [x] Replace `get_post` with `get_details` tool in `apps/web/src/lib/server/mcp/tools.ts`
  - [x] Uses `getTypeIdPrefix()` from `@quackback/ids` to auto-route
  - [x] `post_` prefix → `getPostWithDetails()` + `getCommentsWithReplies()` (parallel)
  - [x] `changelog_` prefix → `getChangelogById()`
  - [x] Unknown prefix → return MCP error result with helpful message
- [x] Update `apps/web/src/lib/server/mcp/__tests__/handler.test.ts`
  - [x] Replace `search_feedback` tests with `search` tool tests (posts + changelogs)
  - [x] Replace `get_post` test with `get_details` tests (post + changelog + invalid prefix)
  - [x] Add mocks for `listChangelogs`, `getChangelogById`
  - [x] Update tool count assertion (still 6)
  - [x] Update tool name assertions

### Phase 2: Description Enhancements + Annotations

- [x] Add 1-3 usage examples to all 6 tool descriptions in `tools.ts`
  - [x] `search`: show entity switching, text search, filter combos, pagination
  - [x] `get_details`: show post ID, changelog ID examples
  - [x] `triage_post`: show status change, tag assignment, official response
  - [x] `add_comment`: show top-level comment, threaded reply
  - [x] `create_post`: show minimal creation, full creation with tags
  - [x] `create_changelog`: show draft, published examples
- [x] Add MCP annotations to all 6 tools
  - [x] `search`, `get_details`: `{ readOnlyHint: true, openWorldHint: false }`
  - [x] Write tools: `{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }`
- [x] Update SKILL.md in `~/claude-code-plugins/plugins/quackback/skills/quackback/SKILL.md`
  - [x] Replace `search_feedback` → `search` with changelog support noted
  - [x] Replace `get_post` → `get_details` with TypeID routing noted
- [x] Copy updated plugin files to cache

### Phase 3: Validation

- [x] `bun run typecheck` passes in `apps/web`
- [x] `bun run test` passes (all tests including updated MCP handler tests)
- [x] `bun run lint` passes
- [ ] E2E curl test: `search` with `entity: "posts"` returns posts
- [ ] E2E curl test: `search` with `entity: "changelogs"` returns changelogs
- [ ] E2E curl test: `get_details` with post TypeID returns post + comments
- [ ] E2E curl test: `get_details` with changelog TypeID returns changelog
- [ ] E2E curl test: `get_details` with invalid prefix returns error
- [ ] E2E curl test: cross-entity cursor returns error or empty results

## Dependencies & Risks

**Dependencies:**

- `getTypeIdPrefix()` from `@quackback/ids` — already exists
- `listChangelogs()` from `changelog.service.ts` — already exists
- `getChangelogById()` from `changelog.service.ts` — already exists

**Risks:**

- **Cursor pagination mismatch**: Posts use offset-based, changelogs use ID-based. Mitigated by encoding entity type in cursor.
- **Breaking change for MCP consumers**: `search_feedback` → `search` and `get_post` → `get_details` rename. Low risk since the MCP server is new and the plugin is the only consumer.

## References & Research

### Internal References

- Brainstorm: `docs/brainstorms/2026-02-05-mcp-tool-optimization-brainstorm.md`
- Current tools: `apps/web/src/lib/server/mcp/tools.ts`
- TypeID system: `packages/ids/src/index.ts` — `getTypeIdPrefix()`, `isTypeId()`
- Changelog service: `apps/web/src/lib/server/domains/changelog/changelog.service.ts` — `listChangelogs()`, `getChangelogById()`
- Post query: `apps/web/src/lib/server/domains/posts/post.query.ts` — `listInboxPosts()`, `getPostWithDetails()`
- Cursor utilities: `apps/web/src/lib/server/domains/api/responses.ts` — `encodeCursor()`, `decodeCursor()`

### External References

- Anthropic: [Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use) — examples improve accuracy 72%→90%
- Anthropic: [Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- Docker: [MCP Server Best Practices](https://www.docker.com/blog/mcp-server-best-practices/)
- PostHog MCP: [posthog-for-claude](https://github.com/PostHog/posthog-for-claude)
