---
topic: MCP Tool Optimization
date: 2026-02-05
status: decided
---

# MCP Tool Optimization

## What We're Building

Optimize the Quackback MCP server for better agentic performance by:

1. **Unifying search** — Replace `search_feedback` with a single `search` tool covering posts + changelogs (and future entities)
2. **Unifying get** — Replace `get_post` with `get_details` that auto-detects entity type from TypeID prefix
3. **Enriching tool descriptions** — Add usage examples to all tools (Anthropic's testing showed 72%→90% accuracy improvement)
4. **Adding MCP tool annotations** — `readOnlyHint`, `destructiveHint`, `idempotentHint` for better agent decision-making

## Why This Approach

### Research Findings

**Anthropic Engineering ("Advanced Tool Use", "Code Execution with MCP"):**

- Tool use examples improve parameter accuracy from 72% to 90%
- Tool search only needed at 10+ tools — we have 6, staying at 6
- Rich descriptions with return format documentation help agents parse responses correctly
- Annotations help agents understand side effects before calling

**PostHog MCP (27+ tools):**

- Uses `/posthog:search` as a unified search across all entity types
- Per-entity commands for CRUD operations
- Demonstrates the pattern at scale

**Sentry MCP (16+ tools), Linear MCP (21 tools):**

- Both use per-entity tools but at higher tool counts
- Our domain is simpler — 6 tools is sufficient

**Industry Consensus (Docker, Klavis.ai, CData):**

- "Workflow-based design" — our `triage_post` already exemplifies this
- Quality over quantity — fewer, richer tools beat many thin ones
- Resources for context, tools for actions — our pattern is correct
- Idempotent operations with cursor-based pagination — already implemented

### Why Unified Search + Get

1. **TypeIDs make it natural** — `post_01kgf...` and `changelog_01kgf...` encode entity type in the prefix. `get_details` doesn't need an `entity` parameter; it auto-routes.
2. **Fewer agent decisions** — Agent doesn't choose between `search_feedback` vs `search_changelogs` or `get_post` vs `get_changelog`. One tool, one flow.
3. **Fills the changelog gap** — Currently can `create_changelog` but can't search or read them. Unified search/get solves this without adding tools.
4. **Same tool count** — 6 tools before, 6 tools after. No context window bloat.

## Key Decisions

1. **Unified `search` replaces `search_feedback`** — Takes an optional `entity` param (`"posts"` | `"changelogs"`, defaults to `"posts"` for backwards compatibility). Entity-specific filters (boardId, status, tagIds) only apply when entity is `"posts"`.

2. **Unified `get_details` replaces `get_post`** — Takes a single `id` param. Detects entity type from TypeID prefix (`post_` → post details with comments, `changelog_` → changelog entry). Returns 400 for unknown prefixes.

3. **All 6 tools get usage examples in descriptions** — 1-3 concrete examples per tool showing realistic parameter combinations. Follows Anthropic's recommendation.

4. **All 6 tools get MCP annotations** — `readOnlyHint: true` for search/get, `destructiveHint: false` + `idempotentHint: false` for write tools. `openWorldHint: false` since tools only affect Quackback data.

5. **Write tools unchanged** — `triage_post`, `add_comment`, `create_post`, `create_changelog` keep their current signatures. They already follow workflow-based design.

6. **Resources unchanged** — Boards, statuses, tags, roadmaps, members stay as resources. They're small lookup tables, not searchable entities.

## Final Tool Set

| #   | Tool               | Annotations                          | Change                                            |
| --- | ------------------ | ------------------------------------ | ------------------------------------------------- |
| 1   | `search`           | readOnly                             | Replaces `search_feedback`, adds changelog search |
| 2   | `get_details`      | readOnly                             | Replaces `get_post`, auto-routes by TypeID prefix |
| 3   | `triage_post`      | !readOnly, !destructive, !idempotent | Unchanged signature                               |
| 4   | `add_comment`      | !readOnly, !destructive, !idempotent | Unchanged signature                               |
| 5   | `create_post`      | !readOnly, !destructive, !idempotent | Unchanged signature                               |
| 6   | `create_changelog` | !readOnly, !destructive, !idempotent | Unchanged signature                               |

## Open Questions

1. **Should `search` default to searching ALL entities when no `entity` param is given?** Or default to `"posts"` for backwards compat? Leaning towards defaulting to posts since that's the 90% use case.
2. **Should `get_details` support batch IDs?** e.g., `ids: ["post_01...", "post_02..."]` for fetching multiple posts in one call. Probably YAGNI for now.
3. **Should changelog search support filtering by publish status?** (draft vs published) — Probably yes, useful for agents managing changelog workflow.

## References

- Anthropic: [Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- Anthropic: [Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use)
- Klavis.ai: [Less is More — MCP Design Patterns](https://www.klavis.ai/blog/less-is-more-mcp-design-patterns-for-ai-agents)
- Docker: [MCP Server Best Practices](https://www.docker.com/blog/mcp-server-best-practices/)
- PostHog: [posthog-for-claude](https://github.com/PostHog/posthog-for-claude)
- Current implementation: `apps/web/src/lib/server/mcp/tools.ts`
