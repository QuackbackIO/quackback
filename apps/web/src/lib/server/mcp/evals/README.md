The 19 Ask requests in `ask-golden.ts` map to settings reads, deep links and permission denials.

`ask-golden-sdk.db.test.ts` calls the actual first-party `createMcpServer` through the SDK `InMemoryTransport`. It runs real SQL against an isolated schema in `quackback_test`, clones the migrated tables and their foreign keys, rolls each scenario back, and drops only its own schema. These tests verify the tool contracts, scope and permission gates, injection framing and absence of settings writes. They do not measure model selection.

Run the contract suite from `apps/web` with a cache TMPDIR and valid local configuration:

```sh
TMPDIR="$HOME/.cache/quackback-vitest" ../../node_modules/.bin/vitest run src/lib/server/mcp/__tests__/ask-golden-sdk.db.test.ts
```
