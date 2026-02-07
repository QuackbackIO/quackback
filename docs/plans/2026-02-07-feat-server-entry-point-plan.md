---
title: 'feat: Add server entry point for eager config validation'
type: feat
date: 2026-02-07
---

# Server Entry Point for Eager Config Validation

## Overview

Add a TanStack Start [server entry point](https://tanstack.com/start/latest/docs/framework/react/guide/server-entry-point) (`src/server.ts`) and export a `validateConfig()` function from `config.ts`. The server validates all required env vars on startup — fail fast with a clear Zod error instead of crashing on the first request that touches a missing variable.

## Problem Statement

Missing env vars (e.g., `DATABASE_URL`, `SECRET_KEY`) only crash when first accessed at request time, not on startup. The config module uses lazy getters that defer validation until a property is read. A typo in `.env` manifests as a cryptic runtime error on the first request, not as a startup failure.

## Proposed Solution

1. Export `validateConfig()` from `config.ts` that calls the internal `loadConfig()`.
2. Add `src/server.ts` as a TanStack Start server entry point that calls `validateConfig()` before serving requests.

### Design Decisions

1. **`validateConfig()` over `void config.X`** — Explicit function call is self-documenting, linter-safe (won't be removed as dead code), and doesn't require updating when new required properties are added.

2. **Separate from BullMQ PR** — Independent concern. Easier to review and revert independently.

## Implementation

### Files Changed

| File            | Change                                     |
| --------------- | ------------------------------------------ |
| `config.ts`     | Export `validateConfig()` function         |
| `src/server.ts` | **New**: TanStack Start server entry point |

### `config.ts` — Add `validateConfig()`

```diff
+ /**
+  * Eagerly validate all config on startup.
+  * Call from server entry point to fail fast on missing env vars.
+  */
+ export function validateConfig(): void {
+   loadConfig()
+ }
```

### `src/server.ts` (new file)

```typescript
import { createServerEntry } from '@tanstack/react-start/server-entry'
import handler from '@tanstack/react-start/server-entry'
import { validateConfig } from '@/lib/server/config'

// Fail fast: validate all required env vars before serving any requests.
validateConfig()

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request)
  },
})
```

## Acceptance Criteria

- [ ] `validateConfig()` exported from `config.ts`, calls `loadConfig()`
- [ ] `src/server.ts` calls `validateConfig()` before `createServerEntry`
- [ ] Missing `DATABASE_URL`, `SECRET_KEY`, `BASE_URL`, or `REDIS_URL` → process exits with clear Zod validation error on startup
- [ ] Existing lazy getter behavior unchanged for runtime access

## Notes

Depends on `REDIS_URL` being added to the config schema (done in the BullMQ plan). Can ship before or after — if shipped before, `REDIS_URL` won't be in the schema yet and that's fine (the other required vars will still be validated eagerly).
