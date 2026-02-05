# Plugin Overhaul: Learnings from PostHog's Claude Plugin

**Date:** 2026-02-05
**Status:** Brainstorm
**Triggered by:** Analysis of [PostHog's Claude plugin](https://github.com/PostHog/posthog-for-claude)

## What We're Building

A complete overhaul of the Quackback Claude Code plugin, applying patterns from PostHog's well-structured plugin. The goal is to make the plugin plug-and-play, domain-focused, and agent-powered.

## Why This Approach

PostHog's plugin is a masterclass in lightweight plugin architecture:

- **13 domain-specific slash commands** instead of one monolithic skill
- **Agents** for autonomous multi-step analysis
- **Remote HTTP MCP server** with zero local setup
- **Env var templating** with sensible defaults
- **Pure markdown** — no compiled code in the plugin itself

Our current plugin has a single catch-all SKILL.md, requires manual API key + URL config, and runs the MCP server as a local process. This creates friction for users.

## Key Decisions

### 1. Remote HTTP MCP Server (like PostHog)

**Current:** Local `bun run index.ts` with hardcoded env vars in `.mcp.json`
**Target:** Remote HTTP server at `mcp.quackback.io`

```json
{
  "mcpServers": {
    "quackback": {
      "type": "http",
      "url": "${QUACKBACK_MCP_URL:-https://mcp.quackback.io/mcp}"
    }
  }
}
```

- Zero config for hosted users — just authenticate via OAuth
- Self-hosted users override `QUACKBACK_MCP_URL`
- Requires building an HTTP MCP endpoint in the main app (currently only stdio)

### 2. Three Focused Slash Commands

Replace the monolithic SKILL.md with three domain-specific commands:

| Command                | Purpose                                     | Key Tools                             |
| ---------------------- | ------------------------------------------- | ------------------------------------- |
| `/quackback:search`    | Find and explore feedback                   | `search_feedback`, `get_post`         |
| `/quackback:triage`    | Manage post status, tags, owners, responses | `triage_post`, `add_comment`          |
| `/quackback:changelog` | Create and publish changelog entries        | `create_changelog`, `search_feedback` |

Each command gets its own `commands/{name}.md` with:

- YAML frontmatter (name, description, argument-hint)
- Numbered workflow steps
- Tool reference with parameters
- Example prompts

### 3. Two Autonomous Agents

| Agent                 | Purpose                                                                                              | Pattern                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **feedback-analyzer** | Scan all feedback to identify themes, duplicates, high-priority items, and generate a summary report | Like what we did manually — search by votes, group by theme, identify gaps |
| **auto-triager**      | Read open/untriaged posts and suggest status, tags, owner assignments, and draft official responses  | Reads resources first, then processes open posts in batches                |

Agents live in `agents/{name}.md` with:

- Capabilities section
- Step-by-step workflow using MCP tools
- Output format template
- Analysis guidelines

### 4. Keep the General Skill

Retain `skills/quackback/SKILL.md` but make it lighter — a trigger for when users mention "feedback", "triage", etc. that explains available commands and agents rather than documenting every tool parameter.

### 5. Plugin Structure (Target)

```
plugins/quackback/
├── .claude-plugin/
│   └── plugin.json
├── .mcp.json                    # Remote HTTP with env var template
├── README.md
├── commands/
│   ├── search.md                # /quackback:search
│   ├── triage.md                # /quackback:triage
│   └── changelog.md             # /quackback:changelog
├── skills/
│   └── quackback/
│       └── SKILL.md             # General trigger, lighter weight
└── agents/
    ├── feedback-analyzer.md     # Autonomous feedback analysis
    └── auto-triager.md          # Autonomous post triage
```

## Comparison: Before vs After

| Aspect         | Before                     | After                     |
| -------------- | -------------------------- | ------------------------- |
| MCP hosting    | Local process              | Remote HTTP               |
| Auth           | Manual API key config      | OAuth (browser flow)      |
| Commands       | 1 monolithic skill         | 3 focused commands        |
| Agents         | None                       | 2 autonomous agents       |
| Setup friction | Clone, configure URL + key | Install, authenticate, go |
| Env vars       | Hardcoded in .mcp.json     | Template with defaults    |

## Open Questions

1. **OAuth implementation** — Do we build our own OAuth provider or use the existing API key system with a browser-based key creation flow?
2. **HTTP MCP transport** — The current MCP server uses stdio. Need to add HTTP/SSE transport to the main app or build a separate service.
3. **Self-hosted support** — How do self-hosted users configure their MCP URL? PostHog uses env var override.
4. **Agent permissions** — Should the auto-triager actually apply changes, or just suggest them for human approval?

## References

- [PostHog Claude Plugin](https://github.com/PostHog/posthog-for-claude)
- [Current Quackback Plugin](https://github.com/QuackbackIO/claude-code-plugins)
- [MCP HTTP Transport Spec](https://modelcontextprotocol.io/docs/concepts/transports#streamable-http)
