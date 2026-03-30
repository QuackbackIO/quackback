# Analytics Dashboard & Auth Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate anonymous user detection to `principal.type`, defer anonymous session creation to first interaction, and build an admin analytics dashboard with hourly-refreshed materialized stats.

**Architecture:** Three sequential workstreams. (1) Auth cleanup replaces all `user.isAnonymous` reads with `principal.type` from a session-joined principal lookup. (2) Lazy sessions remove the eager `signIn.anonymous()` call, adding an `ensureSessionThen` wrapper for write actions. (3) Analytics adds two new DB tables, a BullMQ hourly job, a server function, and a full admin page with shadcn charts.

**Tech Stack:** Drizzle ORM, BullMQ, recharts via shadcn/ui chart component, TanStack Router/Query, shadcn/ui cards/tables.

**Spec:** `docs/superpowers/specs/2026-03-27-analytics-and-auth-cleanup-design.md`

---

## File Map

### Workstream 1: Auth Cleanup

| Action | File                                                                                                 |
| ------ | ---------------------------------------------------------------------------------------------------- |
| Modify | `apps/web/src/lib/server/functions/auth.ts` -- add `principalType` to SessionUser, resolve principal |
| Modify | `apps/web/src/lib/server/functions/bootstrap.ts` -- use principal type in getSessionInternal         |
| Modify | `apps/web/src/routes/widget.tsx` -- check principalType instead of isAnonymous                       |
| Modify | `apps/web/src/components/public/portal-header.tsx` -- check principalType                            |
| Modify | `apps/web/src/components/public/comment-form.tsx` -- check principalType                             |
| Modify | `apps/web/src/components/public/feedback/feedback-header.tsx` -- check principalType                 |
| Modify | `apps/web/src/components/public/auth-comments-section.tsx` -- check principalType                    |
| Modify | `apps/web/src/lib/server/domains/posts/post.voting.ts` -- check principalType                        |

### Workstream 2: Lazy Sessions

| Action | File                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------- |
| Modify | `apps/web/src/components/widget/widget-auth-provider.tsx` -- remove eager anon session, add ensureSessionThen |
| Modify | `apps/web/src/components/widget/widget-home.tsx` -- pass ensureSessionThen to vote buttons                    |
| Modify | `apps/web/src/components/widget/widget-post-detail.tsx` -- pass ensureSessionThen to vote/comment             |
| Modify | `apps/web/src/components/widget/widget-comment-form.tsx` -- use ensureSessionThen before submit               |

### Workstream 3: Analytics

| Action | File                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------- |
| Create | `packages/db/src/schema/analytics.ts` -- analytics_daily_stats + analytics_top_posts tables    |
| Modify | `packages/db/src/schema/index.ts` -- export analytics schema                                   |
| Modify | `apps/web/src/lib/server/db.ts` -- re-export analytics tables                                  |
| Modify | `packages/db/src/schema/changelog.ts` -- add viewCount column                                  |
| Create | `apps/web/src/lib/server/domains/analytics/analytics.service.ts` -- refresh logic              |
| Create | `apps/web/src/lib/server/domains/analytics/analytics-queue.ts` -- BullMQ queue + worker        |
| Modify | `apps/web/src/lib/server/startup.ts` -- register analytics worker                              |
| Create | `apps/web/src/lib/server/functions/analytics.ts` -- getAnalyticsData server function           |
| Create | `apps/web/src/lib/client/queries/analytics.ts` -- TanStack Query keys + options                |
| Create | `apps/web/src/routes/admin/analytics.tsx` -- admin route                                       |
| Create | `apps/web/src/components/admin/analytics/analytics-page.tsx` -- main page component            |
| Create | `apps/web/src/components/admin/analytics/analytics-summary-cards.tsx` -- summary cards         |
| Create | `apps/web/src/components/admin/analytics/analytics-activity-chart.tsx` -- area chart           |
| Create | `apps/web/src/components/admin/analytics/analytics-status-chart.tsx` -- status bar chart       |
| Create | `apps/web/src/components/admin/analytics/analytics-board-chart.tsx` -- board bar chart         |
| Create | `apps/web/src/components/admin/analytics/analytics-source-chart.tsx` -- source pie chart       |
| Create | `apps/web/src/components/admin/analytics/analytics-top-posts.tsx` -- top posts table           |
| Create | `apps/web/src/components/admin/analytics/analytics-top-contributors.tsx` -- contributors table |
| Modify | `apps/web/src/components/admin/admin-sidebar.tsx` -- add Analytics nav item                    |

---

## Task 1: Add `principalType` to Session Interface and Resolution

**Files:**

- Modify: `apps/web/src/lib/server/functions/auth.ts`

- [ ] **Step 1: Update SessionUser interface to include principalType**

```ts
// In apps/web/src/lib/server/functions/auth.ts
// Replace the SessionUser interface (lines 15-24)

export type PrincipalType = 'user' | 'anonymous' | 'service'

export interface SessionUser {
  id: UserId
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  principalType: PrincipalType
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 2: Update getSession to resolve principal and return principalType**

Replace the `getSession` handler body. Add the `db`, `principal`, and `eq` imports at the top of the file:

```ts
import { db, principal as principalTable, eq } from '@/lib/server/db'
```

Then replace lines 42-80 (the getSession handler):

```ts
export const getSession = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Session | null> => {
    console.log(`[fn:auth] getSession`)
    try {
      const session = await auth.api.getSession({
        headers: getRequestHeaders(),
      })

      if (!session?.user) {
        return null
      }

      const userId = session.user.id as UserId

      // Resolve principal to get the canonical type
      const principalRecord = await db.query.principal.findFirst({
        where: eq(principalTable.userId, userId),
        columns: { type: true },
      })

      return {
        session: {
          id: session.session.id as SessionId,
          expiresAt: session.session.expiresAt.toISOString(),
          token: session.session.token,
          createdAt: session.session.createdAt.toISOString(),
          updatedAt: session.session.updatedAt.toISOString(),
          userId,
        },
        user: {
          id: userId,
          name: session.user.name,
          email: session.user.email,
          emailVerified: session.user.emailVerified,
          image: session.user.image ?? null,
          principalType: (principalRecord?.type as PrincipalType) ?? 'user',
          createdAt: session.user.createdAt.toISOString(),
          updatedAt: session.user.updatedAt.toISOString(),
        },
      }
    } catch (error) {
      console.error(`[fn:auth] getSession failed:`, error)
      throw error
    }
  }
)
```

- [ ] **Step 3: Verify the app compiles**

Run: `cd apps/web && bunx tsc --noEmit 2>&1 | head -40`

Expected: Type errors in files that still reference `isAnonymous` on SessionUser. These will be fixed in the next tasks.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/server/functions/auth.ts
git commit -m "Replace isAnonymous with principalType in session interface"
```

---

## Task 2: Update Bootstrap Session to Use principalType

**Files:**

- Modify: `apps/web/src/lib/server/functions/bootstrap.ts`

- [ ] **Step 1: Update getSessionInternal to resolve principal**

In `bootstrap.ts`, the `getSessionInternal` function (lines 20-56) has the same pattern as `getSession`. Update it to resolve the principal type:

```ts
async function getSessionInternal(): Promise<Session | null> {
  try {
    const session = await auth.api.getSession({
      headers: getRequestHeaders(),
    })

    if (!session?.user) {
      return null
    }

    const userId = session.user.id as UserId

    const principalRecord = await db.query.principal.findFirst({
      where: eq(principal.userId, userId),
      columns: { type: true },
    })

    return {
      session: {
        id: session.session.id as SessionId,
        expiresAt: session.session.expiresAt.toISOString(),
        token: session.session.token,
        createdAt: session.session.createdAt.toISOString(),
        updatedAt: session.session.updatedAt.toISOString(),
        userId,
      },
      user: {
        id: userId,
        name: session.user.name,
        email: session.user.email,
        emailVerified: session.user.emailVerified,
        image: session.user.image ?? null,
        principalType: (principalRecord?.type as PrincipalType) ?? 'user',
        createdAt: session.user.createdAt.toISOString(),
        updatedAt: session.user.updatedAt.toISOString(),
      },
    }
  } catch (error) {
    console.error('[bootstrap] getSession error:', error)
    return null
  }
}
```

Add the import for `PrincipalType` at the top:

```ts
import type { Session, PrincipalType } from './auth'
```

Remove the now-unused import of `isAnonymous`-related casts if any remain. The existing imports of `db, principal, eq` are already present in bootstrap.ts.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/server/functions/bootstrap.ts
git commit -m "Update bootstrap session to resolve principalType from principal table"
```

---

## Task 3: Migrate All Client-Side isAnonymous Checks to principalType

**Files:**

- Modify: `apps/web/src/routes/widget.tsx`
- Modify: `apps/web/src/components/public/portal-header.tsx`
- Modify: `apps/web/src/components/public/comment-form.tsx`
- Modify: `apps/web/src/components/public/feedback/feedback-header.tsx`
- Modify: `apps/web/src/components/public/auth-comments-section.tsx`

- [ ] **Step 1: Update widget.tsx**

At line 42, change:

```ts
// Before
session?.user && !session.user.isAnonymous
// After
session?.user && session.user.principalType !== 'anonymous'
```

- [ ] **Step 2: Update portal-header.tsx**

At line 85, change:

```ts
// Before
const isLoggedIn = !!user && !user.isAnonymous
// After
const isLoggedIn = !!user && user.principalType !== 'anonymous'
```

- [ ] **Step 3: Update feedback-header.tsx**

At lines 57-62, change:

```ts
// Before
const isAnonymousSession = session?.user?.isAnonymous ?? false
const effectiveUser =
  session?.user && !isAnonymousSession
    ? { name: session.user.name, email: session.user.email }
    : user
const canPostAnonymously = anonymousPostingEnabled && (!session?.user || isAnonymousSession)

// After
const isAnonymousSession = session?.user?.principalType === 'anonymous'
const effectiveUser =
  session?.user && !isAnonymousSession
    ? { name: session.user.name, email: session.user.email }
    : user
const canPostAnonymously = anonymousPostingEnabled && (!session?.user || isAnonymousSession)
```

- [ ] **Step 4: Update auth-comments-section.tsx**

At lines 99-100, change:

```ts
// Before
const isAnonymous = session?.user?.isAnonymous ?? false
const user = session?.user && (!isAnonymous || anonymousCommentingEnabled) ? session.user : null

// After
const isAnonymous = session?.user?.principalType === 'anonymous'
const user = session?.user && (!isAnonymous || anonymousCommentingEnabled) ? session.user : null
```

- [ ] **Step 5: Update comment-form.tsx**

At line 147, change:

```ts
// Before
const isAnonymousCommenter = !effectiveUser || (session?.user?.isAnonymous ?? false)

// After
const isAnonymousCommenter = !effectiveUser || session?.user?.principalType === 'anonymous'
```

- [ ] **Step 6: Verify the app compiles clean**

Run: `cd apps/web && bunx tsc --noEmit 2>&1 | head -20`

Expected: No errors (or only unrelated pre-existing errors). All `isAnonymous` references on `SessionUser` should be gone.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/routes/widget.tsx \
  apps/web/src/components/public/portal-header.tsx \
  apps/web/src/components/public/comment-form.tsx \
  apps/web/src/components/public/feedback/feedback-header.tsx \
  apps/web/src/components/public/auth-comments-section.tsx
git commit -m "Migrate all client isAnonymous checks to principalType"
```

---

## Task 4: Update Server-Side Voting isAnonymous to Use principalType

**Files:**

- Modify: `apps/web/src/lib/server/domains/posts/post.voting.ts`

- [ ] **Step 1: Update VoterInfo interface and voting logic**

In `post.voting.ts`, the `VoterInfo` interface at line 34 has `isAnonymous: boolean`. Replace it with `principalType`:

```ts
// Before (line 34)
isAnonymous: boolean

// After
principalType: string
```

Then update all references within the file:

At line 319 (where VoterInfo is populated):

```ts
// Before
isAnonymous: user.isAnonymous,

// After
principalType: user.principalType ?? 'user',
```

At line 345 (where display name is conditionally nulled):

```ts
// Before
displayName: row.isAnonymous ? null : row.displayName,

// After
displayName: row.principalType === 'anonymous' ? null : row.displayName,
```

At lines 347-348:

```ts
// Before
avatarUrl: row.isAnonymous ? null : row.avatarUrl,
isAnonymous: row.isAnonymous ?? false,

// After
avatarUrl: row.principalType === 'anonymous' ? null : row.avatarUrl,
isAnonymous: row.principalType === 'anonymous',
```

At line 353:

```ts
// Before
subscriptionLevel: row.isAnonymous

// After
subscriptionLevel: row.principalType === 'anonymous'
```

Note: The output-facing `isAnonymous` field in the API response can stay as a derived boolean for now if downstream consumers expect it. The key change is that the _source_ is `principalType`, not `user.isAnonymous`.

- [ ] **Step 2: Verify compilation**

Run: `cd apps/web && bunx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/server/domains/posts/post.voting.ts
git commit -m "Update voting service to derive isAnonymous from principalType"
```

---

## Task 5: Lazy Anonymous Session Creation in Widget

**Files:**

- Modify: `apps/web/src/components/widget/widget-auth-provider.tsx`

- [ ] **Step 1: Add ensureSessionThen to the context interface**

In the `WidgetAuthContextValue` interface (line 26), add:

```ts
/** Ensures a session exists before performing a write action. Creates anonymous session if needed. */
ensureSessionThen: (callback: () => void | Promise<void>) => Promise<void>
```

- [ ] **Step 2: Implement ensureSessionThen in the provider**

Add this inside `WidgetAuthProvider`, after the existing `ensureSession` callback (after line 117):

```ts
const ensureSessionThen = useCallback(
  async (callback: () => void | Promise<void>) => {
    if (sessionReadyRef.current) {
      await callback()
      return
    }
    const success = await ensureSession()
    if (success) {
      await callback()
    }
  },
  [ensureSession]
)
```

- [ ] **Step 3: Remove the eager anonymous session from handleAnonymousIdentify**

In `handleAnonymousIdentify` (lines 243-274), the function currently calls `authClient.signIn.anonymous()` immediately. Change it to simply acknowledge the anonymous state without creating a session:

```ts
async function handleAnonymousIdentify() {
  // Don't eagerly create anonymous session — it will be created lazily
  // on first write action (vote, comment, post) via ensureSessionThen.
  setUser(null)
  window.parent.postMessage({ type: 'featurepool:identify-result', success: true, user: null }, '*')
  window.parent.postMessage({ type: 'featurepool:auth-change', user: null }, '*')
}
```

- [ ] **Step 4: Include ensureSessionThen in the context value**

In the `useMemo` that creates the context value, add `ensureSessionThen`:

```ts
const contextValue = useMemo<WidgetAuthContextValue>(
  () => ({
    user,
    isIdentified,
    hmacRequired: hmacRequired ?? false,
    ensureSession,
    ensureSessionThen,
    identifyWithEmail,
    closeWidget,
    emitEvent,
    metadata: widgetMetadata,
    sessionVersion,
  }),
  [
    user,
    isIdentified,
    hmacRequired,
    ensureSession,
    ensureSessionThen,
    identifyWithEmail,
    closeWidget,
    emitEvent,
    widgetMetadata,
    sessionVersion,
  ]
)
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/widget/widget-auth-provider.tsx
git commit -m "Add ensureSessionThen and defer anonymous session to first interaction"
```

---

## Task 6: Wire ensureSessionThen Into Widget Actions

**Files:**

- Modify: `apps/web/src/components/widget/widget-home.tsx`
- Modify: `apps/web/src/components/widget/widget-post-detail.tsx`
- Modify: `apps/web/src/components/widget/widget-comment-form.tsx`

- [ ] **Step 1: Update widget-home.tsx to use ensureSessionThen for voting**

In `widget-home.tsx`, the `WidgetVoteButton` is rendered with an `onBeforeVote` prop. Find where vote buttons are rendered and add `onBeforeVote` that calls `ensureSessionThen`:

```tsx
// In the component that renders WidgetVoteButton, destructure ensureSessionThen:
const { ensureSessionThen } = useWidgetAuth()

// Pass onBeforeVote to each WidgetVoteButton:
<WidgetVoteButton
  postId={post.id as PostId}
  voteCount={post.voteCount}
  onBeforeVote={async () => {
    let success = false
    await ensureSessionThen(() => { success = true })
    return success
  }}
/>
```

The `WidgetVoteButton` already supports `onBeforeVote?: () => Promise<boolean>` (line 13 of widget-vote-button.tsx). It calls this before proceeding with the vote mutation. If it returns `false`, the vote is cancelled.

- [ ] **Step 2: Update widget-post-detail.tsx similarly**

The post detail view also renders vote buttons and comment forms. Apply the same `onBeforeVote` pattern for vote buttons. For comment forms, the `widget-comment-form.tsx` needs an `onBeforeSubmit` wrapper.

- [ ] **Step 3: Update widget-comment-form.tsx to ensure session before submitting**

In the comment form's submit handler, wrap the mutation call:

```tsx
const { ensureSessionThen } = useWidgetAuth()

// In the submit handler:
const handleSubmit = async (data: FormData) => {
  await ensureSessionThen(async () => {
    await submitComment(data)
  })
}
```

- [ ] **Step 4: Manually test the widget**

Run: `bun run dev`

Test in browser:

1. Open widget without being logged in
2. Verify no anonymous session is created (check network tab -- no `/api/auth/sign-in/anonymous` call on mount)
3. Click a vote button
4. Verify anonymous session is created just-in-time, then vote succeeds
5. Post a comment -- verify same lazy pattern
6. Test SDK identify flow still works normally

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/widget/widget-home.tsx \
  apps/web/src/components/widget/widget-post-detail.tsx \
  apps/web/src/components/widget/widget-comment-form.tsx
git commit -m "Wire ensureSessionThen into widget vote and comment actions"
```

---

## Task 7: Analytics Schema -- Daily Stats and Top Posts Tables

**Files:**

- Create: `packages/db/src/schema/analytics.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `apps/web/src/lib/server/db.ts`

- [ ] **Step 1: Create the analytics schema file**

Create `packages/db/src/schema/analytics.ts`:

```ts
import { pgTable, date, integer, jsonb, timestamp, text, primaryKey } from 'drizzle-orm/pg-core'
import { typeIdColumn } from '@featurepool/ids/drizzle'

/**
 * Pre-aggregated daily analytics stats.
 * One row per day, refreshed hourly by the analytics BullMQ job.
 * Historical rows are immutable; only today's row is recomputed.
 */
export const analyticsDailyStats = pgTable('analytics_daily_stats', {
  date: date('date', { mode: 'string' }).primaryKey(),
  newPosts: integer('new_posts').default(0).notNull(),
  newVotes: integer('new_votes').default(0).notNull(),
  newComments: integer('new_comments').default(0).notNull(),
  newUsers: integer('new_users').default(0).notNull(),
  /** Current snapshot of all active posts by status: { "status_slug": count } */
  postsByStatus: jsonb('posts_by_status').$type<Record<string, number>>().default({}).notNull(),
  /** New posts created on this date by board: { "board_id": count } */
  postsByBoard: jsonb('posts_by_board').$type<Record<string, number>>().default({}).notNull(),
  /** New posts created on this date by source: { "portal": n, "widget": n, "api": n } */
  postsBySource: jsonb('posts_by_source').$type<Record<string, number>>().default({}).notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Top posts snapshot per preset period.
 * Refreshed hourly. Stores top 10 posts by vote count for each period.
 */
export const analyticsTopPosts = pgTable(
  'analytics_top_posts',
  {
    period: text('period').notNull(), // '7d', '30d', '90d', '12m'
    rank: integer('rank').notNull(), // 1-10
    postId: typeIdColumn('post')('post_id').notNull(),
    title: text('title').notNull(),
    voteCount: integer('vote_count').default(0).notNull(),
    commentCount: integer('comment_count').default(0).notNull(),
    boardName: text('board_name'),
    statusName: text('status_name'),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.period, table.rank] })]
)
```

- [ ] **Step 2: Export from schema index**

Add to `packages/db/src/schema/index.ts`:

```ts
export * from './analytics'
```

- [ ] **Step 3: Re-export from db.ts**

Add to the re-export block in `apps/web/src/lib/server/db.ts` (around line 226, after the pipeline-log exports):

```ts
  // Schema tables - analytics
  analyticsDailyStats,
  analyticsTopPosts,
```

- [ ] **Step 4: Add viewCount to changelog entries**

In `packages/db/src/schema/changelog.ts`, add inside the `changelogEntries` table definition (after line 24, before the closing `}`):

```ts
    // View count for analytics (incremented on public/widget page load)
    viewCount: integer('view_count').default(0).notNull(),
```

- [ ] **Step 5: Generate and run migration**

Run:

```bash
bun run db:generate
bun run db:migrate
```

Expected: Migration file created for `analytics_daily_stats`, `analytics_top_posts` tables and `view_count` column on `changelog_entries`.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/analytics.ts \
  packages/db/src/schema/index.ts \
  packages/db/src/schema/changelog.ts \
  apps/web/src/lib/server/db.ts \
  packages/db/drizzle/
git commit -m "Add analytics schema tables and changelog viewCount column"
```

---

## Task 8: Analytics Refresh Service

**Files:**

- Create: `apps/web/src/lib/server/domains/analytics/analytics.service.ts`

- [ ] **Step 1: Create the analytics service**

Create `apps/web/src/lib/server/domains/analytics/analytics.service.ts`:

```ts
import {
  db,
  sql,
  eq,
  gte,
  lte,
  and,
  isNull,
  count,
  posts,
  votes,
  comments,
  user,
  principal,
  postStatuses,
  boards,
  analyticsDailyStats,
  analyticsTopPosts,
  ne,
  desc,
} from '@/lib/server/db'

/**
 * Refresh today's row in analytics_daily_stats and the top posts snapshots.
 * Called hourly by the analytics BullMQ job.
 */
export async function refreshAnalytics(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10) // 'YYYY-MM-DD'
  const dayStart = `${today}T00:00:00.000Z`
  const dayEnd = `${today}T23:59:59.999Z`

  console.log(`[analytics] Refreshing stats for ${today}`)

  // Count new posts today (non-deleted)
  const [newPostsResult] = await db
    .select({ value: count() })
    .from(posts)
    .where(
      and(
        gte(posts.createdAt, new Date(dayStart)),
        lte(posts.createdAt, new Date(dayEnd)),
        isNull(posts.deletedAt)
      )
    )

  // Count new votes today
  const [newVotesResult] = await db
    .select({ value: count() })
    .from(votes)
    .where(and(gte(votes.createdAt, new Date(dayStart)), lte(votes.createdAt, new Date(dayEnd))))

  // Count new comments today (non-deleted)
  const [newCommentsResult] = await db
    .select({ value: count() })
    .from(comments)
    .where(
      and(
        gte(comments.createdAt, new Date(dayStart)),
        lte(comments.createdAt, new Date(dayEnd)),
        isNull(comments.deletedAt)
      )
    )

  // Count new non-anonymous users today
  const [newUsersResult] = await db
    .select({ value: count() })
    .from(principal)
    .where(
      and(
        gte(principal.createdAt, new Date(dayStart)),
        lte(principal.createdAt, new Date(dayEnd)),
        ne(principal.type, 'anonymous'),
        eq(principal.role, 'user')
      )
    )

  // Current status distribution (snapshot of all active posts)
  const statusRows = await db
    .select({
      slug: postStatuses.slug,
      value: count(),
    })
    .from(posts)
    .innerJoin(postStatuses, eq(posts.statusId, postStatuses.id))
    .where(isNull(posts.deletedAt))
    .groupBy(postStatuses.slug)

  const postsByStatus: Record<string, number> = {}
  for (const row of statusRows) {
    postsByStatus[row.slug] = row.value
  }

  // Posts by board (new today)
  const boardRows = await db
    .select({
      boardId: posts.boardId,
      value: count(),
    })
    .from(posts)
    .where(
      and(
        gte(posts.createdAt, new Date(dayStart)),
        lte(posts.createdAt, new Date(dayEnd)),
        isNull(posts.deletedAt)
      )
    )
    .groupBy(posts.boardId)

  const postsByBoard: Record<string, number> = {}
  for (const row of boardRows) {
    if (row.boardId) postsByBoard[row.boardId] = row.value
  }

  // Posts by source (new today) -- source is derived from vote sourceType or post metadata
  // For now, default all to 'portal' since source tracking on posts isn't implemented yet
  const postsBySource: Record<string, number> = {
    portal: newPostsResult.value,
  }

  // Upsert today's row
  await db
    .insert(analyticsDailyStats)
    .values({
      date: today,
      newPosts: newPostsResult.value,
      newVotes: newVotesResult.value,
      newComments: newCommentsResult.value,
      newUsers: newUsersResult.value,
      postsByStatus,
      postsByBoard,
      postsBySource,
      computedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: analyticsDailyStats.date,
      set: {
        newPosts: newPostsResult.value,
        newVotes: newVotesResult.value,
        newComments: newCommentsResult.value,
        newUsers: newUsersResult.value,
        postsByStatus,
        postsByBoard,
        postsBySource,
        computedAt: new Date(),
      },
    })

  // Refresh top posts for each period
  await refreshTopPosts()

  console.log(`[analytics] Refresh complete for ${today}`)
}

async function refreshTopPosts(): Promise<void> {
  const periods = [
    { key: '7d', days: 7 },
    { key: '30d', days: 30 },
    { key: '90d', days: 90 },
    { key: '12m', days: 365 },
  ] as const

  const now = new Date()

  for (const { key, days } of periods) {
    const since = new Date(now.getTime() - days * 86400000)

    // Get top 10 posts by vote count within the period
    const topPosts = await db
      .select({
        postId: posts.id,
        title: posts.title,
        voteCount: count(votes.id),
        boardName: boards.name,
        statusName: postStatuses.name,
      })
      .from(posts)
      .leftJoin(votes, and(eq(votes.postId, posts.id), gte(votes.createdAt, since)))
      .leftJoin(boards, eq(posts.boardId, boards.id))
      .leftJoin(postStatuses, eq(posts.statusId, postStatuses.id))
      .where(and(isNull(posts.deletedAt), gte(posts.createdAt, since)))
      .groupBy(posts.id, posts.title, boards.name, postStatuses.name)
      .orderBy(desc(count(votes.id)))
      .limit(10)

    // Also get comment counts for these posts
    const postIds = topPosts.map((p) => p.postId)
    const commentCounts: Record<string, number> = {}
    if (postIds.length > 0) {
      const commentRows = await db
        .select({
          postId: comments.postId,
          value: count(),
        })
        .from(comments)
        .where(
          and(
            sql`${comments.postId} = ANY(${postIds})`,
            gte(comments.createdAt, since),
            isNull(comments.deletedAt)
          )
        )
        .groupBy(comments.postId)

      for (const row of commentRows) {
        commentCounts[row.postId] = row.value
      }
    }

    // Delete old entries for this period, then insert new ones
    await db.delete(analyticsTopPosts).where(eq(analyticsTopPosts.period, key))

    if (topPosts.length > 0) {
      await db.insert(analyticsTopPosts).values(
        topPosts.map((post, i) => ({
          period: key,
          rank: i + 1,
          postId: post.postId,
          title: post.title,
          voteCount: post.voteCount,
          commentCount: commentCounts[post.postId] ?? 0,
          boardName: post.boardName,
          statusName: post.statusName,
          computedAt: new Date(),
        }))
      )
    }
  }
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd apps/web && bunx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/server/domains/analytics/analytics.service.ts
git commit -m "Add analytics refresh service with daily stats and top posts aggregation"
```

---

## Task 9: Analytics BullMQ Queue

**Files:**

- Create: `apps/web/src/lib/server/domains/analytics/analytics-queue.ts`
- Modify: `apps/web/src/lib/server/startup.ts`

- [ ] **Step 1: Create the analytics queue**

Create `apps/web/src/lib/server/domains/analytics/analytics-queue.ts`:

```ts
/**
 * Analytics queue -- hourly refresh of materialized stats.
 */

import { Queue, Worker } from 'bullmq'
import { config } from '@/lib/server/config'

const QUEUE_NAME = '{analytics}'
const CONCURRENCY = 1

const DEFAULT_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: true,
  removeOnFail: { age: 7 * 86400 },
}

interface AnalyticsJob {
  type: 'refresh-analytics'
}

let initPromise: Promise<{ queue: Queue<AnalyticsJob>; worker: Worker<AnalyticsJob> }> | null = null

async function initializeQueue() {
  const connOpts = {
    url: config.redisUrl,
    maxRetriesPerRequest: null as null,
    connectTimeout: 5_000,
  }

  const queue = new Queue<AnalyticsJob>(QUEUE_NAME, {
    connection: connOpts,
    defaultJobOptions: DEFAULT_JOB_OPTS,
  })

  const worker = new Worker<AnalyticsJob>(
    QUEUE_NAME,
    async (job) => {
      if (job.data.type === 'refresh-analytics') {
        const { refreshAnalytics } = await import('./analytics.service')
        await refreshAnalytics()
      }
    },
    { connection: connOpts, concurrency: CONCURRENCY }
  )

  // Register hourly refresh as a repeatable job
  await queue.add(
    'analytics:refresh',
    { type: 'refresh-analytics' },
    {
      repeat: { pattern: '0 * * * *' }, // Top of every hour
      removeOnComplete: true,
      removeOnFail: { age: 7 * 86400 },
    }
  )

  try {
    await Promise.race([
      queue.waitUntilReady(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Redis connection timeout (5s)')), 5_000)
      ),
    ])
  } catch (error) {
    await queue.close().catch(() => {})
    await worker.close().catch(() => {})
    throw error
  }

  worker.on('failed', (job, error) => {
    if (!job) return
    const isPermanent =
      job.attemptsMade >= (job.opts.attempts ?? 1) || error.name === 'UnrecoverableError'
    const prefix = isPermanent ? 'permanently failed' : `failed (attempt ${job.attemptsMade})`
    console.error(`[Analytics] ${prefix}: ${error.message}`)
  })

  return { queue, worker }
}

/** Initialize the analytics queue worker eagerly (called from startup). */
export async function initAnalyticsWorker(): Promise<void> {
  if (!initPromise) {
    initPromise = initializeQueue().catch((err) => {
      initPromise = null
      throw err
    })
  }
  await initPromise
  console.log('[Analytics] Worker initialized')
}
```

- [ ] **Step 2: Register in startup.ts**

Add after line 43 (after the feedback AI worker initialization) in `startup.ts`:

```ts
// Initialize analytics worker (hourly stats refresh)
import('./domains/analytics/analytics-queue')
  .then(({ initAnalyticsWorker }) => initAnalyticsWorker())
  .catch((err) => console.error('[Startup] Failed to init analytics worker:', err))
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/server/domains/analytics/analytics-queue.ts \
  apps/web/src/lib/server/startup.ts
git commit -m "Add analytics BullMQ queue with hourly refresh schedule"
```

---

## Task 10: Analytics Server Function

**Files:**

- Create: `apps/web/src/lib/server/functions/analytics.ts`

- [ ] **Step 1: Create the analytics server function**

Create `apps/web/src/lib/server/functions/analytics.ts`:

```ts
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  db,
  analyticsDailyStats,
  analyticsTopPosts,
  postStatuses,
  votes,
  comments,
  posts,
  principal,
  changelogEntries,
  gte,
  lte,
  and,
  eq,
  ne,
  isNull,
  count,
  desc,
  sql,
} from '@/lib/server/db'

const periodSchema = z.enum(['7d', '30d', '90d', '12m'])
type Period = z.infer<typeof periodSchema>

function getPeriodDates(period: Period) {
  const now = new Date()
  const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365
  const start = new Date(now.getTime() - days * 86400000)
  const previousStart = new Date(start.getTime() - days * 86400000)
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: now.toISOString().slice(0, 10),
    previousStartDate: previousStart.toISOString().slice(0, 10),
    previousEndDate: start.toISOString().slice(0, 10),
  }
}

export const getAnalyticsData = createServerFn({ method: 'GET' })
  .validator(z.object({ period: periodSchema }))
  .handler(async ({ data: { period } }) => {
    const { startDate, endDate, previousStartDate, previousEndDate } = getPeriodDates(period)

    // Fetch daily stats for current and previous periods
    const [currentStats, previousStats] = await Promise.all([
      db
        .select()
        .from(analyticsDailyStats)
        .where(
          and(gte(analyticsDailyStats.date, startDate), lte(analyticsDailyStats.date, endDate))
        )
        .orderBy(analyticsDailyStats.date),
      db
        .select()
        .from(analyticsDailyStats)
        .where(
          and(
            gte(analyticsDailyStats.date, previousStartDate),
            lte(analyticsDailyStats.date, previousEndDate)
          )
        ),
    ])

    // Compute summary totals
    const sumStats = (rows: typeof currentStats) =>
      rows.reduce(
        (acc, row) => ({
          posts: acc.posts + row.newPosts,
          votes: acc.votes + row.newVotes,
          comments: acc.comments + row.newComments,
          users: acc.users + row.newUsers,
        }),
        { posts: 0, votes: 0, comments: 0, users: 0 }
      )

    const current = sumStats(currentStats)
    const previous = sumStats(previousStats)

    function delta(curr: number, prev: number): number {
      if (prev === 0) return curr > 0 ? 100 : 0
      return Math.round(((curr - prev) / prev) * 1000) / 10
    }

    const summary = {
      posts: { total: current.posts, delta: delta(current.posts, previous.posts) },
      votes: { total: current.votes, delta: delta(current.votes, previous.votes) },
      comments: { total: current.comments, delta: delta(current.comments, previous.comments) },
      users: { total: current.users, delta: delta(current.users, previous.users) },
    }

    // Daily stats for chart
    const dailyStats = currentStats.map((row) => ({
      date: row.date,
      posts: row.newPosts,
      votes: row.newVotes,
      comments: row.newComments,
    }))

    // Status distribution from latest day's snapshot
    const latestDay = currentStats.at(-1)
    const statusDistribution: Array<{ status: string; color: string; count: number }> = []
    if (latestDay?.postsByStatus) {
      const statusColors = await db
        .select({ slug: postStatuses.slug, name: postStatuses.name, color: postStatuses.color })
        .from(postStatuses)

      const colorMap = new Map(statusColors.map((s) => [s.slug, { name: s.name, color: s.color }]))

      for (const [slug, cnt] of Object.entries(latestDay.postsByStatus)) {
        const info = colorMap.get(slug)
        statusDistribution.push({
          status: info?.name ?? slug,
          color: info?.color ?? '#888888',
          count: cnt,
        })
      }
      statusDistribution.sort((a, b) => b.count - a.count)
    }

    // Board breakdown (summed across period)
    const boardTotals: Record<string, number> = {}
    for (const row of currentStats) {
      if (row.postsByBoard) {
        for (const [boardId, cnt] of Object.entries(row.postsByBoard)) {
          boardTotals[boardId] = (boardTotals[boardId] ?? 0) + cnt
        }
      }
    }

    // Resolve board names
    const boardBreakdown: Array<{ board: string; count: number }> = []
    if (Object.keys(boardTotals).length > 0) {
      const { boards } = await import('@/lib/server/db')
      const boardRows = await db.select({ id: boards.id, name: boards.name }).from(boards)
      const nameMap = new Map(boardRows.map((b) => [b.id, b.name]))
      for (const [boardId, cnt] of Object.entries(boardTotals)) {
        boardBreakdown.push({ board: nameMap.get(boardId) ?? 'Unknown', count: cnt })
      }
      boardBreakdown.sort((a, b) => b.count - a.count)
    }

    // Source breakdown (summed across period)
    const sourceTotals: Record<string, number> = {}
    for (const row of currentStats) {
      if (row.postsBySource) {
        for (const [source, cnt] of Object.entries(row.postsBySource)) {
          sourceTotals[source] = (sourceTotals[source] ?? 0) + cnt
        }
      }
    }
    const sourceBreakdown = Object.entries(sourceTotals)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)

    // Top posts from materialized table
    const topPosts = await db
      .select()
      .from(analyticsTopPosts)
      .where(eq(analyticsTopPosts.period, period))
      .orderBy(analyticsTopPosts.rank)

    // Top contributors (live query -- small result set)
    const since = new Date(
      Date.now() -
        (period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365) * 86400000
    )

    const topContributors = await db.execute(sql`
      SELECT
        p.id as "principalId",
        p.display_name as "displayName",
        p.avatar_url as "avatarUrl",
        COALESCE(post_counts.cnt, 0)::int as posts,
        COALESCE(vote_counts.cnt, 0)::int as votes,
        COALESCE(comment_counts.cnt, 0)::int as comments,
        (COALESCE(post_counts.cnt, 0) + COALESCE(vote_counts.cnt, 0) + COALESCE(comment_counts.cnt, 0))::int as total
      FROM principal p
      LEFT JOIN (
        SELECT owner_principal_id as pid, COUNT(*)::int as cnt
        FROM posts WHERE created_at >= ${since} AND deleted_at IS NULL
        GROUP BY owner_principal_id
      ) post_counts ON post_counts.pid = p.id
      LEFT JOIN (
        SELECT principal_id as pid, COUNT(*)::int as cnt
        FROM votes WHERE created_at >= ${since}
        GROUP BY principal_id
      ) vote_counts ON vote_counts.pid = p.id
      LEFT JOIN (
        SELECT principal_id as pid, COUNT(*)::int as cnt
        FROM comments WHERE created_at >= ${since} AND deleted_at IS NULL
        GROUP BY principal_id
      ) comment_counts ON comment_counts.pid = p.id
      WHERE p.type != 'anonymous' AND p.role = 'user'
        AND (COALESCE(post_counts.cnt, 0) + COALESCE(vote_counts.cnt, 0) + COALESCE(comment_counts.cnt, 0)) > 0
      ORDER BY total DESC
      LIMIT 5
    `)

    // Changelog stats for the period
    const [changelogStats] = await db
      .select({
        totalViews: sql<number>`COALESCE(SUM(${changelogEntries.viewCount}), 0)::int`,
        totalEntries: count(),
      })
      .from(changelogEntries)
      .where(and(gte(changelogEntries.publishedAt, since), isNull(changelogEntries.deletedAt)))

    // Get the latest computedAt timestamp
    const computedAt = currentStats.at(-1)?.computedAt?.toISOString() ?? null

    return {
      summary,
      dailyStats,
      statusDistribution,
      boardBreakdown,
      sourceBreakdown,
      topPosts: topPosts.map((p) => ({
        rank: p.rank,
        postId: p.postId,
        title: p.title,
        voteCount: p.voteCount,
        commentCount: p.commentCount,
        boardName: p.boardName,
        statusName: p.statusName,
      })),
      topContributors: (topContributors.rows ?? topContributors) as Array<{
        principalId: string
        displayName: string
        avatarUrl: string | null
        posts: number
        votes: number
        comments: number
        total: number
      }>,
      changelog: {
        totalViews: changelogStats?.totalViews ?? 0,
        totalReactions: 0, // TODO: aggregate from changelog reactions when table exists
      },
      computedAt,
    }
  })
```

- [ ] **Step 2: Create query keys**

Create `apps/web/src/lib/client/queries/analytics.ts`:

```ts
import { queryOptions } from '@tanstack/react-query'
import { getAnalyticsData } from '@/lib/server/functions/analytics'

export type AnalyticsPeriod = '7d' | '30d' | '90d' | '12m'

export const analyticsQueries = {
  data: (period: AnalyticsPeriod) =>
    queryOptions({
      queryKey: ['analytics', period],
      queryFn: () => getAnalyticsData({ data: { period } }),
      staleTime: 5 * 60 * 1000, // 5 minutes (data refreshes hourly)
    }),
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/server/functions/analytics.ts \
  apps/web/src/lib/client/queries/analytics.ts
git commit -m "Add analytics server function and query keys"
```

---

## Task 11: Install shadcn Chart Component

- [ ] **Step 1: Add the shadcn chart component**

Run:

```bash
cd apps/web && bunx shadcn@latest add chart
```

This installs `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`, and the `ChartConfig` type into `components/ui/chart.tsx`.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ui/chart.tsx apps/web/package.json bun.lock
git commit -m "Add shadcn/ui chart component"
```

---

## Task 12: Analytics Page Components

**Files:**

- Create: `apps/web/src/components/admin/analytics/analytics-summary-cards.tsx`
- Create: `apps/web/src/components/admin/analytics/analytics-activity-chart.tsx`
- Create: `apps/web/src/components/admin/analytics/analytics-status-chart.tsx`
- Create: `apps/web/src/components/admin/analytics/analytics-board-chart.tsx`
- Create: `apps/web/src/components/admin/analytics/analytics-source-chart.tsx`
- Create: `apps/web/src/components/admin/analytics/analytics-top-posts.tsx`
- Create: `apps/web/src/components/admin/analytics/analytics-top-contributors.tsx`
- Create: `apps/web/src/components/admin/analytics/analytics-page.tsx`

This is the largest task. Each component should be built as a focused file. Refer to the spec wireframes in `docs/superpowers/specs/2026-03-27-analytics-and-auth-cleanup-design.md` for the exact layout, card anatomy, chart details, and UX principles.

Key implementation notes:

- All charts must use `ChartContainer` + `ChartTooltip` + `ChartLegend` from `@/components/ui/chart`
- Define a `ChartConfig` per chart for color/label theming via CSS variables
- Activity chart uses recharts `AreaChart` with `monotone` curves and semi-transparent fills
- Status and board charts use horizontal `BarChart` with `radius={4}` rounded corners
- Source chart uses `PieChart` with `innerRadius` for donut style
- Summary cards use shadcn `Card` with delta badges (green up arrow / red down arrow)
- Tables use shadcn `Table` component
- All components accept data as props (no internal fetching)
- Empty states: each card shows muted "No data for this period" text
- Loading: parent page handles skeleton states

- [ ] **Step 1: Create analytics-summary-cards.tsx**

Build the 4 summary cards (Posts, Votes, Comments, Users) with total + delta badge. See spec wireframe for card anatomy.

- [ ] **Step 2: Create analytics-activity-chart.tsx**

Build the area chart with three series (posts, votes, comments). Use `ChartContainer`, `AreaChart`, `Area`, `XAxis`, `YAxis`, `CartesianGrid`, `ChartTooltip`, `ChartLegend`.

- [ ] **Step 3: Create analytics-status-chart.tsx**

Build horizontal bar chart for status distribution. Bars use status colors from the data.

- [ ] **Step 4: Create analytics-board-chart.tsx**

Build horizontal bar chart for board breakdown. Use generated palette from `ChartConfig`.

- [ ] **Step 5: Create analytics-source-chart.tsx**

Build donut chart for source breakdown (portal, widget, API).

- [ ] **Step 6: Create analytics-top-posts.tsx**

Build table with rank, title (linked to admin post detail), votes, comments, board badge, status badge.

- [ ] **Step 7: Create analytics-top-contributors.tsx**

Build table with avatar (initials fallback), name, posts, votes, comments, total.

- [ ] **Step 8: Create analytics-page.tsx (orchestrator)**

Build the page component that:

- Has period selector pill buttons (7d/30d/90d/12m) using `useState`
- Uses `useSuspenseQuery` with `analyticsQueries.data(period)`
- Renders all sub-components with the query data
- Shows skeleton loading via React Suspense boundary
- Shows "Last updated X minutes ago" from `computedAt` using `date-fns/formatDistanceToNow`

- [ ] **Step 9: Verify compilation**

Run: `cd apps/web && bunx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/components/admin/analytics/
git commit -m "Add analytics page components with shadcn charts"
```

---

## Task 13: Analytics Route and Sidebar

**Files:**

- Create: `apps/web/src/routes/admin/analytics.tsx`
- Modify: `apps/web/src/components/admin/admin-sidebar.tsx`

- [ ] **Step 1: Create the admin analytics route**

Create `apps/web/src/routes/admin/analytics.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'
import { AnalyticsPage } from '@/components/admin/analytics/analytics-page'

export const Route = createFileRoute('/admin/analytics')({
  component: AnalyticsRoute,
})

function AnalyticsRoute() {
  return (
    <Suspense fallback={<AnalyticsPageSkeleton />}>
      <AnalyticsPage />
    </Suspense>
  )
}

function AnalyticsPageSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-32 rounded bg-muted" />
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-9 w-20 rounded-md bg-muted" />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 rounded-lg bg-muted" />
        ))}
      </div>
      <div className="h-72 rounded-lg bg-muted" />
      <div className="grid grid-cols-2 gap-4">
        <div className="h-56 rounded-lg bg-muted" />
        <div className="h-56 rounded-lg bg-muted" />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add Analytics to the admin sidebar**

In `apps/web/src/components/admin/admin-sidebar.tsx`, add the `BarChart3` import from lucide-react (or use a Heroicons equivalent like `ChartBarIcon`):

```ts
import { ChartBarIcon } from '@heroicons/react/24/solid'
```

Then add the Analytics entry to the `navItems` array, between Help Center and Users (line 45):

```ts
const navItems = [
  { label: 'Feedback', href: '/admin/feedback', icon: ChatBubbleLeftIcon, hasBadge: true },
  { label: 'Roadmap', href: '/admin/roadmap', icon: MapIcon },
  { label: 'Changelog', href: '/admin/changelog', icon: DocumentTextIcon },
  { label: 'Help Center', href: '/admin/help-center', icon: QuestionMarkCircleIcon },
  { label: 'Analytics', href: '/admin/analytics', icon: ChartBarIcon },
  { label: 'Users', href: '/admin/users', icon: UsersIcon },
]
```

- [ ] **Step 3: Test in browser**

Run: `bun run dev`

Navigate to `http://localhost:3001/admin/analytics`. Verify:

1. Sidebar shows Analytics icon between Help Center and Users
2. Page loads with skeleton, then shows the analytics dashboard
3. Period selector switches data
4. Charts render correctly
5. Empty states show when no data exists

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/admin/analytics.tsx \
  apps/web/src/components/admin/admin-sidebar.tsx
git commit -m "Add analytics admin route and sidebar entry"
```

---

## Task 14: Seed Initial Analytics Data

- [ ] **Step 1: Trigger an initial analytics refresh**

The hourly job won't have run yet. Trigger a manual refresh to populate data:

```bash
cd apps/web && bun -e "
  const { refreshAnalytics } = require('./src/lib/server/domains/analytics/analytics.service');
  refreshAnalytics().then(() => console.log('Done')).catch(console.error);
"
```

If the above doesn't work due to module resolution, add a temporary script or use the dev server console to call `refreshAnalytics()`.

- [ ] **Step 2: Verify data in the analytics page**

Navigate to the analytics page in the browser and verify charts populate with real data.

- [ ] **Step 3: Run full type check and lint**

```bash
bun run typecheck && bun run lint
```

Fix any issues.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A && git commit -m "Fix lint and type errors from analytics implementation"
```
