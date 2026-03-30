# Import Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent server-only code (postgres, database) from leaking into client bundles, with a lean and self-enforcing import protection configuration.

**Architecture:** Three layers of defense: (1) TanStack Start import protection blocks dangerous specifiers from client bundles, (2) `@tanstack/react-start/server-only` file markers on critical server files, (3) domain barrel exports standardized to types-only so the convention reinforces the protection. The result is a 4-specifier config that catches all database leaks.

**Tech Stack:** TanStack Start import protection plugin, `@tanstack/react-start/server-only` markers, Vite

---

## Context: How Server Functions Work Here

TanStack Start server functions (in `lib/server/functions/`) are wrapped with `createServerFn()` and are **designed** to be imported by client code. The framework handles the server/client split. So `lib/server/functions/` is NOT a problem — the issue is direct imports of database modules and service files that bypass the server function boundary.

## Context: Why `import type` Is Safe

esbuild (Vite's TS compiler) strips `import type` declarations before Vite's module scanner sees them. So `import type { Webhook } from '@/lib/server/domains/webhooks'` never causes the module to be resolved in the client bundle. The barrel cleanup in this plan is defense-in-depth — it prevents future mistakes where someone writes `import { Webhook }` without `type`.

## Final Import Protection Config

After all tasks, the config will be:

```typescript
importProtection: {
  behavior: { dev: 'error', build: 'error' },
  client: {
    specifiers: ['postgres', '@quackback/db', '@quackback/db/client', '@quackback/db/schema'],
  },
},
```

Four specifiers. `@quackback/db/types` is allowed through (safe — no runtime code).

---

## Phase 1: Fix the Leak + Protection Config

### Task 1: Fix the postgres leak in feedback-types.ts

The confirmed leak chain: `feedback-types.ts` → `import type from @/lib/server/db` → `export from @quackback/db` → `export * from ./src/schema` → postgres. Even though it's `import type`, the barrel re-export in db.ts causes Vite to resolve the entire module graph.

**Files:**

- Modify: `apps/web/src/components/admin/feedback/feedback-types.ts:8`

- [ ] **Step 1: Update the import**

`RawFeedbackAuthor` and `RawFeedbackContent` are already available via `@quackback/db/types`, which `lib/shared/db-types.ts` re-exports with `export type *`.

```typescript
// Before (line 8):
import type { RawFeedbackAuthor, RawFeedbackContent } from '@/lib/server/db'

// After:
import type { RawFeedbackAuthor, RawFeedbackContent } from '@/lib/shared/db-types'
```

- [ ] **Step 2: Verify types resolve**

Run: `cd apps/web && bunx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors mentioning `RawFeedbackAuthor` or `RawFeedbackContent`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/admin/feedback/feedback-types.ts
git commit -m "Fix postgres leak: import feedback types from shared db-types"
```

---

### Task 2: Add server-only markers to critical server files

These files contain database connections, secrets, and server infrastructure. Marking them `server-only` means any accidental client import immediately errors — even in dev.

**Files:**

- Modify: `apps/web/src/lib/server/db.ts` (line 1)
- Modify: `apps/web/src/lib/server/config.ts` (line 1)
- Modify: `apps/web/src/lib/server/encryption.ts` (line 1)
- Modify: `apps/web/src/lib/server/redis.ts` (line 1)

- [ ] **Step 1: Add the marker to db.ts**

Add as the very first line, before the docblock:

```typescript
import '@tanstack/react-start/server-only'
```

- [ ] **Step 2: Add the marker to config.ts, encryption.ts, redis.ts**

Same — add `import '@tanstack/react-start/server-only'` as the first line of each file.

- [ ] **Step 3: Verify dev server works**

Run: `bun run dev` and load `http://localhost:3000` in the browser.

Expected: App loads normally. The `import type` statements from domain `.types.ts` files that reference `@/lib/server/db` are stripped by esbuild before the server-only check fires, so they won't error. If they DO error, remove the marker from `db.ts` only and rely on the specifier-based protection instead (Task 3).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/server/db.ts apps/web/src/lib/server/config.ts apps/web/src/lib/server/encryption.ts apps/web/src/lib/server/redis.ts
git commit -m "Add server-only markers to db, config, encryption, redis"
```

---

### Task 3: Finalize import protection config

**Files:**

- Modify: `apps/web/vite.config.ts:66-71`

- [ ] **Step 1: Update specifiers**

```typescript
importProtection: {
  behavior: { dev: 'error', build: 'error' },
  client: {
    specifiers: ['postgres', '@quackback/db', '@quackback/db/client', '@quackback/db/schema'],
  },
},
```

This blocks:

- `postgres` — catches any transitive import of the postgres driver
- `@quackback/db` — main barrel (schema tables depend on postgres)
- `@quackback/db/client` — direct database client
- `@quackback/db/schema` — schema tables (depend on client.ts → postgres)

This allows through:

- `@quackback/db/types` — type-only, no runtime code, no postgres dependency

- [ ] **Step 2: Verify dev server starts clean**

Run: `bun run dev` and load the app.
Expected: No import protection errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/vite.config.ts
git commit -m "Import protection: block postgres and unsafe @quackback/db subpaths"
```

---

### Task 4: Smoke test the protection

- [ ] **Step 1: Introduce a deliberate violation**

Temporarily add to `apps/web/src/components/admin/feedback/feedback-types.ts`:

```typescript
import { db } from '@quackback/db/client'
console.log(db)
```

- [ ] **Step 2: Verify it's caught**

Load the app in the browser. Expected: Vite error about `@quackback/db/client` being blocked in client code.

- [ ] **Step 3: Revert the test**

Remove the temporary import. Verify the app loads cleanly again.

---

## Phase 2: Standardize Domain Barrels to Types-Only

Convention: every `domains/*/index.ts` barrel exports **only types**. Server code imports service functions directly from the `.service.ts` file. This makes the architecture self-documenting and prevents future leaks even without import protection.

### Task 5: Extract webhook types to dedicated file

The `Webhook`, `CreateWebhookInput`, `CreateWebhookResult`, `UpdateWebhookInput` types live in `webhook.service.ts`. Extract them so the barrel can export types without pulling in the service.

**Files:**

- Create: `apps/web/src/lib/server/domains/webhooks/webhook.types.ts`
- Modify: `apps/web/src/lib/server/domains/webhooks/webhook.service.ts:18-49`
- Modify: `apps/web/src/lib/server/domains/webhooks/index.ts`

- [ ] **Step 1: Create webhook.types.ts**

```typescript
import type { WebhookId, PrincipalId } from '@quackback/ids'

export interface Webhook {
  id: WebhookId
  url: string
  events: string[]
  boardIds: string[] | null
  status: 'active' | 'disabled'
  failureCount: number
  lastError: string | null
  lastTriggeredAt: Date | null
  createdAt: Date
  updatedAt: Date
  createdById: PrincipalId
}

export interface CreateWebhookInput {
  url: string
  events: string[]
  boardIds?: string[]
}

export interface CreateWebhookResult {
  webhook: Webhook
  /** The signing secret - only returned on creation, never stored in plain text retrieval */
  secret: string
}

export interface UpdateWebhookInput {
  url?: string
  events?: string[]
  boardIds?: string[] | null
  status?: 'active' | 'disabled'
}
```

- [ ] **Step 2: Update webhook.service.ts**

Remove the four interface/type definitions (lines 18-49) and replace with:

```typescript
import type {
  Webhook,
  CreateWebhookInput,
  CreateWebhookResult,
  UpdateWebhookInput,
} from './webhook.types'
export type { Webhook, CreateWebhookInput, CreateWebhookResult, UpdateWebhookInput }
```

The `export type` re-export keeps backward compatibility for any code importing types from the service file directly.

- [ ] **Step 3: Update barrel to types-only**

Replace `apps/web/src/lib/server/domains/webhooks/index.ts`:

```typescript
/**
 * Webhooks module - Types Only
 *
 * Import service functions directly from './webhook.service' in server-only code.
 */
export type {
  Webhook,
  CreateWebhookInput,
  CreateWebhookResult,
  UpdateWebhookInput,
} from './webhook.types'
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && bunx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors. All client imports use `import type { Webhook }` and the barrel still exports it. The one server import (`api/webhooks.ts:6`) also uses `import type`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/domains/webhooks/
git commit -m "Extract webhook types, make barrel types-only"
```

---

### Task 6: Extract api-key types to dedicated file

Same pattern as Task 5. `ApiKey`, `ApiKeyId`, `CreateApiKeyInput`, `CreateApiKeyResult` live in `api-key.service.ts`.

**Files:**

- Create: `apps/web/src/lib/server/domains/api-keys/api-key.types.ts`
- Modify: `apps/web/src/lib/server/domains/api-keys/api-key.service.ts:21-44`
- Modify: `apps/web/src/lib/server/domains/api-keys/index.ts`
- Modify: `apps/web/src/lib/server/domains/api/auth.ts:8`

- [ ] **Step 1: Create api-key.types.ts**

```typescript
import type { TypeId, PrincipalId } from '@quackback/ids'

export type ApiKeyId = TypeId<'api_key'>

export interface ApiKey {
  id: ApiKeyId
  name: string
  keyPrefix: string
  createdById: PrincipalId | null
  principalId: PrincipalId
  lastUsedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
  revokedAt: Date | null
}

export interface CreateApiKeyInput {
  name: string
  expiresAt?: Date | null
}

export interface CreateApiKeyResult {
  apiKey: ApiKey
  /** The full API key - only returned on creation, never stored */
  plainTextKey: string
}
```

- [ ] **Step 2: Update api-key.service.ts**

Remove the type definitions (lines 21-44) and replace with:

```typescript
import type { ApiKey, ApiKeyId, CreateApiKeyInput, CreateApiKeyResult } from './api-key.types'
export type { ApiKey, ApiKeyId, CreateApiKeyInput, CreateApiKeyResult }
```

- [ ] **Step 3: Update barrel to types-only**

Replace `apps/web/src/lib/server/domains/api-keys/index.ts`:

```typescript
/**
 * API Keys module - Types Only
 *
 * Import service functions directly from './api-key.service' in server-only code.
 */
export type { ApiKey, ApiKeyId, CreateApiKeyInput, CreateApiKeyResult } from './api-key.types'
```

- [ ] **Step 4: Update api/auth.ts to import service directly**

`apps/web/src/lib/server/domains/api/auth.ts:8`:

```typescript
// Before:
import { verifyApiKey, type ApiKey } from '@/lib/server/domains/api-keys'

// After:
import { verifyApiKey } from '@/lib/server/domains/api-keys/api-key.service'
import type { ApiKey } from '@/lib/server/domains/api-keys'
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && bunx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/domains/api-keys/ apps/web/src/lib/server/domains/api/auth.ts
git commit -m "Extract api-key types, make barrel types-only"
```

---

### Task 7: Fix changelog barrel to types-only

The changelog barrel already has `changelog.types.ts` — just remove the service re-exports and update importers.

**Files:**

- Modify: `apps/web/src/lib/server/domains/changelog/index.ts`
- Modify: `apps/web/src/lib/server/functions/changelog.ts:12-22`
- Modify: `apps/web/src/routes/api/v1/changelog/index.ts:10`

- [ ] **Step 1: Update barrel**

Replace `apps/web/src/lib/server/domains/changelog/index.ts`:

```typescript
/**
 * Changelog Domain - Types Only
 *
 * Import service functions directly:
 *   - './changelog.service' for CRUD
 *   - './changelog.query' for list/search
 *   - './changelog.public' for public-facing queries
 */
export type {
  CreateChangelogInput,
  UpdateChangelogInput,
  PublishState,
  ListChangelogParams,
  ChangelogEntryWithDetails,
  ChangelogListResult,
  ChangelogAuthor,
  ChangelogLinkedPost,
  PublicChangelogEntry,
  PublicChangelogLinkedPost,
  PublicChangelogListResult,
} from './changelog.types'
```

- [ ] **Step 2: Update functions/changelog.ts**

```typescript
// Before (lines 12-22):
import {
  createChangelog,
  updateChangelog,
  deleteChangelog,
  getChangelogById,
  listChangelogs,
  getPublicChangelogById,
  listPublicChangelogs,
  searchShippedPosts,
  type PublishState,
} from '@/lib/server/domains/changelog'

// After:
import {
  createChangelog,
  updateChangelog,
  deleteChangelog,
  getChangelogById,
} from '@/lib/server/domains/changelog/changelog.service'
import { listChangelogs, searchShippedPosts } from '@/lib/server/domains/changelog/changelog.query'
import {
  getPublicChangelogById,
  listPublicChangelogs,
} from '@/lib/server/domains/changelog/changelog.public'
import type { PublishState } from '@/lib/server/domains/changelog'
```

- [ ] **Step 3: Update routes/api/v1/changelog/index.ts**

```typescript
// Before (line 10):
import { listChangelogs, createChangelog } from '@/lib/server/domains/changelog'

// After:
import { createChangelog } from '@/lib/server/domains/changelog/changelog.service'
import { listChangelogs } from '@/lib/server/domains/changelog/changelog.query'
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && bunx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/domains/changelog/ apps/web/src/lib/server/functions/changelog.ts apps/web/src/routes/api/v1/changelog/
git commit -m "Make changelog barrel types-only"
```

---

### Task 8: Fix help-center barrel to types-only

Same pattern — `help-center.types.ts` already exists.

**Files:**

- Modify: `apps/web/src/lib/server/domains/help-center/index.ts`
- Modify: `apps/web/src/lib/server/functions/help-center.ts:9-27`
- Modify: `apps/web/src/routes/api/widget/kb-search.ts:3`
- Modify: `apps/web/src/routes/api/v1/kb/categories/index.ts:12`
- Modify: `apps/web/src/routes/api/v1/kb/categories/$categoryId.ts:13`
- Modify: `apps/web/src/routes/api/v1/kb/articles/index.ts:13`
- Modify: `apps/web/src/routes/api/v1/kb/articles/$articleId.ts:19`
- Modify: `apps/web/src/routes/api/v1/kb/articles/$articleId.feedback.ts:12`

- [ ] **Step 1: Update barrel**

Replace `apps/web/src/lib/server/domains/help-center/index.ts`:

```typescript
/**
 * Help Center Domain - Types Only
 *
 * Import service functions directly from './help-center.service' in server-only code.
 */
export type {
  HelpCenterCategory,
  HelpCenterCategoryWithCount,
  HelpCenterArticle,
  HelpCenterArticleWithCategory,
  CreateCategoryInput,
  UpdateCategoryInput,
  CreateArticleInput,
  UpdateArticleInput,
  ListArticlesParams,
  ArticleListResult,
  PublicArticleListResult,
} from './help-center.types'
```

- [ ] **Step 2: Update all server importers**

For every file that imports runtime functions from the barrel, change to import from `./help-center.service` directly.

`apps/web/src/lib/server/functions/help-center.ts:9-27`:

```typescript
// Before:
import {
  listCategories,
  listPublicCategories,
  getCategoryById,
  getCategoryBySlug,
  createCategory,
  updateCategory,
  deleteCategory,
  listArticles,
  listPublicArticles,
  getArticleById,
  getPublicArticleBySlug,
  createArticle,
  updateArticle,
  publishArticle,
  unpublishArticle,
  deleteArticle,
  recordArticleFeedback,
} from '@/lib/server/domains/help-center'

// After:
import {
  listCategories,
  listPublicCategories,
  getCategoryById,
  getCategoryBySlug,
  createCategory,
  updateCategory,
  deleteCategory,
  listArticles,
  listPublicArticles,
  getArticleById,
  getPublicArticleBySlug,
  createArticle,
  updateArticle,
  publishArticle,
  unpublishArticle,
  deleteArticle,
  recordArticleFeedback,
} from '@/lib/server/domains/help-center/help-center.service'
```

For each API route under `routes/api/v1/kb/` and `routes/api/widget/kb-search.ts`:

```typescript
// Change all:
from '@/lib/server/domains/help-center'
// To:
from '@/lib/server/domains/help-center/help-center.service'
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && bunx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/server/domains/help-center/ apps/web/src/lib/server/functions/help-center.ts apps/web/src/routes/api/
git commit -m "Make help-center barrel types-only"
```

---

### Task 9: Fix notifications barrel to types-only

`notification.types.ts` already exists with all types.

**Files:**

- Modify: `apps/web/src/lib/server/domains/notifications/index.ts`
- Modify: `apps/web/src/lib/server/functions/notifications.ts:9-15`
- Modify: `apps/web/src/lib/server/events/handlers/notification.ts:11`

- [ ] **Step 1: Update barrel**

Replace `apps/web/src/lib/server/domains/notifications/index.ts`:

```typescript
/**
 * Notification module - Types Only
 *
 * Import service functions directly from './notification.service' in server-only code.
 */
export type * from './notification.types'
```

- [ ] **Step 2: Update importers**

`apps/web/src/lib/server/functions/notifications.ts:9-15`:

```typescript
// Before:
import {
  getNotificationsForMember,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  archiveNotification,
} from '@/lib/server/domains/notifications'

// After:
import {
  getNotificationsForMember,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  archiveNotification,
} from '@/lib/server/domains/notifications/notification.service'
```

`apps/web/src/lib/server/events/handlers/notification.ts:11`:

```typescript
// Before:
import { createNotificationsBatch } from '@/lib/server/domains/notifications'

// After:
import { createNotificationsBatch } from '@/lib/server/domains/notifications/notification.service'
```

Line 12 (`import type { ... } from '@/lib/server/domains/notifications'`) stays as-is — the barrel still exports types.

- [ ] **Step 3: Typecheck and commit**

```bash
cd apps/web && bunx tsc --noEmit --pretty 2>&1 | head -30
git add apps/web/src/lib/server/domains/notifications/ apps/web/src/lib/server/functions/notifications.ts apps/web/src/lib/server/events/handlers/notification.ts
git commit -m "Make notifications barrel types-only"
```

---

### Task 10: Fix segments barrel to types-only

`segment.types.ts` already exists. Also fix its import to not reference `@/lib/server/db`.

**Files:**

- Modify: `apps/web/src/lib/server/domains/segments/index.ts`
- Modify: `apps/web/src/lib/server/domains/segments/segment.types.ts:6`

- [ ] **Step 1: Update segment.types.ts import**

```typescript
// Before (line 6):
import type { SegmentRules, EvaluationSchedule, SegmentWeightConfig } from '@/lib/server/db'

// After:
import type { SegmentRules, EvaluationSchedule, SegmentWeightConfig } from '@/lib/shared/db-types'
```

- [ ] **Step 2: Update barrel**

Replace `apps/web/src/lib/server/domains/segments/index.ts`:

```typescript
/**
 * Segment module - Types Only
 *
 * Import service functions directly:
 *   - './segment.service' for CRUD
 *   - './segment.evaluation' for evaluation logic
 */
export type * from './segment.types'
```

- [ ] **Step 3: Verify no runtime imports from barrel**

Run: `grep -rn "from '@/lib/server/domains/segments'" apps/web/src/`

Expected: Only `import type` usage remains (e.g., `functions/admin.ts:48`). No runtime imports from the barrel.

If any runtime imports exist, update them to point to `./segment.service` or `./segment.evaluation` directly.

- [ ] **Step 4: Typecheck and commit**

```bash
cd apps/web && bunx tsc --noEmit --pretty 2>&1 | head -30
git add apps/web/src/lib/server/domains/segments/
git commit -m "Make segments barrel types-only, fix db import"
```

---

### Task 11: Fix remaining barrels (embeddings, summary, ai, sentiment, merge-suggestions)

These barrels are only imported by other server code, so the change is lower risk. For consistency, make them all types-only.

**Files:**

- Modify: `apps/web/src/lib/server/domains/embeddings/index.ts`
- Modify: `apps/web/src/lib/server/domains/summary/index.ts`
- Modify: `apps/web/src/lib/server/domains/ai/index.ts`
- Modify: `apps/web/src/lib/server/domains/sentiment/index.ts`
- Modify: `apps/web/src/lib/server/domains/merge-suggestions/index.ts`
- Modify: `apps/web/src/lib/server/events/handlers/ai.ts:10-11`
- Modify: `apps/web/src/lib/server/events/handlers/summary.ts:10`
- Modify: `apps/web/src/lib/server/functions/merge-suggestions.ts:13-17`

- [ ] **Step 1: Update embeddings barrel**

Replace `apps/web/src/lib/server/domains/embeddings/index.ts`:

```typescript
/**
 * Embeddings module - Types Only
 *
 * Import service functions directly from './embedding.service' in server-only code.
 */
// No types to export — this domain only has service functions.
export {}
```

- [ ] **Step 2: Update summary barrel**

Replace `apps/web/src/lib/server/domains/summary/index.ts`:

```typescript
/**
 * Summary module - Types Only
 *
 * Import service functions directly from './summary.service' in server-only code.
 */
export {}
```

- [ ] **Step 3: Update ai barrel**

Replace `apps/web/src/lib/server/domains/ai/index.ts`:

```typescript
/**
 * AI module - Types Only
 *
 * Import directly:
 *   - './config' for getOpenAI
 *   - './retry' for withRetry
 *   - './parse' for stripCodeFences
 */
export type { RetryOptions } from './retry'
```

- [ ] **Step 4: Update sentiment barrel**

Replace `apps/web/src/lib/server/domains/sentiment/index.ts`:

```typescript
/**
 * Sentiment module - Types Only
 *
 * Import service functions directly from './sentiment.service' in server-only code.
 */
export type {
  Sentiment,
  SentimentResult,
  SentimentBreakdown,
  SentimentTrendPoint,
  PostForSentiment,
} from './sentiment.service'
```

- [ ] **Step 5: Update merge-suggestions barrel**

Replace `apps/web/src/lib/server/domains/merge-suggestions/index.ts`:

```typescript
/**
 * Merge Suggestions module - Types Only
 *
 * Import service functions directly:
 *   - './merge-search.service' for findMergeCandidates
 *   - './merge-assessment.service' for assessMergeCandidates
 *   - './merge-suggestion.service' for CRUD
 *   - './merge-check.service' for background checks
 */
export type { MergeCandidate } from './merge-search.service'
export type { MergeSuggestionView } from './merge-suggestion.service'
```

- [ ] **Step 6: Update server importers**

`apps/web/src/lib/server/events/handlers/ai.ts:10-11`:

```typescript
// Before:
import { analyzeSentiment, saveSentiment } from '@/lib/server/domains/sentiment'
import { generatePostEmbedding } from '@/lib/server/domains/embeddings'

// After:
import { analyzeSentiment, saveSentiment } from '@/lib/server/domains/sentiment/sentiment.service'
import { generatePostEmbedding } from '@/lib/server/domains/embeddings/embedding.service'
```

`apps/web/src/lib/server/events/handlers/summary.ts:10`:

```typescript
// Before:
import { generateAndSavePostSummary } from '@/lib/server/domains/summary'

// After:
import { generateAndSavePostSummary } from '@/lib/server/domains/summary/summary.service'
```

`apps/web/src/lib/server/functions/merge-suggestions.ts:13-17`:

```typescript
// Before:
import {
  getPendingSuggestionsForPost,
  getPendingMergeSuggestionSummary,
  getMergeSuggestionCountsForPosts,
} from '@/lib/server/domains/merge-suggestions'

// After:
import {
  getPendingSuggestionsForPost,
  getPendingMergeSuggestionSummary,
  getMergeSuggestionCountsForPosts,
} from '@/lib/server/domains/merge-suggestions/merge-suggestion.service'
```

- [ ] **Step 7: Scan for any remaining runtime imports from these barrels**

Run:

```bash
grep -rn "from '@/lib/server/domains/\(embeddings\|summary\|ai\|sentiment\|merge-suggestions\)'" apps/web/src/ | grep -v "import type"
```

Update any remaining runtime imports to point to the specific service file.

- [ ] **Step 8: Typecheck and commit**

```bash
cd apps/web && bunx tsc --noEmit --pretty 2>&1 | head -30
git add apps/web/src/lib/server/domains/embeddings/ apps/web/src/lib/server/domains/summary/ apps/web/src/lib/server/domains/ai/ apps/web/src/lib/server/domains/sentiment/ apps/web/src/lib/server/domains/merge-suggestions/ apps/web/src/lib/server/events/ apps/web/src/lib/server/functions/merge-suggestions.ts
git commit -m "Make remaining domain barrels types-only"
```

---

## Phase 3: Verification

### Task 12: Full build and test verification

- [ ] **Step 1: Typecheck**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: Clean — zero errors.

- [ ] **Step 2: Full build**

Run: `bun run build`
Expected: Build succeeds with no import protection violations.

- [ ] **Step 3: Run tests**

Run: `bun run test`
Expected: All tests pass.

- [ ] **Step 4: Browser verification**

Start dev server, open `http://localhost:3000`, verify:

- No `Buffer is not defined` errors in console
- No postgres references in client bundle (check Network tab → JS files)
- App loads and navigates normally

- [ ] **Step 5: Final commit (if any fixups needed)**

---

## Out of Scope (Not Required for Protection)

These are potential future improvements that don't affect the protection config:

1. **Move `lib/server/auth/client.ts` → `lib/client/auth.ts`** — This file is a client-only auth SDK that lives under `lib/server/`. Moving it would improve clarity but doesn't affect import protection since it has no server dependencies.

2. **Move integration catalogs → `lib/shared/integrations/`** — Catalog files are pure data objects with no server dependencies. They could live in `shared/` for clarity, but there are 24 of them and the move provides no protection benefit.

3. **Fix `import type` from `@/lib/server/db` in domain type files** — Eight `.types.ts` files do `import type { ... } from '@/lib/server/db'`. These are safe (esbuild strips them) but could be pointed at `@/lib/shared/db-types` for consistency. Task 10 fixes `segment.types.ts` as an example; the same pattern applies to: `help-center.types.ts`, `user-attribute.types.ts`, `status.types.ts`, `changelog.types.ts`, `roadmap.types.ts`, `board.types.ts`, `post.types.ts`.
