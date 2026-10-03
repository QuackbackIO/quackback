The 30 Ask requests in `ask-golden.ts` map to settings reads, atomic proposals, deep links and permission denials.

`ask-golden-sdk.db.test.ts` calls the actual first-party `createMcpServer` through the SDK `InMemoryTransport`. It runs real SQL against an isolated schema in `quackback_test`, clones the migrated tables and their foreign keys, rolls each scenario back, and drops only its own schema. These tests verify the tool contracts, persisted proposals, scope and permission gates, injection framing and absence of settings writes. They do not measure model selection.

Run the contract suite from `apps/web` with a cache TMPDIR and valid local configuration:

```sh
TMPDIR="$HOME/.cache/quackback-vitest" ../../node_modules/.bin/vitest run src/lib/server/mcp/__tests__/ask-golden-sdk.db.test.ts
```

`apps/web/evals/ask-workspace.eval.ts` sends those same requests to the real configured assistant using `workspace_assistant` and `surface: 'workspace'`. It discovers the actual MCP catalogue through the SDK, then the production runtime opens its in-memory MCP transport for model tools. It verifies observed tool names, exact proposed values, deep links, no autonomous mutation, and refusals. It fails early when no model is configured. There are no mock MCP servers, model replies or tool results.

One additional model request covers an operator-managed workspace name. The base thirty requests remain unchanged. A forwarding spy observes the real SDK calls and proves both rename paths read portal settings first: a local name creates a proposal, while a managed name opens General settings without a pending action.

Run model evaluation explicitly from the repository root. Use `quackback_test`, never the development database:

```sh
DATABASE_URL=postgresql://postgres:password@localhost:5432/quackback_test TMPDIR="$HOME/.cache/quackback-vitest" bun --env-file=.env vitest run --config apps/web/evals/vitest.config.ts apps/web/evals/ask-workspace.eval.ts
```

The SDK contract result and the configured-model result are separate verification levels. A passing contract suite does not establish model quality.
