---
title: Simplify Architecture to Self-Hosted Only
type: refactor
date: 2026-02-01
deepened: 2026-02-01
updated: 2026-02-01
---

# Simplify Architecture to Self-Hosted Only

## Enhancement Summary

**Deepened on:** 2026-02-01
**Updated:** 2026-02-01 (Additional OAuth/SSO simplifications)
**Research agents used:** architecture-strategist, code-simplicity-reviewer, kieran-typescript-reviewer, security-sentinel, performance-oracle, pattern-recognition-specialist, best-practices-researcher, framework-docs-researcher, code-reviewer

### Key Improvements from Research

1. **Phase reordering** - Move caching updates BEFORE file deletion to maintain compilable codebase
2. **Type safety** - Improved `request-storage.ts` with typed cache accessors
3. **Keep Proxy pattern** - For lazy initialization (tests/build may import without DATABASE_URL)
4. **Missing files identified** - `use-features.ts`, `workspace-utils.ts` edition guards, `hook-context.ts` catalog lookups

### Additional Simplifications (2026-02-01 Update)

1. **Remove custom server.ts entirely** - Use TanStack Start's default server entry
2. **Replace custom OAuth plugins with Better Auth's built-in `socialProviders`** - No cross-domain auth needed
3. **Remove SSO/OIDC support entirely** - Enterprise feature deferred indefinitely
4. **Remove feature gating system entirely** - All features always enabled, no gating needed
5. **Remove EE (Enterprise Edition) concept entirely** - Pure AGPL open source, no dual-license complexity

### Full Feature Gating Removal

Since all features are always enabled for self-hosted:

- **Delete Feature enum and all gating code** (~340 lines in shared/features.ts)
- **Delete server feature checks** (~180 lines in server/features.ts)
- **Delete `hasFeature()`, `checkFeatureAccess()` from ~30 call sites** (~400 lines)
- **Remove all "Upgrade to Pro" UI components** (~150 lines)

This eliminates unnecessary abstraction - no features are gated, so no gating system needed.

---

## Overview

Remove all cloud/multi-tenant code from Quackback to create a clean, simple codebase that maximizes open-source community adoption. The self-hosted product becomes the pristine primary experience, with cloud functionality deferred to a future phase where it can be added as a separate layer.

## Problem Statement / Motivation

The current codebase has cloud multi-tenant code interleaved throughout:

- **Tenant resolution** in `server.ts` with domain-to-workspace mapping
- **Database proxy** in `db.ts` that switches between singleton and per-tenant connections
- **Subscription/tier gating** scattered across features, UI, and API routes
- **Catalog database** for workspace/domain/subscription management
- **15+ CLOUD\_\* environment variables** in config schema
- **AsyncLocalStorage context** propagated through all requests

This creates cognitive overhead for contributors who must understand multi-tenancy to work on any part of the codebase. The goal is to make Quackback immediately approachable for open-source contributors.

**Target state:** A developer can clone the repo, run `bun run dev`, and understand the entire architecture in under an hour.

## Proposed Solution

Delete all purely-cloud code and simplify mixed files to always take the self-hosted path. Preserve a minimal request-scoped storage mechanism for caching (replaces tenantStorage).

### Key Decisions

| Decision               | Choice                                          | Rationale                                                                  |
| ---------------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| Request-scoped caching | Keep minimal `requestStorage`                   | 15+ call sites use request caching; removing causes 3-5x query increase    |
| OAuth flow             | **Use Better Auth built-in `socialProviders`**  | Single domain = no need for cross-domain session transfer                  |
| Custom server.ts       | **Remove entirely**                             | TanStack Start default handles everything; no tenant resolution needed     |
| SSO/OIDC               | **Remove entirely**                             | Enterprise feature deferred indefinitely                                   |
| Feature gating system  | **Remove entirely**                             | All features enabled = no gating needed; removes ~750 lines of abstraction |
| Edition checks         | Remove entirely                                 | Dead code adds confusion for contributors                                  |
| EE packages concept    | **Remove entirely**                             | No dual-license complexity; pure AGPL open source                          |
| `INCLUDE_EE` config    | **Remove entirely**                             | No EE packages to include                                                  |
| Proxy pattern in db.ts | **Keep** (simplified)                           | Lazy initialization needed for tests/builds without DATABASE_URL           |
| Team auth              | **Keep** (admin/member/user roles, invitations) | Core product functionality                                                 |

## Technical Approach

### Architecture After Simplification

```
apps/web/src/
├── server.ts                    # DELETED - use TanStack Start default
├── lib/
│   ├── core/
│   │   ├── db.ts               # Simple: singleton DATABASE_URL connection (lazy via Proxy)
│   │   └── request-storage.ts  # NEW: minimal request-scoped cache with typed accessors
│   ├── server/
│   │   ├── auth/               # SIMPLIFIED: Better Auth socialProviders, no custom plugins
│   │   │   └── index.ts        # emailOTP + magicLink + socialProviders (GitHub, Google)
│   │   ├── domains/            # Remove catalog/ directory
│   │   ├── functions/          # Simplify edition checks
│   │   └── features.ts         # Always return community tier
│   └── shared/
│       └── features.ts         # Remove cloud tiers, keep Feature enum
```

### Implementation Phases (REORDERED for Safety)

> **Critical Change:** Phases reordered so the codebase compiles after every phase. Update caching call sites BEFORE deleting tenant files.

#### Phase 1: Create Request Storage Replacement

Before deleting tenant code, create a minimal replacement for request-scoped caching.

**Create `lib/core/request-storage.ts`:**

```typescript
// lib/core/request-storage.ts
import { AsyncLocalStorage } from 'node:async_hooks'

interface RequestContext {
  cache: Map<string, unknown>
}

export const requestStorage = new AsyncLocalStorage<RequestContext>()

export function createRequestContext(): RequestContext {
  return { cache: new Map() }
}

/**
 * Get the request-scoped cache.
 * @throws Error if called outside of request context (fail loudly, not silently)
 */
export function getRequestCache(): Map<string, unknown> {
  const store = requestStorage.getStore()
  if (!store) {
    throw new Error(
      'getRequestCache() called outside request context. ' +
        'Ensure this is called within requestStorage.run()'
    )
  }
  return store.cache
}

/**
 * Safely get cache, returning undefined outside request context.
 * Use when caching is optional (e.g., CLI tools, background jobs).
 */
export function getRequestCacheOrNull(): Map<string, unknown> | undefined {
  return requestStorage.getStore()?.cache
}
```

### Research Insights: AsyncLocalStorage Best Practices

**From Node.js documentation and framework research:**

- **Never access ALS at module top-level** - modules are cached; you'll hold reference to first request forever
- **Never use in static properties** - evaluated at import time, before any request context
- **Throw errors when context is unexpectedly missing** - silent fallbacks mask bugs
- **Use `run()` for bounded context** (preferred over `enterWith()`)

**Alternative consideration:** TanStack Start has built-in request context via middleware. Could use `handler.fetch(request, { context: { cache } })` instead of AsyncLocalStorage. However, this requires passing context through all function signatures, which is more invasive.

**Files to create:**

- [ ] `apps/web/src/lib/core/request-storage.ts`

**Success criteria:**

- [ ] New module compiles without errors
- [ ] Exports `requestStorage`, `getRequestCache`, `getRequestCacheOrNull`, `createRequestContext`
- [ ] Unit test: cache persists within request context

---

#### Phase 2: Update Caching Call Sites (MOVED UP - was Phase 6)

> **Why moved:** Must update imports BEFORE deleting tenant files to maintain compilable codebase.

Replace `tenantStorage.getStore()?.cache` with `getRequestCache()`.

**Files using request-scoped caching:**

| File                                              | Usage                                          |
| ------------------------------------------------- | ---------------------------------------------- |
| `lib/server/functions/auth-helpers.ts`            | Session/member caching (6 cache access points) |
| `lib/server/functions/workspace.ts`               | Settings caching                               |
| `lib/server/functions/bootstrap.ts`               | RequestContext building                        |
| `lib/server/domains/settings/settings.service.ts` | Settings + blob URLs                           |
| `lib/server/domains/statuses/status.service.ts`   | Status list caching                            |
| `lib/server/domains/tags/tag.service.ts`          | Tag list caching                               |

**Change pattern:**

```typescript
// Before
import { tenantStorage } from '@/lib/server/tenant'
const cache = tenantStorage.getStore()?.cache

// After
import { getRequestCacheOrNull } from '@/lib/core/request-storage'
const cache = getRequestCacheOrNull()
```

**Files to modify:**

- [ ] `apps/web/src/lib/server/functions/auth-helpers.ts`
- [ ] `apps/web/src/lib/server/functions/workspace.ts`
- [ ] `apps/web/src/lib/server/functions/bootstrap.ts`
- [ ] `apps/web/src/lib/server/domains/settings/settings.service.ts`
- [ ] `apps/web/src/lib/server/domains/statuses/status.service.ts`
- [ ] `apps/web/src/lib/server/domains/tags/tag.service.ts`

**Success criteria:**

- [ ] `bun run typecheck` passes (tenant module still exists but unused for caching)
- [ ] All caching still works (same API, different import)
- [ ] E2E tests pass

---

#### Phase 3: Remove Custom server.ts Entirely

TanStack Start provides a default server entry. Without tenant resolution, we don't need any custom middleware.

**Before (130+ lines):**

```typescript
// Complex: checks isMultiTenant(), resolves tenant from domain, etc.
if (!isMultiTenant()) {
  const settings = await db.query.settings.findFirst()
  const context = createContext('self-hosted', { ... })
  return tenantStorage.run(context, async () => { ... })
}
// ... 40 more lines of tenant resolution
```

**After: DELETE THE FILE**

TanStack Start uses its built-in server entry when no custom `server.ts` exists.

For request-scoped caching, we'll use TanStack Start's middleware system instead:

```typescript
// apps/web/src/entry-server.tsx (or equivalent TanStack Start entry point)
// Add requestStorage.run() wrapper in the middleware chain
```

**Alternative:** If we need request-scoped caching, add a simple middleware in the app's router configuration rather than a custom server entry.

### Research Insights: TanStack Start Patterns

- TanStack Start handles static assets, routing, and request handling automatically
- Custom `server.ts` is only needed for advanced use cases (multi-tenancy, custom proxies)
- For request caching, middleware or React's `cache()` are more idiomatic

**Files to delete:**

- [ ] `apps/web/src/server.ts` - Remove entirely (~130 lines)

**Success criteria:**

- [ ] No custom server.ts file
- [ ] `bun run dev` starts successfully with default TanStack Start server
- [ ] `bun run build` produces working output
- [ ] Static assets served correctly

---

#### Phase 4: Simplify Database Connection

Remove cloud branching but **keep Proxy pattern** for lazy initialization.

### Research Insights: Why Keep Proxy

The Proxy pattern is valuable because:

- Test environments may mock the DB
- Build-time imports don't need DB access
- Prevents crashes when `DATABASE_URL` isn't set during module loading

**Before:**

```typescript
// Complex proxy that switches between singleton and tenant DB
function getDatabase(): Database {
  if (process.env.CLOUD_CATALOG_DATABASE_URL) {
    const ctx = tenantStorage.getStore()
    if (ctx?.db) return ctx.db
    throw new Error('No tenant context')
  }
  // ... singleton logic
}
```

**After:**

```typescript
// apps/web/src/lib/core/db.ts
import { createDb, type Database as PostgresDatabase } from '@quackback/db/client'

// Simplified: only PostgresDatabase, not union with NeonDatabase
export type Database = PostgresDatabase

declare global {
  var __db: Database | undefined
}

function getDatabase(): Database {
  if (!globalThis.__db) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required')
    }
    globalThis.__db = createDb(connectionString, { max: 50 })
  }
  return globalThis.__db
}

// Keep proxy for lazy initialization
export const db: Database = new Proxy({} as Database, {
  get(_, prop) {
    const database = getDatabase()
    return (database as Record<string | symbol, unknown>)[prop]
  },
})

// Re-export drizzle operators and schema...
```

**Files to modify:**

- [ ] `apps/web/src/lib/core/db.ts` - Remove cloud branching, keep Proxy

**Success criteria:**

- [ ] No imports from tenant module
- [ ] `Database` type is just `PostgresDatabase` (not union)
- [ ] Proxy retained for lazy initialization
- [ ] `bun run typecheck` passes

---

#### Phase 5: Remove Feature Gating System Entirely

All features are always enabled for self-hosted. Delete the entire feature gating system.

### Why Remove Entirely?

- No features are gated → no gating system needed
- `hasFeature(X)` always returns `true` → just delete the check
- Removes ~1,400 lines of unnecessary abstraction
- Makes codebase immediately understandable

### Files to DELETE

**Core feature system:**

- [ ] `apps/web/src/lib/shared/features.ts` - Delete entirely (~340 lines)
- [ ] `apps/web/src/lib/server/features.ts` - Delete entirely (~180 lines)
- [ ] `apps/web/src/lib/client/hooks/use-features.ts` - Delete entirely (~80 lines)

**Upgrade/gating UI components:**

- [ ] `apps/web/src/components/admin/pro-upgrade-modal.tsx` - Delete (~150 lines)
- [ ] `apps/web/src/components/admin/upgrade-prompt.tsx` - Delete if exists
- [ ] Any `FeatureGate` wrapper components

### Call Sites to Update (~30 files)

Remove all `hasFeature()` and `checkFeatureAccess()` calls. Pattern:

**Before:**

```typescript
import { hasFeature, Feature } from '@/lib/shared/features'

if (!hasFeature(Feature.API_KEYS)) {
  return <UpgradePrompt feature="API Keys" />
}
return <ApiKeysSettings />
```

**After:**

```typescript
return <ApiKeysSettings />
```

**Files with feature checks to update:**

| File                                           | Feature Check               | Action        |
| ---------------------------------------------- | --------------------------- | ------------- |
| `settings/api-keys/api-keys-settings.tsx`      | `Feature.API_KEYS`          | Remove check  |
| `settings/webhooks/webhooks-settings.tsx`      | `Feature.WEBHOOKS`          | Remove check  |
| `settings/integrations/slack/slack-config.tsx` | `Feature.SLACK_INTEGRATION` | Remove check  |
| `admin/roadmap-admin.tsx`                      | `Feature.ROADMAP`           | Remove check  |
| `server/functions/api-keys.ts`                 | `checkFeatureAccess()`      | Remove check  |
| `server/functions/webhooks.ts`                 | `checkFeatureAccess()`      | Remove check  |
| `server/events/handlers/*.ts`                  | Various feature checks      | Remove checks |
| `routes/api/v1/*.ts`                           | API feature checks          | Remove checks |
| ~20 more files                                 | Various                     | Remove checks |

### Search Pattern for All Feature Checks

```bash
# Find all feature check call sites
grep -r "hasFeature\|checkFeatureAccess\|Feature\." apps/web/src/ --include="*.ts" --include="*.tsx"

# Find all feature imports
grep -r "from '@/lib/shared/features'\|from '@/lib/server/features'" apps/web/src/
```

**Success criteria:**

- [ ] No `features.ts` files exist
- [ ] No `hasFeature()` calls remain
- [ ] No `checkFeatureAccess()` calls remain
- [ ] No `Feature.` enum references remain
- [ ] No upgrade prompts/modals in UI
- [ ] `bun run typecheck` passes
- [ ] All settings pages render without gating

---

#### Phase 6: Delete Cloud and Custom OAuth Files (MOVED DOWN - was Phase 2)

> **Why moved:** Now safe to delete - nothing imports from these modules.

Remove files that are 100% cloud-specific or replaced by Better Auth built-ins.

**Directories to delete:**

- [ ] `apps/web/src/lib/server/tenant/` (entire directory including tests)
- [ ] `apps/web/src/lib/server/domains/catalog/` (entire directory)
- [ ] `packages/db/src/tenant/` (if exists)
- [ ] `deploy/cloud/` (entire directory)
- [ ] `ee/` (entire directory if exists - remove EE concept)

**Cloud infrastructure files to delete:**

- [ ] `apps/web/src/server.ts` (use TanStack Start default)
- [ ] `apps/web/src/lib/server/subscription.ts`
- [ ] `apps/web/src/lib/client/hooks/use-workspace-id.ts`
- [ ] `scripts/migrate-neon-dbs.ts`
- [ ] `scripts/prepare-edition.ts`
- [ ] `scripts/benchmark-db.ts` (uses catalog DB)
- [ ] `apps/web/src/routes/.edition-config.json`
- [ ] `apps/web/worker-configuration.d.ts` (Cloudflare Worker types)
- [ ] `apps/web/wrangler.jsonc` (Cloudflare config)

**Custom OAuth files to delete (replaced by Better Auth socialProviders):**

- [ ] `apps/web/src/routes/api/auth/oauth.$provider.ts`
- [ ] `apps/web/src/lib/server/auth/plugins/oauth-callback.ts`
- [ ] `apps/web/src/lib/server/auth/plugins/oauth-complete.ts`
- [ ] `apps/web/src/lib/server/auth/plugins/session-transfer.ts`
- [ ] `apps/web/src/lib/server/auth/oauth-state.ts`
- [ ] `apps/web/src/lib/server/auth/oauth-utils.ts`
- [ ] `apps/web/src/lib/server/auth/oidc.service.ts`
- [ ] `apps/web/src/routes/auth.auth-complete.tsx`

**Cloud-only routes to delete:**

- [ ] `apps/web/src/routes/_app.tsx`
- [ ] `apps/web/src/routes/_app/get-started.tsx`
- [ ] `apps/web/src/routes/admin/settings.domains.tsx`

**Verification script (run before deleting):**

```bash
# Verify nothing imports from tenant module
grep -r "from '@/lib/server/tenant'" apps/web/src/
# Should return: no results (we updated all imports in Phase 2)

# Verify nothing imports from custom OAuth modules
grep -r "oauth-callback\|oauth-complete\|oauth-state\|oauth-utils" apps/web/src/
# Should return: no results (replaced with Better Auth socialProviders)
```

**Success criteria:**

- [ ] All listed files/directories removed
- [ ] `bun run typecheck` passes (no orphaned imports)
- [ ] E2E tests pass

---

#### Phase 7: Replace Custom OAuth with Better Auth Built-in socialProviders

The custom OAuth plugins exist only for cross-domain auth (cloud multi-tenant). For self-hosted (single domain), Better Auth's built-in `socialProviders` handles everything.

### What We're Removing

**Custom OAuth flow (cloud multi-tenant):**

1. User clicks "Sign in with GitHub"
2. Custom route `/api/auth/oauth/github` builds signed state, redirects
3. GitHub redirects to custom callback plugin
4. Plugin exchanges code, creates signed JWT
5. Plugin redirects to tenant domain `/auth/auth-complete?token=JWT`
6. `oauth-complete` plugin verifies JWT, creates session

**Simplified OAuth flow (self-hosted):**

1. User clicks "Sign in with GitHub"
2. Better Auth redirects to GitHub
3. GitHub redirects to Better Auth's built-in callback
4. Better Auth handles code exchange, user creation, session

### Files to DELETE (~800 lines)

```
apps/web/src/routes/api/auth/oauth.$provider.ts    # Custom OAuth initiation (~200 lines)
apps/web/src/lib/server/auth/plugins/oauth-callback.ts  # Custom callback (~467 lines)
apps/web/src/lib/server/auth/plugins/oauth-complete.ts  # JWT completion (~150 lines)
apps/web/src/lib/server/auth/oauth-state.ts        # State signing (~100 lines)
apps/web/src/lib/server/auth/oauth-utils.ts        # URL builders (~80 lines)
apps/web/src/lib/server/auth/oidc.service.ts       # OIDC/SSO support (~200 lines)
apps/web/src/routes/auth.auth-complete.tsx         # JWT completion page (~50 lines)
ee/packages/sso/                                    # Entire SSO package (~500 lines)
```

### Simplified auth/index.ts

**Before (~300 lines with custom plugins):**

```typescript
// Get plugins
const sessionTransferPlugin = await getSessionTransferPlugin()
const oauthCallbackPlugin = await getOAuthCallbackPlugin()
const oauthCompletePlugin = await getOAuthCompletePlugin()

return betterAuth({
  // ... complex plugin loading
  plugins: [
    emailOTP({ ... }),
    magicLink({ ... }),
    oneTimeToken({ ... }),
    ...(sessionTransferPlugin ? [sessionTransferPlugin] : []),
    oauthCallbackPlugin,
    oauthCompletePlugin,
    tanstackStartCookies(),
  ],
})
```

**After (~150 lines):**

```typescript
// apps/web/src/lib/server/auth/index.ts
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP, magicLink } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { generateId } from '@quackback/ids'

export async function createAuth() {
  const { db, user: userTable, session: sessionTable, ... } = await import('@/lib/server/db')
  const { sendSigninCodeEmail } = await import('@quackback/email')

  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema: { ... } }),

    baseURL: process.env.BETTER_AUTH_URL,

    // Built-in social providers - handles everything automatically
    socialProviders: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      },
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    },

    emailAndPassword: { enabled: false },

    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['github', 'google'],
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24,
    },

    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // Auto-create member record with 'user' role
            // ... (keep existing logic)
          },
        },
      },
    },

    plugins: [
      emailOTP({ ... }),      // Portal user auth
      magicLink({ ... }),     // Team member invitations
      tanstackStartCookies(),
    ],
  })
}
```

### Update Auth UI Components

The auth components need to use Better Auth's built-in social login instead of our custom OAuth routes:

**Before:**

```typescript
// Custom OAuth URL construction
const oauthUrl = `/api/auth/oauth/${provider}?workspace=${slug}&returnDomain=${domain}&callbackUrl=${callback}`
```

**After:**

```typescript
// Better Auth's built-in social login
import { authClient } from '@/lib/client/auth'
await authClient.signIn.social({ provider: 'github', callbackURL: '/admin' })
```

**Files to update:**

- [ ] `apps/web/src/components/auth/oauth-buttons.tsx` - Use Better Auth social login
- [ ] `apps/web/src/components/auth/portal-auth-form.tsx` - Remove custom OAuth logic

### Files to DELETE

- [ ] `apps/web/src/routes/api/auth/oauth.$provider.ts`
- [ ] `apps/web/src/lib/server/auth/plugins/oauth-callback.ts`
- [ ] `apps/web/src/lib/server/auth/plugins/oauth-complete.ts`
- [ ] `apps/web/src/lib/server/auth/oauth-state.ts`
- [ ] `apps/web/src/lib/server/auth/oauth-utils.ts`
- [ ] `apps/web/src/lib/server/auth/oidc.service.ts`
- [ ] `apps/web/src/routes/auth.auth-complete.tsx`
- [ ] `ee/packages/sso/` (entire directory)

### Files to MODIFY

- [ ] `apps/web/src/lib/server/auth/index.ts` - Replace with simplified version
- [ ] `apps/web/src/components/auth/oauth-buttons.tsx` - Use Better Auth client
- [ ] `apps/web/src/components/auth/portal-auth-form.tsx` - Remove OIDC option
- [ ] `apps/web/src/routes/admin.login.tsx` - Remove SSO UI

### Settings Schema Updates

Remove SSO-related settings from `settings.authConfig`:

- [ ] Remove `sso` configuration object
- [ ] Remove `ssoRequired` field
- [ ] Keep `oauth` for GitHub/Google toggles (portal auth settings)

**Success criteria:**

- [ ] No custom OAuth plugins loaded
- [ ] `socialProviders` configured in Better Auth
- [ ] GitHub OAuth login works (manual test)
- [ ] Google OAuth login works (manual test)
- [ ] Email OTP login works (manual test)
- [ ] Magic link invitations work (manual test)
- [ ] No SSO/OIDC UI visible in settings

---

#### Phase 8: Simplify Integration Code

Remove `isMultiTenant()` branches from integrations.

**Files to modify:**

- [ ] `apps/web/src/lib/server/functions/integrations.ts` - Remove `isMultiTenant()` checks
- [ ] `apps/web/src/lib/server/functions/workspace-utils.ts` - Delete edition guard functions (MISSED in original)
- [ ] `apps/web/src/lib/server/domains/integrations/slack.ts` - Remove `isMultiTenant()` checks
- [ ] `apps/web/src/lib/server/events/hook-context.ts` - Remove catalog lookups, use `ROOT_URL` for portal URLs

**Edition guards to delete from `workspace-utils.ts`:**

- [ ] `requireEdition()`
- [ ] `requireSelfHostedEdition()`
- [ ] `requireCloudEdition()`

**Success criteria:**

- [ ] No `isMultiTenant()` calls remain
- [ ] Slack OAuth uses relative URLs only
- [ ] `hook-context.ts` uses `ROOT_URL` not catalog lookup

---

#### Phase 9: Clean Up Config & Environment

Remove CLOUD\_\* variables and EE references from config schema.

**Modify `lib/server/config/index.ts`:**

Remove from schema:

- [ ] `CLOUD_CATALOG_DATABASE_URL`
- [ ] `CLOUD_TENANT_BASE_DOMAIN`
- [ ] `CLOUD_APP_DOMAIN`
- [ ] `CLOUD_SESSION_TRANSFER_SECRET`
- [ ] `CLOUD_NEON_DEFAULT_REGION`
- [ ] `CLOUD_BILLING_URL`
- [ ] `EDITION` (delete entirely)
- [ ] `INCLUDE_EE` (delete entirely - no EE packages)

Remove from config object:

- [ ] `isCloud` getter
- [ ] `isSelfHosted` getter
- [ ] `isMultiTenant` getter

**Security improvement:** Enforce minimum secret length:

```typescript
BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
```

**Update `.env.example`:**

- [ ] Remove all `CLOUD_*` variables

**Files to modify:**

- [ ] `apps/web/src/lib/server/config/index.ts`
- [ ] `apps/web/.env.example`

**Success criteria:**

- [ ] Config schema only contains self-hosted variables
- [ ] `.env.example` is clean and simple

---

#### Phase 10: Clean Up Routes & Components

Remove cloud-specific UI handling.

**Modify routes:**

- [ ] `apps/web/src/routes/__root.tsx` - Remove `app-domain`/`unknown` context handling
- [ ] `apps/web/src/routes/admin/settings.tsx` - Remove `isCloud` prop passing

**Remove components:**

- [ ] `apps/web/src/components/workspace-not-found.tsx` - Only used for cloud "unknown tenant"
- [ ] Simplify `apps/web/src/components/admin/pro-upgrade-modal.tsx` - Remove cloud tier references

**Files to modify:**

- [ ] `apps/web/src/routes/__root.tsx`
- [ ] `apps/web/src/routes/admin/settings.tsx`
- [ ] `apps/web/src/components/admin/settings/settings-nav.tsx` - Remove `cloudOnly`/`selfHostedOnly` filtering

**Success criteria:**

- [ ] No `contextType === 'app-domain'` checks
- [ ] Settings nav shows all items (no cloud filtering)
- [ ] No "Upgrade to Pro" prompts appear

---

#### Phase 11: Clean Up Build Configuration

Remove cloud build variant.

**Modify `vite.config.ts`:**

- [ ] Remove `EDITION` variable and `USE_CLOUDFLARE` flag
- [ ] Remove Cloudflare plugin conditional
- [ ] Always use Nitro with Bun preset
- [ ] Remove `__EDITION__` define

**Remove from `package.json`:**

- [ ] `dev:cloud` script
- [ ] `build:cloud` script
- [ ] `deploy:cloud:*` scripts

**Files to modify:**

- [ ] `apps/web/vite.config.ts`
- [ ] `package.json`

**Success criteria:**

- [ ] Single build configuration
- [ ] No cloud-related npm scripts
- [ ] `bun run build` produces Nitro output (`.output/server/index.mjs`)
- [ ] Built server starts and responds to requests

---

#### Phase 12: Update Types & Exports

Fix any remaining type errors from deleted modules.

**Type updates needed:**

- [ ] Remove `NeonDatabase` from `Database` union type (done in Phase 4)
- [ ] Remove `TenantContext` type exports
- [ ] Remove `RequestContext` discriminated union variants
- [ ] Update any files that imported from deleted modules

**Files to check:**

- [ ] `apps/web/src/lib/core/db.ts` - Type exports
- [ ] `apps/web/src/lib/server/functions/bootstrap.ts` - RequestContext usage
- [ ] Any remaining import errors from `bun run typecheck`

**Verification script:**

```bash
#!/bin/bash
# scripts/verify-cloud-removal.sh
set -e

echo "Checking for cloud code remnants..."

if grep -r "from '@/lib/server/tenant'" apps/web/src/; then
  echo "ERROR: Found tenant imports"; exit 1
fi

if grep -r "CLOUD_CATALOG_DATABASE_URL\|CLOUD_APP_DOMAIN" apps/web/src/ --include="*.ts" --include="*.tsx"; then
  echo "ERROR: Found CLOUD_ env var references"; exit 1
fi

if grep -r "isMultiTenant()\|isCloud()" apps/web/src/ --include="*.ts" --include="*.tsx"; then
  echo "ERROR: Found edition check functions"; exit 1
fi

echo "✓ All cloud code removed successfully"
```

**Success criteria:**

- [ ] `bun run typecheck` passes
- [ ] No imports from deleted modules
- [ ] Verification script passes

---

#### Phase 13: Update Documentation

Reflect simplified architecture.

**Update CLAUDE.md:**

- [ ] Remove multi-tenant architecture description
- [ ] Simplify lib/ layer documentation
- [ ] Remove CLOUD\_\* env var references
- [ ] Remove `INCLUDE_EE` and EE packages section entirely
- [ ] Update database access documentation (remove mention of tenant context)
- [ ] Remove `server/tenant/` from architecture diagram
- [ ] Remove `ee/packages/` from architecture diagram
- [ ] Update license section (pure AGPL, no proprietary EE)

**Update README (if applicable):**

- [ ] Single deployment mode
- [ ] Simplified environment variables
- [ ] Remove cloud setup instructions
- [ ] Remove any EE/enterprise references

**Success criteria:**

- [ ] CLAUDE.md reflects actual simplified architecture
- [ ] No EE/enterprise references in documentation
- [ ] New contributors see clean, simple documentation

---

## Testing Strategy

### Pre-flight (before Phase 1)

```bash
- [ ] Run all E2E tests: bun run test:e2e
- [ ] Record baseline: All tests pass
- [ ] Run typecheck: bun run typecheck (should pass)
- [ ] Run build: bun run build (should succeed)
- [ ] Record performance baseline: wrk -t4 -c10 -d10s http://localhost:3000/
```

### After Phase 5 (major milestone)

```bash
- [ ] bun run typecheck passes
- [ ] bun run test:e2e passes
- [ ] Manual smoke test: Login, create post, comment
```

### After Phase 12 (final validation)

```bash
- [ ] Full E2E suite passes
- [ ] Performance comparison: within 10% of baseline
- [ ] Verification script passes
```

### Manual Testing Checklist

**Authentication (using Better Auth socialProviders):**

- [ ] Email OTP login (portal user)
- [ ] GitHub OAuth login (Better Auth built-in)
- [ ] Google OAuth login (Better Auth built-in)
- [ ] Magic link invitation acceptance (team member)
- [ ] Role assignment works (admin/member/user)

**Core Features:**

- [ ] Create post (public portal)
- [ ] Vote on post
- [ ] Comment on post
- [ ] Admin inbox view
- [ ] Roadmap view
- [ ] Settings > Branding
- [ ] Settings > Statuses
- [ ] Settings > API Keys (no upgrade prompt)
- [ ] Settings > Webhooks (no upgrade prompt)

**Integrations:**

- [ ] Slack OAuth connection flow
- [ ] Webhook delivery test

---

## Acceptance Criteria

### Functional Requirements

- [ ] `bun run dev` starts successfully (no custom server.ts)
- [ ] `bun run build` completes without errors
- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes
- [ ] Email OTP authentication works (portal users)
- [ ] GitHub/Google OAuth authentication works (Better Auth socialProviders)
- [ ] Magic link invitations work (team member onboarding)
- [ ] Team roles preserved: admin, member, user
- [ ] All features accessible (no feature gating system exists)
- [ ] Slack integration OAuth works
- [ ] Settings pages load correctly (no SSO settings)
- [ ] Admin inbox, roadmap, users pages work

### Non-Functional Requirements

- [ ] Codebase reduced by ~4500+ lines
- [ ] No `CLOUD_*` environment variables required
- [ ] No `INCLUDE_EE` or EE package references remain
- [ ] No `isCloud()` or `isMultiTenant()` function calls remain
- [ ] No `hasFeature()` or feature gating calls remain
- [ ] Single build configuration
- [ ] Pure AGPL license (no proprietary components)
- [ ] Request latency within 10% of previous (caching preserved)

### Quality Gates

- [ ] All existing E2E tests pass
- [ ] Manual smoke test of auth flows
- [ ] Manual smoke test of core features
- [ ] Security review of OAuth changes
- [ ] Code review approval

---

## Success Metrics

| Metric                          | Before   | After   | Target          |
| ------------------------------- | -------- | ------- | --------------- |
| Lines of code removed           | -        | TBD     | -4500+          |
| Custom OAuth plugin lines       | ~1,200   | 0       | 0               |
| Feature gating system lines     | ~750     | 0       | 0               |
| `hasFeature()` call sites       | ~30      | 0       | 0               |
| server.ts lines                 | ~130     | 0       | 0 (use default) |
| Environment variables required  | 15+      | 4-5     | <6              |
| Build configurations            | 2        | 1       | 1               |
| `isCloud()` call sites          | 12+      | 0       | 0               |
| Custom auth plugins             | 4        | 0       | 0               |
| EE package references           | Multiple | 0       | 0               |
| Time to understand architecture | Hours    | <1 hour | <1 hour         |
| TypeScript compile time         | TBD      | TBD     | Similar         |
| Server startup time             | TBD      | TBD     | Similar         |

---

## Dependencies & Prerequisites

- Current refactor branch (`refactor/lib-layer-based-architecture`) should be merged or rebased first
- No active cloud deployments that would be broken (confirm with team)

---

## Risk Analysis & Mitigation

| Risk                                  | Likelihood | Impact | Mitigation                                                      |
| ------------------------------------- | ---------- | ------ | --------------------------------------------------------------- |
| Better Auth socialProviders migration | Medium     | High   | Test all OAuth providers manually; Better Auth handles security |
| Request caching breaks                | Low        | Medium | New requestStorage uses same API; unit tests                    |
| Type errors cascade                   | Medium     | Low    | Fix incrementally, run typecheck after each phase               |
| Missing file deletion                 | Low        | Low    | Verification script checks for orphaned imports                 |
| Auth UI component updates             | Medium     | Medium | Update OAuth buttons to use Better Auth client SDK              |
| Magic link invitations still work     | Low        | Medium | Keep magicLink plugin, test invitation flow                     |

---

## Security Considerations

### Security Improvements from This Refactor

1. **Better Auth handles OAuth security** - Built-in PKCE, state management, CSRF protection
2. **Remove session-transfer endpoint** - Eliminates privileged cross-domain attack surface
3. **Remove custom OAuth plugins** - Less custom security-critical code to maintain
4. **Remove SSO complexity** - No OIDC discovery, token validation, or enterprise auth surface
5. **Simpler configuration** - Fewer env vars = fewer misconfiguration opportunities

### Security Features Preserved

- OAuth PKCE (handled by Better Auth)
- CSRF protection (handled by Better Auth)
- Role-based access control (admin/member/user)
- Better Auth session management
- Account linking with trusted providers

### Recommended: Enforce Minimum Secret Length

```typescript
BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
```

---

## Future Considerations

When cloud/enterprise functionality is needed later, it can be added as a **separate repository or wrapper layer**:

```
quackback-cloud/              # Separate repo, not ee/ in main repo
├── server.ts                 # Wraps apps/web with tenant resolution
├── tenant/                   # All multi-tenant logic
├── catalog/                  # Workspace/subscription management
├── enterprise/               # SSO, SCIM, audit logging
└── middleware/               # Request interception
```

The core `quackback` repo remains pure open source (AGPL), and cloud/enterprise adds behavior on top without modifying core code. This keeps the main repo clean and contributor-friendly.

---

## References

### Internal References

- Architecture brainstorm: `docs/brainstorms/2026-02-01-architecture-review-brainstorm.md`
- Current server.ts: `apps/web/src/server.ts`
- Current db.ts: `apps/web/src/lib/core/db.ts`
- Current features: `apps/web/src/lib/shared/features.ts`

### External References

- [Node.js AsyncLocalStorage Documentation](https://nodejs.org/api/async_context.html)
- [TanStack Start Middleware Guide](https://tanstack.com/start/latest/docs/framework/react/guide/middleware)
- [AdonisJS Async Local Storage Patterns](https://docs.adonisjs.com/guides/concepts/async-local-storage)

### Files to Delete (Summary)

**Cloud/Multi-tenant Infrastructure:**

```
apps/web/src/lib/server/tenant/           # ~400 lines
apps/web/src/lib/server/domains/catalog/  # ~200 lines
apps/web/src/lib/server/subscription.ts   # ~50 lines
apps/web/src/lib/client/hooks/use-workspace-id.ts  # ~30 lines
deploy/cloud/                             # ~500 lines
scripts/migrate-neon-dbs.ts               # ~100 lines
scripts/prepare-edition.ts                # ~50 lines
scripts/benchmark-db.ts                   # ~50 lines
apps/web/worker-configuration.d.ts        # ~20 lines
apps/web/wrangler.jsonc                   # ~30 lines
```

**Custom OAuth (replaced with Better Auth socialProviders):**

```
apps/web/src/routes/api/auth/oauth.$provider.ts     # ~200 lines
apps/web/src/lib/server/auth/plugins/oauth-callback.ts  # ~467 lines
apps/web/src/lib/server/auth/plugins/oauth-complete.ts  # ~150 lines
apps/web/src/lib/server/auth/plugins/session-transfer.ts  # ~100 lines
apps/web/src/lib/server/auth/oauth-state.ts         # ~100 lines
apps/web/src/lib/server/auth/oauth-utils.ts         # ~80 lines
apps/web/src/lib/server/auth/oidc.service.ts        # ~200 lines
apps/web/src/routes/auth.auth-complete.tsx          # ~50 lines
```

**EE (Enterprise Edition) Concept:**

```
ee/                                       # Directory doesn't exist yet - remove concept entirely
INCLUDE_EE config variable                # Remove from config schema
EE references in CLAUDE.md                # Remove architecture section
```

**Feature Gating System (DELETE ENTIRELY):**

```
apps/web/src/lib/shared/features.ts       # ~340 lines
apps/web/src/lib/server/features.ts       # ~180 lines
apps/web/src/lib/client/hooks/use-features.ts  # ~80 lines
apps/web/src/components/admin/pro-upgrade-modal.tsx  # ~150 lines
```

**Cloud-only Routes:**

```
apps/web/src/routes/_app.tsx              # ~50 lines
apps/web/src/routes/_app/get-started.tsx  # ~100 lines
apps/web/src/routes/admin/settings.domains.tsx  # ~200 lines
```

**Custom Server Entry:**

```
apps/web/src/server.ts                    # ~130 lines (DELETE entirely)
```

**Total estimated deletion: ~4,000+ lines**

> Note: ee/packages/ doesn't exist yet, so no actual code deletion there - just removing the concept and references.

### Files to Simplify (Summary)

```
apps/web/src/lib/core/db.ts               # 200 → ~120 lines
apps/web/src/lib/server/auth/index.ts     # 300 → ~150 lines
apps/web/src/lib/server/config/index.ts   # Remove ~50 lines (CLOUD_* vars)
apps/web/src/lib/server/functions/workspace-utils.ts  # Delete ~50 lines
apps/web/src/components/auth/oauth-buttons.tsx  # Simplify ~50 lines
apps/web/src/routes/admin.login.tsx       # Remove SSO UI ~30 lines
+ ~30 files with feature check removals  # ~400 lines of hasFeature() calls
```

**Total estimated simplification: ~850+ lines**

**Grand total reduction: ~4,850+ lines**
