---
title: 'feat: Overhaul Claude Code Plugin'
type: feat
date: 2026-02-05
---

# feat: Overhaul Claude Code Plugin

## Overview

Switch the Quackback Claude Code plugin from local stdio MCP to remote HTTP, eliminating the need for local runtime dependencies and making the plugin zero-config for distribution.

## Problem Statement

The current plugin has two real problems:

1. **Local stdio transport** — Requires `bun` installed locally and a hardcoded absolute path to `packages/mcp/src/index.ts`. Nobody else can use this plugin.
2. **Manual configuration** — Users must edit `.mcp.json` with a hardcoded URL and API key. No guided setup.

The existing 126-line SKILL.md, 6 tools, and 5 resources are fine. The tool surface is small and well-documented. Splitting into commands/agents is premature — Quackback has one domain (feedback), not PostHog's 13.

## Proposed Solution

### Phase 1: HTTP MCP Endpoint (Server-side)

Add a Streamable HTTP MCP endpoint to the main Quackback app so the plugin can connect remotely without local runtime dependencies. Delete `packages/mcp/` as it becomes dead code.

#### New Files

```
apps/web/src/lib/server/mcp/
├── server.ts       # createDirectMcpServer factory + 5 resource registrations
└── tools.ts        # 6 tool handlers calling domain services directly

apps/web/src/routes/api/
└── mcp.ts          # HTTP endpoint (POST/GET/DELETE /api/mcp)
```

The MCP server code lives in `apps/web/` (not `packages/mcp/`) because it imports domain services via `@/lib/server/domains/` paths. This is the only MCP implementation — stdio is being replaced, not maintained in parallel. Resources are inlined in `server.ts` (5 one-liner service calls don't warrant a separate file).

#### Cleanup: Delete `packages/mcp/`

With HTTP as the only transport, the standalone `packages/mcp/` package is dead code:

- Delete `packages/mcp/` directory
- Remove from workspace `package.json`
- Remove any workspace references
- Add `@modelcontextprotocol/sdk: "^1.12.0"` to `apps/web/package.json` (SDK moves from deleted package)

The code is preserved in git history if ever needed for a standalone CLI distribution.

#### Route Handler: `apps/web/src/routes/api/mcp.ts`

- All HTTP methods (POST, GET, DELETE) delegate to `transport.handleRequest(request)` — the transport handles method dispatch internally
- POST handles JSON-RPC MCP messages; GET/DELETE are no-ops in stateless mode but the transport returns appropriate responses
- Uses `withApiKeyAuthTeam()` for Bearer token authentication — MCP is a team feature, not portal user accessible
- Resolves member context once, passes to server factory
- Creates a per-request MCP server with the resolved member context

```typescript
// apps/web/src/routes/api/mcp.ts (conceptual)
import { createDirectMcpServer } from '@/lib/server/mcp/server'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

// Authenticate (team members only)
const auth = await withApiKeyAuthTeam(request)

// Resolve member context once for all tool calls
const memberRecord = await db.query.member.findFirst({
  where: eq(member.id, auth.memberId),
  with: { user: true },
})

const mcpAuth: McpAuthContext = {
  memberId: auth.memberId,
  userId: memberRecord.user.id,
  name: memberRecord.user.name,
  email: memberRecord.user.email,
  role: auth.role,
}

// Stateless: one transport per request, no session management
const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
  enableJsonResponse: true,
})
const server = createDirectMcpServer(mcpAuth)
await server.connect(transport)
return transport.handleRequest(request)
```

#### McpAuthContext Type

Resolved once in the route handler, threaded through to all write tools:

```typescript
interface McpAuthContext {
  memberId: MemberId
  userId: UserId
  name: string
  email: string
  role: 'admin' | 'member'
}
```

This maps to the various service signatures:

- `createPost` needs `{ memberId, userId, name, email }`
- `createComment` needs `{ memberId, userId, name, email, role }`
- `updatePost` needs `responder?: { memberId, name }`
- `createChangelog` needs `{ memberId, name }`

#### MCP Server Factory: `apps/web/src/lib/server/mcp/server.ts`

Creates an `McpServer` instance with tools and resources registered. Takes `McpAuthContext` so write operations are correctly attributed. Resources are registered inline (5 one-liner service calls).

#### Direct Tools: `apps/web/src/lib/server/mcp/tools.ts`

Same 6 tools with identical names, descriptions, and Zod schemas as the current `packages/mcp/src/tools.ts`, but calling domain services directly:

| Tool               | Domain Service                                                              | Notes                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `search_feedback`  | `listInboxPosts()` from `posts/post.query`                                  | Needs cursor-to-offset translation — reuse `decodeCursor`/`encodeCursor` from `api/responses` to preserve cursor-based interface |
| `get_post`         | `getPostWithDetails()` + `getCommentsWithReplies()` from `posts/post.query` |                                                                                                                                  |
| `triage_post`      | `updatePost()` from `posts/post.service`                                    |                                                                                                                                  |
| `add_comment`      | `createComment()` from `comments/comment.service`                           |                                                                                                                                  |
| `create_post`      | `createPost()` from `posts/post.service`                                    |                                                                                                                                  |
| `create_changelog` | `createChangelog()` from `changelog/changelog.service`                      | Translate `publishedAt?: string` to service's `publishState` discriminated union (`draft` / `published`)                         |

#### Direct Resources (in `server.ts`)

Same 5 resources with identical URIs and descriptions:

| Resource   | Domain Service                                                   |
| ---------- | ---------------------------------------------------------------- |
| `boards`   | `listBoards()` from `boards/board.service`                       |
| `statuses` | `listStatuses()` from `statuses/status.service`                  |
| `tags`     | `listTags()` from `tags/tag.service`                             |
| `roadmaps` | `listRoadmaps()` from `roadmaps/roadmap.service`                 |
| `members`  | `listTeamMembers()` from `members/member.service` (strip emails) |

#### Error Handling

Domain services throw typed errors (`NotFoundError`, `ValidationError`, `ForbiddenError`). Each tool handler catches these and converts to MCP tool error results (`{ isError: true, content: [{ type: 'text', text: ... }] }`), so the LLM can see and respond to errors. Auth errors are handled at the route level by `withApiKeyAuthTeam()`.

#### Key Technical Decisions

| Decision        | Choice                                          | Why                                                               |
| --------------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| Transport class | `WebStandardStreamableHTTPServerTransport`      | TanStack Start uses Web Standard Request/Response                 |
| Session mode    | Stateless (`sessionIdGenerator: undefined`)     | Multi-tenant API key auth; horizontally scalable                  |
| Response mode   | `enableJsonResponse: true`                      | Simpler for stateless; avoids unnecessary SSE connections         |
| Data access     | Direct service calls                            | No self-calling HTTP loop                                         |
| Auth            | `withApiKeyAuthTeam()`                          | MCP is a team feature; gates entire endpoint to admin/member role |
| Auth context    | `McpAuthContext` resolved once in route handler | Prevents per-tool member lookups; clean typed parameter           |
| File structure  | 2 files in `lib/server/mcp/` + 1 route          | Resources inlined in `server.ts`; tools separate (has real logic) |
| SDK dependency  | Add to `apps/web/package.json`                  | Moves from deleted `packages/mcp/`                                |

### Phase 2: Update Plugin to HTTP Transport

Update the plugin's `.mcp.json` and README. No other plugin files change.

**Updated `.mcp.json`:**

```json
{
  "mcpServers": {
    "quackback": {
      "type": "http",
      "url": "${QUACKBACK_MCP_URL}",
      "headers": {
        "Authorization": "Bearer ${QUACKBACK_API_KEY}"
      }
    }
  }
}
```

Claude Code supports a `headers` field with `${VAR}` env var templating for HTTP MCP servers ([docs](https://code.claude.com/docs/en/mcp)). Known caveats: some versions had header bugs ([#7290](https://github.com/anthropics/claude-code/issues/7290), [#14977](https://github.com/anthropics/claude-code/issues/14977)); `/mcp` UI may show "not authenticated" cosmetically ([#17152](https://github.com/anthropics/claude-code/issues/17152)).

**Updated README** with setup instructions:

1. Install plugin: `/plugin install quackback`
2. Create an API key in Quackback Admin → Settings → API Keys
3. Set env vars in shell profile:
   ```bash
   export QUACKBACK_MCP_URL="https://feedback.acme.com/api/mcp"
   export QUACKBACK_API_KEY="qb_your_key_here"
   ```
4. Restart Claude Code

**Keep SKILL.md as-is.** The 126-line skill documents all 6 tools, 5 resources, and workflow guidelines. It works. When the tool surface grows beyond ~15 tools, revisit splitting into commands.

**Bump `plugin.json` version to `2.0.0`** — this is a breaking change (stdio → HTTP).

## Future Work (Not Part of This Plan)

These are deferred until there is proven user demand:

- **Slash commands** (`/quackback:search`, `/quackback:triage`, `/quackback:changelog`) — Quackback has 6 tools across 1 domain. The SKILL.md handles this fine. Revisit when tool count exceeds ~15.
- **Agents** (`feedback-analyzer`, `auto-triager`) — No user demand yet. Claude already synthesizes feedback naturally from the SKILL.md guidance. The auto-triager carries risk (bulk changes to production data with no enforcement mechanism in markdown).
- **OAuth authentication** — API key works for v1. OAuth is a better UX but requires building an OAuth provider.
- **Setup command** — The README documents 2 env vars. A markdown command can't actually detect env vars — it just tells Claude to check them. If the MCP server is unreachable, Claude already tells the user.
- **Standalone CLI (`packages/mcp/`)** — If there's demand for a standalone MCP server that external clients run locally (e.g., for Claude Desktop), it can be resurrected from git history and updated to call the REST API.

## Acceptance Criteria

### Functional Requirements

- [x] `POST /api/mcp` authenticates with API key and handles MCP JSON-RPC messages
- [x] `GET /api/mcp` and `DELETE /api/mcp` handled by transport (no-ops in stateless mode)
- [x] All 6 existing MCP tools work identically over HTTP transport
- [x] All 5 existing MCP resources work identically over HTTP transport
- [x] Content created via HTTP MCP is attributed to the API key owner
- [x] MCP endpoint restricted to team members (admin/member role)

### Non-Functional Requirements

- [x] Stateless transport — no in-memory session state, horizontally scalable
- [x] Plugin installs with zero code dependencies (pure markdown + JSON config)
- [x] Setup requires only 2 env vars (`QUACKBACK_MCP_URL`, `QUACKBACK_API_KEY`)

### Quality Gates

- [ ] HTTP MCP endpoint has test coverage:
  - Auth flow (valid key, invalid key, missing key, non-team-member key)
  - JSON-RPC message handling (tool calls, resource reads)
  - Error responses (malformed messages, domain errors)
  - Stateless behavior (no session header required)
- [x] Plugin README documents the full setup flow
- [x] `packages/mcp/` removed from workspace

## Dependencies & Risks

| Risk                                     | Impact | Mitigation                                                                                         |
| ---------------------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| Claude Code header bugs in some versions | Low    | Documented workarounds; officially supported pattern; pin to working version                       |
| MCP SDK HTTP transport API changes       | Medium | Pin SDK version, test on upgrade                                                                   |
| CORS requirements unknown                | Low    | Claude Code MCP client is not a browser — unlikely to need CORS. Investigate during implementation |

## References

### Internal

- Brainstorm: `docs/brainstorms/2026-02-05-plugin-overhaul-brainstorm.md`
- Replaced MCP server: `packages/mcp/src/` (to be deleted)
- API routes (pattern reference): `apps/web/src/routes/api/v1/`
- API auth: `apps/web/src/lib/server/domains/api/auth.ts`
- Domain services: `apps/web/src/lib/server/domains/{posts,boards,statuses,tags,roadmaps,comments,members,changelog}/`
- Cursor helpers: `apps/web/src/lib/server/domains/api/responses.ts` (`encodeCursor`/`decodeCursor`)

### External

- [MCP Streamable HTTP Transport](https://modelcontextprotocol.io/docs/concepts/transports#streamable-http)
- [MCP SDK Server](https://github.com/modelcontextprotocol/typescript-sdk)
- [Claude Code MCP Docs](https://code.claude.com/docs/en/mcp) — HTTP auth, headers, env var templating

### Review Feedback (Round 2)

- **DHH:** "Ship it. Four files is the correct number. The self-calling HTTP loop is dead." Note: `create_changelog` should use the service, not raw `db.insert`.
- **Kieran:** Approve with changes: define `McpAuthContext` type, use `createChangelog()` service (not raw insert), note cursor-to-offset translation, add `enableJsonResponse: true`, use `withApiKeyAuthTeam()`, add SDK to `apps/web/package.json`, specify error handling strategy.
- **Simplicity:** "Ship it with two cuts." Merge resources into `server.ts` (3 files → 2). Fold Phase 3 into Phase 1 (3 phases → 2). All incorporated.
