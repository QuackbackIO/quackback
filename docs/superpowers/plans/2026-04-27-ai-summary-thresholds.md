# Threshold-gated AI Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop generating AI post summaries on every post and every comment. Generate only when a post has ≥2 non-team comments, and refresh only when ≥3 new non-team comments AND ≥6h have elapsed since the last refresh. Hide the AI Summary card when no summary exists.

**Architecture:** A single pure helper `reasonToSkipSummary` decides eligibility. `generateAndSavePostSummary` calls the helper and early-returns when ineligible. `refreshStaleSummaries` mirrors the same predicate in SQL, using a non-team comment count subquery. The `AiSummaryCard` returns `null` when there is no `summaryJson`. No schema migration — `summaryCommentCount` shifts semantically from total live comments to non-team live comments and heals automatically on next refresh.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres), Vitest, React (TanStack Start). Test runner: `bun run test`.

**Reference spec:** `docs/superpowers/specs/2026-04-27-ai-summary-thresholds-design.md`

---

## File Structure

| File                                                                        | Action | Responsibility                                                                                                                                                        |
| --------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/server/domains/summary/summary.service.ts`                | Modify | Add threshold constants, add pure `reasonToSkipSummary` helper, wire gate into `generateAndSavePostSummary`, count non-team comments separately, update sweeper query |
| `apps/web/src/lib/server/domains/summary/__tests__/summary.service.test.ts` | Create | Unit tests for `reasonToSkipSummary` helper; integration-style test for the gate wiring in `generateAndSavePostSummary`                                               |
| `apps/web/src/components/admin/feedback/ai-summary-card.tsx`                | Modify | Return `null` when `summaryJson` is null (drop "Summary is being generated…" placeholder)                                                                             |

---

## Task 1: Pure `reasonToSkipSummary` helper

**Files:**

- Modify: `apps/web/src/lib/server/domains/summary/summary.service.ts`
- Create: `apps/web/src/lib/server/domains/summary/__tests__/summary.service.test.ts`

This is the gate logic, in isolation, so it can be exhaustively unit-tested. Following project TDD preference (red-green): tests first, then implementation.

- [ ] **Step 1: Create the test file with failing tests**

Create `apps/web/src/lib/server/domains/summary/__tests__/summary.service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { reasonToSkipSummary } from '../summary.service'

describe('reasonToSkipSummary', () => {
  describe('initial generation gate', () => {
    it('skips when 0 non-team comments and no existing summary', () => {
      expect(
        reasonToSkipSummary({
          hasExistingSummary: false,
          liveNonTeamCommentCount: 0,
          summaryCommentCount: null,
          summaryUpdatedAt: null,
        })
      ).toBe('below-initial-threshold')
    })

    it('skips when 1 non-team comment and no existing summary', () => {
      expect(
        reasonToSkipSummary({
          hasExistingSummary: false,
          liveNonTeamCommentCount: 1,
          summaryCommentCount: null,
          summaryUpdatedAt: null,
        })
      ).toBe('below-initial-threshold')
    })

    it('proceeds when 2 non-team comments and no existing summary', () => {
      expect(
        reasonToSkipSummary({
          hasExistingSummary: false,
          liveNonTeamCommentCount: 2,
          summaryCommentCount: null,
          summaryUpdatedAt: null,
        })
      ).toBeNull()
    })

    it('proceeds when many non-team comments and no existing summary', () => {
      expect(
        reasonToSkipSummary({
          hasExistingSummary: false,
          liveNonTeamCommentCount: 50,
          summaryCommentCount: null,
          summaryUpdatedAt: null,
        })
      ).toBeNull()
    })
  })

  describe('refresh gate', () => {
    const now = new Date('2026-04-27T12:00:00Z')

    it('skips when fewer than 3 new non-team comments', () => {
      expect(
        reasonToSkipSummary({
          hasExistingSummary: true,
          liveNonTeamCommentCount: 4,
          summaryCommentCount: 2,
          summaryUpdatedAt: new Date('2026-04-26T00:00:00Z'),
          now,
        })
      ).toBe('below-refresh-comment-threshold')
    })

    it('skips when 3 new comments but cooldown not elapsed', () => {
      expect(
        reasonToSkipSummary({
          hasExistingSummary: true,
          liveNonTeamCommentCount: 5,
          summaryCommentCount: 2,
          summaryUpdatedAt: new Date('2026-04-27T11:00:00Z'), // 1h ago
          now,
        })
      ).toBe('refresh-cooldown')
    })

    it('proceeds when 3 new comments and >=6h elapsed', () => {
      expect(
        reasonToSkipSummary({
          hasExistingSummary: true,
          liveNonTeamCommentCount: 5,
          summaryCommentCount: 2,
          summaryUpdatedAt: new Date('2026-04-27T05:00:00Z'), // 7h ago
          now,
        })
      ).toBeNull()
    })

    it('proceeds when many new comments and cooldown elapsed', () => {
      expect(
        reasonToSkipSummary({
          hasExistingSummary: true,
          liveNonTeamCommentCount: 20,
          summaryCommentCount: 2,
          summaryUpdatedAt: new Date('2026-04-27T05:00:00Z'),
          now,
        })
      ).toBeNull()
    })

    it('treats null summaryCommentCount as 0 new-comment baseline', () => {
      // Legacy row: summary exists but stored count is null. Live count of 3
      // means 3 new comments, and cooldown has elapsed.
      expect(
        reasonToSkipSummary({
          hasExistingSummary: true,
          liveNonTeamCommentCount: 3,
          summaryCommentCount: null,
          summaryUpdatedAt: new Date('2026-04-27T05:00:00Z'),
          now,
        })
      ).toBeNull()
    })

    it('treats null summaryUpdatedAt as cooldown-elapsed', () => {
      // Defensive: if a summary somehow exists with no updatedAt, allow refresh.
      expect(
        reasonToSkipSummary({
          hasExistingSummary: true,
          liveNonTeamCommentCount: 5,
          summaryCommentCount: 2,
          summaryUpdatedAt: null,
          now,
        })
      ).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test apps/web/src/lib/server/domains/summary/__tests__/summary.service.test.ts`
Expected: FAIL — `reasonToSkipSummary` is not exported from `../summary.service`.

- [ ] **Step 3: Add constants and helper to `summary.service.ts`**

In `apps/web/src/lib/server/domains/summary/summary.service.ts`, immediately after the `SUMMARY_MODEL` constant (around line 13), add:

```ts
const MIN_COMMENTS_FOR_INITIAL_SUMMARY = 2
const MIN_NEW_COMMENTS_FOR_REFRESH = 3
const MIN_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6h

interface SkipSummaryInput {
  hasExistingSummary: boolean
  liveNonTeamCommentCount: number
  summaryCommentCount: number | null
  summaryUpdatedAt: Date | null
  now?: Date
}

/**
 * Decides whether a summary generation/refresh should be skipped.
 * Returns a reason string when skipping, or null when generation should proceed.
 *
 * Pure function — exported for unit testing.
 */
export function reasonToSkipSummary(input: SkipSummaryInput): string | null {
  const {
    hasExistingSummary,
    liveNonTeamCommentCount,
    summaryCommentCount,
    summaryUpdatedAt,
    now = new Date(),
  } = input

  if (!hasExistingSummary) {
    if (liveNonTeamCommentCount < MIN_COMMENTS_FOR_INITIAL_SUMMARY) {
      return 'below-initial-threshold'
    }
    return null
  }

  const newComments = liveNonTeamCommentCount - (summaryCommentCount ?? 0)
  if (newComments < MIN_NEW_COMMENTS_FOR_REFRESH) {
    return 'below-refresh-comment-threshold'
  }

  if (summaryUpdatedAt) {
    const elapsed = now.getTime() - summaryUpdatedAt.getTime()
    if (elapsed < MIN_REFRESH_INTERVAL_MS) {
      return 'refresh-cooldown'
    }
  }

  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test apps/web/src/lib/server/domains/summary/__tests__/summary.service.test.ts`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/domains/summary/summary.service.ts \
        apps/web/src/lib/server/domains/summary/__tests__/summary.service.test.ts
git commit -m "feat(summary): add reasonToSkipSummary gate helper with thresholds"
```

---

## Task 2: Wire gate into `generateAndSavePostSummary` + count non-team comments

**Files:**

- Modify: `apps/web/src/lib/server/domains/summary/summary.service.ts`

The orchestration function now:

1. Fetches the post including `summaryUpdatedAt`
2. Computes the live non-team comment count from the comments query
3. Calls `reasonToSkipSummary` and early-returns if the gate says skip
4. Stores the non-team count in `summaryCommentCount` on write

- [ ] **Step 1: Update the post fetch to include `summaryUpdatedAt`**

In `summary.service.ts`, change the `db.query.posts.findFirst` call inside `generateAndSavePostSummary` (around line 60) from:

```ts
const post = await db.query.posts.findFirst({
  where: eq(posts.id, postId),
  columns: { title: true, content: true, summaryJson: true },
})
```

to:

```ts
const post = await db.query.posts.findFirst({
  where: eq(posts.id, postId),
  columns: {
    title: true,
    content: true,
    summaryJson: true,
    summaryCommentCount: true,
    summaryUpdatedAt: true,
  },
})
```

- [ ] **Step 2: Compute non-team count and apply the gate**

Immediately after the `postComments` query (around line 78, before the `let input = ...` line), insert:

```ts
const nonTeamCount = postComments.filter((c) => !c.isTeamMember).length

const skipReason = reasonToSkipSummary({
  hasExistingSummary: post.summaryJson !== null,
  liveNonTeamCommentCount: nonTeamCount,
  summaryCommentCount: post.summaryCommentCount,
  summaryUpdatedAt: post.summaryUpdatedAt,
})

if (skipReason) {
  console.log(`[Summary] Skipping post ${postId}: ${skipReason}`)
  return
}
```

- [ ] **Step 3: Use non-team count when persisting**

In the same function, change the final `db.update(posts).set(...)` block (around line 150) from:

```ts
.set({
  summaryJson,
  summaryModel: SUMMARY_MODEL,
  summaryUpdatedAt: new Date(),
  summaryCommentCount: postComments.length,
})
```

to:

```ts
.set({
  summaryJson,
  summaryModel: SUMMARY_MODEL,
  summaryUpdatedAt: new Date(),
  summaryCommentCount: nonTeamCount,
})
```

Also update the trailing log line from:

```ts
console.log(`[Summary] Generated for post ${postId} (${postComments.length} comments)`)
```

to:

```ts
console.log(`[Summary] Generated for post ${postId} (${nonTeamCount} non-team comments)`)
```

- [ ] **Step 4: Add an integration-style test for the gate wiring**

Append the following to `apps/web/src/lib/server/domains/summary/__tests__/summary.service.test.ts`. This test verifies that when the gate says skip, no LLM call is issued.

At the very top of the test file, add the imports needed for mocking — replace the current single import line with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
```

Then below the existing `describe('reasonToSkipSummary', ...)` block, append:

```ts
const mockChatCompletionsCreate = vi.fn()
const mockUpdate = vi.fn()
const mockUpdateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })

vi.mock('@/lib/server/domains/ai/config', () => ({
  getOpenAI: () => ({
    chat: { completions: { create: mockChatCompletionsCreate } },
  }),
  stripCodeFences: (s: string) => s,
}))

vi.mock('@/lib/server/domains/ai/retry', () => ({
  withRetry: async (fn: () => Promise<unknown>) => ({ result: await fn() }),
}))

vi.mock('@/lib/server/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/db')>('@/lib/server/db')
  return {
    ...actual,
    db: {
      query: {
        posts: {
          findFirst: vi.fn(),
        },
      },
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      update: mockUpdate,
    },
  }
})

describe('generateAndSavePostSummary gate wiring', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockUpdate.mockReturnValue({ set: mockUpdateSet })
  })

  it('skips LLM call when post has 0 non-team comments and no existing summary', async () => {
    const { generateAndSavePostSummary } = await import('../summary.service')
    const { db } = await import('@/lib/server/db')

    vi.mocked(db.query.posts.findFirst).mockResolvedValue({
      title: 'Hi',
      content: 'short',
      summaryJson: null,
      summaryCommentCount: null,
      summaryUpdatedAt: null,
    } as never)

    await generateAndSavePostSummary('post_123' as never)

    expect(mockChatCompletionsCreate).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 5: Run all tests**

Run: `bun run test apps/web/src/lib/server/domains/summary/__tests__/summary.service.test.ts`
Expected: PASS — all 10 tests green (9 helper tests + 1 wiring test).

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/server/domains/summary/summary.service.ts \
        apps/web/src/lib/server/domains/summary/__tests__/summary.service.test.ts
git commit -m "feat(summary): gate generation on non-team comment thresholds"
```

---

## Task 3: Update `refreshStaleSummaries` sweeper query

**Files:**

- Modify: `apps/web/src/lib/server/domains/summary/summary.service.ts`

The sweeper now mirrors the gate predicate in SQL: surface posts that are eligible either for initial generation (no summary, ≥2 non-team comments) or for refresh (summary exists, ≥3 new non-team comments, summary >6h old).

- [ ] **Step 1: Add new imports to the top of `summary.service.ts`**

Change the existing import block:

```ts
import { db, posts, comments, eq, and, or, isNull, ne, desc, sql } from '@/lib/server/db'
```

to:

```ts
import {
  db,
  posts,
  comments,
  eq,
  and,
  or,
  isNull,
  isNotNull,
  desc,
  sql,
  gte,
  lt,
} from '@/lib/server/db'
```

(`ne` is removed — the new query no longer uses it.)

- [ ] **Step 2: Replace the sweeper query body**

Replace the body of `refreshStaleSummaries` from the `const liveCommentCountSq = ...` declaration through the end of the `while (true)` block's `stalePosts` assignment (currently lines ~174-204).

Replace:

```ts
const liveCommentCountSq = db
  .select({
    postId: comments.postId,
    count: sql<number>`count(*)::int`.as('live_count'),
  })
  .from(comments)
  .where(isNull(comments.deletedAt))
  .groupBy(comments.postId)
  .as('live_cc')

let totalProcessed = 0
let totalFailed = 0

// Process in batches until no stale posts remain
while (true) {
  const stalePosts = await db
    .select({ id: posts.id })
    .from(posts)
    .leftJoin(liveCommentCountSq, eq(posts.id, liveCommentCountSq.postId))
    .where(
      and(
        isNull(posts.deletedAt),
        or(
          isNull(posts.summaryJson),
          ne(posts.summaryCommentCount, sql`coalesce(${liveCommentCountSq.count}, 0)`)
        )
      )
    )
    .orderBy(desc(posts.updatedAt))
    .limit(SWEEP_BATCH_SIZE)
```

with:

```ts
const liveNonTeamCountSq = db
  .select({
    postId: comments.postId,
    count: sql<number>`count(*)::int`.as('live_non_team_count'),
  })
  .from(comments)
  .where(and(isNull(comments.deletedAt), eq(comments.isTeamMember, false)))
  .groupBy(comments.postId)
  .as('live_nt')

let totalProcessed = 0
let totalFailed = 0

// Process in batches until no stale posts remain
while (true) {
  const liveNonTeamCount = sql<number>`coalesce(${liveNonTeamCountSq.count}, 0)`

  const stalePosts = await db
    .select({ id: posts.id })
    .from(posts)
    .leftJoin(liveNonTeamCountSq, eq(posts.id, liveNonTeamCountSq.postId))
    .where(
      and(
        isNull(posts.deletedAt),
        or(
          // Initial generation candidates
          and(
            isNull(posts.summaryJson),
            gte(liveNonTeamCount, MIN_COMMENTS_FOR_INITIAL_SUMMARY)
          ),
          // Refresh candidates: enough new comments + cooldown elapsed
          and(
            isNotNull(posts.summaryJson),
            gte(
              sql<number>`${liveNonTeamCount} - coalesce(${posts.summaryCommentCount}, 0)`,
              MIN_NEW_COMMENTS_FOR_REFRESH
            ),
            lt(posts.summaryUpdatedAt, sql`now() - interval '6 hours'`)
          )
        )
      )
    )
    .orderBy(desc(posts.updatedAt))
    .limit(SWEEP_BATCH_SIZE)
```

The rest of the function (the `if (stalePosts.length === 0) break`, the per-post try/catch loop, the batch sleep, and the trailing log) stays unchanged.

- [ ] **Step 3: Run typecheck and tests**

Run: `bun run typecheck`
Expected: PASS.

Run: `bun run test apps/web/src/lib/server/domains/summary/__tests__/summary.service.test.ts`
Expected: PASS — existing tests still green.

- [ ] **Step 4: Smoke-test the sweeper against a dev DB (manual)**

Start the dev environment if not already running:

```bash
bun run dev
```

In a separate terminal, run a one-off invocation of the sweeper. Use the existing backfill harness pattern by running:

```bash
bun --cwd apps/web run scripts/backfill-ai.ts
```

Look in the dev console for `[Summary]` log lines. Confirm:

- Posts with 0–1 non-team comments are not surfaced
- Posts with ≥2 non-team comments and no summary ARE surfaced and generate
- Posts with summary already + only 1–2 new comments are NOT regenerated
- The sweep terminates (`Sweep complete:` log fires)

If the backfill script does something different from `refreshStaleSummaries`, run the function directly via a one-off script — but typically the sweeper is invoked from `apps/web/src/lib/server/startup.ts` or a job. A targeted way: bump a post to 2 non-team comments via `psql` and tail the dev logs after restart.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/domains/summary/summary.service.ts
git commit -m "feat(summary): rewrite sweeper to use threshold-gated eligibility"
```

---

## Task 4: Hide AI Summary card when no summary exists

**Files:**

- Modify: `apps/web/src/components/admin/feedback/ai-summary-card.tsx`

The "Summary is being generated…" placeholder is removed. The card returns `null` when `summaryJson` is null, so thin posts (below threshold) don't show an empty card. Brief in-flight windows after a post crosses threshold (~1–3s) appear as no card, then the card renders once the LLM call completes.

- [ ] **Step 1: Replace the placeholder branch**

In `apps/web/src/components/admin/feedback/ai-summary-card.tsx`, replace lines 23–36 (the `if (!summaryJson)` block):

```tsx
// Generating state: no summary yet
if (!summaryJson) {
  return (
    <div className="border border-border/30 rounded-lg bg-muted/5">
      <div className="flex items-center gap-2 px-4 py-3">
        <SparklesIcon className="size-3.5 text-amber-500/80 shrink-0" />
        <p className="text-xs font-medium text-muted-foreground/70">AI Summary</p>
      </div>
      <div className="px-4 pb-3">
        <p className="text-sm text-muted-foreground italic">Summary is being generated...</p>
      </div>
    </div>
  )
}
```

with:

```tsx
if (!summaryJson) {
  return null
}
```

- [ ] **Step 2: Visual smoke-test in the browser**

Run: `bun run dev`

In the browser, open `http://localhost:3000` and log in as `demo@example.com` / `password`.

Navigate to the admin feedback queue and open three posts:

- A thin post with 0–1 comments → AI Summary card should NOT render
- A post with ≥2 non-team comments and an existing summary → card renders normally
- A post that just crossed threshold (use the dev console / DB if needed) → card may briefly not render then appear after LLM call returns

If you can't easily produce all three cases from seed data, at minimum verify the first case (no card on a post with no summary) and the second case (existing card unchanged).

- [ ] **Step 3: Run lint + typecheck**

Run: `bun run lint && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/admin/feedback/ai-summary-card.tsx
git commit -m "feat(summary): hide AI Summary card when no summary exists"
```

---

## Final Verification

- [ ] **Step 1: Run full test suite**

Run: `bun run test`
Expected: PASS — all summary tests green, no regressions in other suites.

- [ ] **Step 2: Run typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 3: Confirm no schema migration was created**

Run: `git status` — expect no new files under `packages/db/migrations/` or `apps/web/db/migrations/`. The plan specifically avoids a migration; if one appears, something went off-script.

- [ ] **Step 4: Review commit log**

Run: `git log --oneline main..HEAD`
Expected: 4 commits matching the messages above.
