# Public Portal Filter Chips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the public portal's `Filter` popover with a chip-based filter system mirroring the admin inbox; default to hiding `Complete`/`Closed` posts with a discoverable "Show all" override.

**Architecture:** Extend the existing public posts server filter (`buildPostFilterConditions`) with `minVotes`, `dateFrom`, `responded`. Build a new `PublicFiltersBar` component that mirrors the admin's `ActiveFiltersBar` structure but is typed against `PublicFeedbackFilters`, uses `react-intl`, and reuses the shared `FilterChip` primitive. Wire new URL params through the route schema, `usePublicFilters` hook, and TanStack Query keys. The active-by-default behaviour is already enforced server-side in `post.public.ts`; this plan adds the UI layer (chip menu, status submenu grouped by category, "Hiding completed and closed" hint, "Show all" action).

**Tech Stack:** TanStack Start, TanStack Query, Zod, Drizzle ORM, react-intl, Tailwind v4, shadcn/ui, Playwright (e2e), Vitest (unit/component).

**Spec:** `docs/superpowers/specs/2026-04-28-public-portal-filter-chips-design.md`

---

## File Structure

### New files

- `apps/web/src/components/public/feedback/public-filters-bar.tsx` — chip row + `+ Add filter` popover, mirroring admin's `active-filters-bar.tsx` but typed against `PublicFeedbackFilters` and i18n via `react-intl`.
- `apps/web/src/components/public/feedback/public-filters-bar-defaults.ts` — `VOTE_THRESHOLDS`, `DATE_PRESETS`, `getDateFromDaysAgo` (mirrors admin's constants).
- `apps/web/src/components/public/feedback/__tests__/public-filters-bar.test.tsx` — component test.
- `apps/web/src/components/public/feedback/__tests__/use-public-filters.test.ts` — hook unit test.
- `apps/web/e2e/tests/public/post-list-filters.spec.ts` — Playwright spec for default-active hiding, status reveal, votes filter, clear all.

### Modified files

- `apps/web/src/lib/server/domains/posts/post.public.ts` — extend `PostListParams`, add `gte` import, three new condition blocks in `buildPostFilterConditions`.
- `apps/web/src/lib/server/domains/posts/__tests__/post-public.test.ts` — five new test cases.
- `apps/web/src/lib/server/functions/portal.ts` — extend `fetchPortalDataSchema`, forward new fields into `listPublicPostsWithVotesAndAvatars`.
- `apps/web/src/lib/server/functions/public-posts.ts` — extend `listPublicPostsSchema`, forward new fields into `listPublicPosts`.
- `apps/web/src/lib/client/queries/portal.ts` — extend `portalQueries.portalData` params type and queryKey.
- `apps/web/src/lib/client/hooks/use-portal-posts-query.ts` — extend `fetchPublicPosts` to forward new fields to `listPublicPostsFn`.
- `apps/web/src/lib/shared/types/filters.ts` — extend `PublicFeedbackFilters`.
- `apps/web/src/routes/_portal/index.tsx` — extend `searchSchema`; pass new fields into both the loader's `portalQueries.portalData(...)` and the page-level `useQuery`.
- `apps/web/src/components/public/feedback/use-public-filters.ts` — extend filter derivation, `setFilters` writer, navigation-completed comparison, `activeFilterCount`, `clearFilters`.
- `apps/web/src/components/public/feedback/feedback-toolbar.tsx` — drop `Filter` button and its 7 props.
- `apps/web/src/components/public/feedback/feedback-container.tsx` — render `<PublicFiltersBar>` below the toolbar; update `mergedFilters` and `filterKey`.
- `apps/web/src/locales/en.json` — add new keys.
- `apps/web/src/locales/{ar,de,es,fr,ru}.json` — remove stale keys (other locales fall back to `defaultMessage`).

### Deleted files

- `apps/web/src/components/public/feedback/filter-dropdown.tsx` — replaced by `PublicFiltersBar`.

---

## Task 1: Server filter conditions for `minVotes`, `dateFrom`, `responded`

**Files:**

- Modify: `apps/web/src/lib/server/domains/posts/post.public.ts`
- Test: `apps/web/src/lib/server/domains/posts/__tests__/post-public.test.ts`

- [ ] **Step 1: Extend the test mock to surface `gte`**

In `apps/web/src/lib/server/domains/posts/__tests__/post-public.test.ts`, add `mockGte` near the other mocks (around line 9) and extend the `vi.mock('@/lib/server/db', ...)` call (around line 59) to expose it.

```ts
const mockGte = vi.fn((col, val) => ({ _tag: 'gte', col, val }))

// ... in the existing vi.mock('@/lib/server/db', ...) factory, add:
gte: mockGte,
```

Also extend the `mockPosts` object to include the columns the new conditions reference (already includes `voteCount`, `createdAt` — verify those are present; they already are at lines 19, 23).

- [ ] **Step 2: Write the failing tests**

Append the following tests to `apps/web/src/lib/server/domains/posts/__tests__/post-public.test.ts`:

```ts
describe('listPublicPostsWithVotesAndAvatars — additional filters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubWhere.mockReturnValue(SUBQUERY_MARKER)
    mockMainOffset.mockResolvedValue([])
    mockMainLimit.mockReturnValue({ offset: mockMainOffset })
    mockMainOrderBy.mockReturnValue({ limit: mockMainLimit })
    mockMainWhere.mockReturnValue({ orderBy: mockMainOrderBy })
    mockMainInnerJoin.mockReturnValue({ where: mockMainWhere })
  })

  it('applies gte(voteCount, n) when minVotes is provided', async () => {
    const { listPublicPostsWithVotesAndAvatars } = await import('../post.public')

    await listPublicPostsWithVotesAndAvatars({ minVotes: 10 })

    expect(mockGte).toHaveBeenCalledWith(mockPosts.voteCount, 10)
  })

  it('does not apply minVotes condition when minVotes is 0 or unset', async () => {
    const { listPublicPostsWithVotesAndAvatars } = await import('../post.public')

    await listPublicPostsWithVotesAndAvatars({ minVotes: 0 })

    const voteCountCalls = mockGte.mock.calls.filter(([col]) => col === mockPosts.voteCount)
    expect(voteCountCalls).toHaveLength(0)
  })

  it('applies gte(createdAt, …) when dateFrom is provided', async () => {
    const { listPublicPostsWithVotesAndAvatars } = await import('../post.public')

    await listPublicPostsWithVotesAndAvatars({ dateFrom: '2026-04-01' })

    const createdAtCall = mockGte.mock.calls.find(([col]) => col === mockPosts.createdAt)
    expect(createdAtCall).toBeDefined()
    expect(createdAtCall?.[1]).toBeInstanceOf(Date)
  })

  it('applies an EXISTS(is_team_member) raw SQL when responded=responded', async () => {
    const { listPublicPostsWithVotesAndAvatars } = await import('../post.public')

    await listPublicPostsWithVotesAndAvatars({ responded: 'responded' })

    // mockSql is called with template literal arrays; verify at least one call
    // contains an EXISTS subquery referencing is_team_member
    const sqlCalls = mockSql.mock.calls
    const hasExists = sqlCalls.some((call) => {
      const fragments = call[0] as TemplateStringsArray | undefined
      return fragments?.some((s) => s.includes('EXISTS') && s.includes('is_team_member'))
    })
    expect(hasExists).toBe(true)
  })

  it('applies a NOT EXISTS raw SQL when responded=unresponded', async () => {
    const { listPublicPostsWithVotesAndAvatars } = await import('../post.public')

    await listPublicPostsWithVotesAndAvatars({ responded: 'unresponded' })

    const sqlCalls = mockSql.mock.calls
    const hasNotExists = sqlCalls.some((call) => {
      const fragments = call[0] as TemplateStringsArray | undefined
      return fragments?.some((s) => s.includes('NOT EXISTS') && s.includes('is_team_member'))
    })
    expect(hasNotExists).toBe(true)
  })

  it('applies the active-category default alongside minVotes (status default is gated only on status absence)', async () => {
    const { listPublicPostsWithVotesAndAvatars } = await import('../post.public')

    await listPublicPostsWithVotesAndAvatars({ minVotes: 5 })

    expect(mockEq).toHaveBeenCalledWith(mockPostStatuses.category, 'active')
    expect(mockGte).toHaveBeenCalledWith(mockPosts.voteCount, 5)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /home/james/quackback && bun run --cwd apps/web vitest run src/lib/server/domains/posts/__tests__/post-public.test.ts
```

Expected: 6 new tests fail with `mockGte` not being called or `Cannot read properties of undefined` (because `gte`/the new conditions aren't in `post.public.ts` yet).

- [ ] **Step 4: Implement the new conditions in `post.public.ts`**

Edit `apps/web/src/lib/server/domains/posts/post.public.ts`:

a) Add `gte` to the imports from `@/lib/server/db` (line 1-15 area):

```ts
import {
  db,
  eq,
  and,
  or,
  inArray,
  desc,
  sql,
  isNull,
  gte,
  posts,
  // ... rest unchanged
```

b) Extend `PostListParams` (around lines 79-87):

```ts
interface PostListParams {
  boardSlug?: string
  search?: string
  statusIds?: StatusId[]
  statusSlugs?: string[]
  tagIds?: TagId[]
  sort?: SortOrder
  page?: number
  limit?: number
  minVotes?: number
  dateFrom?: string
  responded?: 'responded' | 'unresponded'
}
```

c) Extend `buildPostFilterConditions` (around lines 89-131). After the existing `search` clause, before `return conditions`, add:

```ts
if (typeof params.minVotes === 'number' && params.minVotes > 0) {
  conditions.push(gte(posts.voteCount, params.minVotes))
}

if (params.dateFrom) {
  conditions.push(gte(posts.createdAt, new Date(params.dateFrom)))
}

if (params.responded === 'responded') {
  // Raw SQL with explicit table name — Drizzle relational builder rewrites
  // ${comments.postId} to outer table alias inside subqueries (see post.inbox.ts:138-142).
  conditions.push(
    sql`EXISTS (SELECT 1 FROM comments WHERE comments.post_id = ${posts.id} AND comments.is_team_member = true AND comments.deleted_at IS NULL)`
  )
} else if (params.responded === 'unresponded') {
  conditions.push(
    sql`NOT EXISTS (SELECT 1 FROM comments WHERE comments.post_id = ${posts.id} AND comments.is_team_member = true AND comments.deleted_at IS NULL)`
  )
}
```

(Note: `params.minVotes`, `params.dateFrom`, `params.responded` are accessed via `params.X` rather than destructured at the top of the function, to keep the destructure tidy. Optionally destructure them like the existing fields — both styles match the existing codebase.)

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /home/james/quackback && bun run --cwd apps/web vitest run src/lib/server/domains/posts/__tests__/post-public.test.ts
```

Expected: all 9 tests (3 existing + 6 new) pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/domains/posts/post.public.ts apps/web/src/lib/server/domains/posts/__tests__/post-public.test.ts
git commit -m "feat(posts): add minVotes, dateFrom, responded filters to public post query"
```

---

## Task 2: Wire new fields through public server functions

**Files:**

- Modify: `apps/web/src/lib/server/functions/portal.ts`
- Modify: `apps/web/src/lib/server/functions/public-posts.ts`

- [ ] **Step 1: Extend `fetchPortalDataSchema` in `portal.ts`**

In `apps/web/src/lib/server/functions/portal.ts`, replace the `fetchPortalDataSchema` definition (around lines 44-51):

```ts
const fetchPortalDataSchema = z.object({
  boardSlug: z.string().optional(),
  search: z.string().optional(),
  sort: sortSchema,
  statusSlugs: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  userId: z.string().optional(),
  minVotes: z.number().int().min(1).optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  responded: z.enum(['responded', 'unresponded']).optional(),
})
```

- [ ] **Step 2: Forward new fields into `listPublicPostsWithVotesAndAvatars`**

In the same file, inside the `fetchPortalData` handler (`Promise.all` call at lines 74-101), update the `listPublicPostsWithVotesAndAvatars` invocation (around lines 85-93):

```ts
listPublicPostsWithVotesAndAvatars({
  boardSlug: data.boardSlug,
  search: data.search,
  statusSlugs: data.statusSlugs,
  tagIds: data.tagIds as TagId[] | undefined,
  sort: data.sort,
  page: 1,
  limit: 20,
  minVotes: data.minVotes,
  dateFrom: data.dateFrom,
  responded: data.responded,
}),
```

- [ ] **Step 3: Extend `listPublicPostsSchema` in `public-posts.ts`**

In `apps/web/src/lib/server/functions/public-posts.ts`, replace the `listPublicPostsSchema` definition (around lines 43-52):

```ts
const listPublicPostsSchema = z.object({
  boardSlug: z.string().optional(),
  search: z.string().optional(),
  statusIds: z.array(z.string()).optional(),
  statusSlugs: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  sort: z.enum(['top', 'new', 'trending']).optional().default('top'),
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(20),
  minVotes: z.number().int().min(1).optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  responded: z.enum(['responded', 'unresponded']).optional(),
})
```

- [ ] **Step 4: Forward new fields into `listPublicPosts`**

In the same file, inside `listPublicPostsFn` handler (around lines 119-151), update the `listPublicPosts` invocation:

```ts
const result = await listPublicPosts({
  boardSlug: data.boardSlug,
  search: data.search,
  statusIds: data.statusIds as StatusId[] | undefined,
  statusSlugs: data.statusSlugs,
  tagIds: data.tagIds as TagId[] | undefined,
  sort: data.sort,
  page: data.page,
  limit: data.limit,
  minVotes: data.minVotes,
  dateFrom: data.dateFrom,
  responded: data.responded,
})
```

- [ ] **Step 5: Typecheck**

```bash
cd /home/james/quackback && bun run --cwd apps/web typecheck
```

Expected: no errors related to the modified files (pre-existing errors elsewhere are out of scope).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/functions/portal.ts apps/web/src/lib/server/functions/public-posts.ts
git commit -m "feat(portal): forward minVotes/dateFrom/responded filters in server fns"
```

---

## Task 3: Extend client types, query factory, and route schema

**Files:**

- Modify: `apps/web/src/lib/shared/types/filters.ts`
- Modify: `apps/web/src/lib/client/queries/portal.ts`
- Modify: `apps/web/src/lib/client/hooks/use-portal-posts-query.ts`
- Modify: `apps/web/src/routes/_portal/index.tsx`

- [ ] **Step 1: Extend `PublicFeedbackFilters`**

In `apps/web/src/lib/shared/types/filters.ts`, replace the `PublicFeedbackFilters` interface (around lines 35-41):

```ts
export interface PublicFeedbackFilters {
  board?: string
  search?: string
  sort?: 'top' | 'new' | 'trending'
  status?: string[]
  tagIds?: string[]
  minVotes?: number
  dateFrom?: string
  responded?: 'responded' | 'unresponded'
}
```

- [ ] **Step 2: Extend `portalQueries.portalData` params + queryKey**

In `apps/web/src/lib/client/queries/portal.ts`, update the `portalData` factory (around lines 22-50):

```ts
portalData: (params: {
  boardSlug?: string
  search?: string
  sort: 'top' | 'new' | 'trending'
  statusSlugs?: string[]
  tagIds?: string[]
  userId?: string
  minVotes?: number
  dateFrom?: string
  responded?: 'responded' | 'unresponded'
}) =>
  queryOptions({
    queryKey: [
      'portal',
      'data',
      params.boardSlug,
      params.search,
      params.sort,
      params.statusSlugs,
      params.tagIds,
      params.userId,
      params.minVotes,
      params.dateFrom,
      params.responded,
    ],
    queryFn: async () => {
      const data = await fetchPortalData({ data: params })
      // ... rest unchanged
```

- [ ] **Step 3: Extend `fetchPublicPosts` in `use-portal-posts-query.ts`**

In `apps/web/src/lib/client/hooks/use-portal-posts-query.ts`, update the `fetchPublicPosts` helper (around lines 76-102):

```ts
async function fetchPublicPosts(
  filters: PublicFeedbackFilters,
  page: number
): Promise<PublicPostListResult> {
  const statusIds: string[] = []
  const statusSlugs: string[] = []
  for (const s of filters.status || []) {
    if (s.startsWith('status_')) {
      statusIds.push(s)
    } else {
      statusSlugs.push(s)
    }
  }

  return (await listPublicPostsFn({
    data: {
      boardSlug: filters.board,
      search: filters.search,
      statusIds: statusIds.length > 0 ? (statusIds as StatusId[]) : undefined,
      statusSlugs: statusSlugs.length > 0 ? statusSlugs : undefined,
      tagIds: filters.tagIds as TagId[] | undefined,
      sort: filters.sort || 'top',
      page,
      limit: 20,
      minVotes: filters.minVotes,
      dateFrom: filters.dateFrom,
      responded: filters.responded,
    },
  })) as unknown as PublicPostListResult
}
```

(The infinite-query `queryKey` already uses the entire `filters` object via `publicPostsKeys.list(filters)`, so the new fields automatically participate in cache identity. No queryKey change needed here.)

- [ ] **Step 4: Extend `searchSchema` in route**

In `apps/web/src/routes/_portal/index.tsx`, replace the `searchSchema` (around lines 13-19):

```ts
const searchSchema = z.object({
  board: z.string().optional(),
  search: z.string().optional(),
  sort: z.enum(['top', 'new', 'trending']).optional().default('top'),
  status: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  minVotes: z.coerce.number().int().min(1).optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  responded: z.enum(['responded', 'unresponded']).optional(),
})
```

- [ ] **Step 5: Pass new fields into loader's `portalQueries.portalData(...)` call**

In the same file's loader (around lines 40-49):

```ts
const portalData = await queryClient.ensureQueryData(
  portalQueries.portalData({
    boardSlug: searchParams.board,
    search: searchParams.search,
    sort: searchParams.sort ?? 'top',
    statusSlugs: searchParams.status?.length ? searchParams.status : undefined,
    tagIds: searchParams.tagIds?.length ? searchParams.tagIds : undefined,
    userId: session?.user?.id,
    minVotes: searchParams.minVotes,
    dateFrom: searchParams.dateFrom,
    responded: searchParams.responded,
  })
)
```

- [ ] **Step 6: Pass new fields into page-level `useQuery`**

Same file, in `PublicPortalPage` component (around lines 104-114):

```ts
const { data: portalData, isFetching } = useQuery({
  ...portalQueries.portalData({
    boardSlug: currentBoard,
    search: currentSearch,
    sort: currentSort,
    statusSlugs: search.status?.length ? search.status : undefined,
    tagIds: search.tagIds?.length ? search.tagIds : undefined,
    userId: session?.user?.id,
    minVotes: search.minVotes,
    dateFrom: search.dateFrom,
    responded: search.responded,
  }),
  placeholderData: keepPreviousData,
})
```

- [ ] **Step 7: Typecheck**

```bash
cd /home/james/quackback && bun run --cwd apps/web typecheck
```

Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/shared/types/filters.ts apps/web/src/lib/client/queries/portal.ts apps/web/src/lib/client/hooks/use-portal-posts-query.ts apps/web/src/routes/_portal/index.tsx
git commit -m "feat(portal): plumb new filter fields through types, query, and route schema"
```

---

## Task 4: Update `usePublicFilters` hook

**Files:**

- Modify: `apps/web/src/components/public/feedback/use-public-filters.ts`
- Test: `apps/web/src/components/public/feedback/__tests__/use-public-filters.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/public/feedback/__tests__/use-public-filters.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const navigateMock = vi.fn()
let routerSearch: Record<string, unknown> = {}

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('@/routes/_portal/index', () => ({
  Route: {
    useSearch: () => routerSearch,
  },
}))

import { usePublicFilters } from '../use-public-filters'

describe('usePublicFilters', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    routerSearch = {}
  })

  it('counts each new filter type once in activeFilterCount', () => {
    routerSearch = {
      status: ['open'],
      tagIds: ['tag_1', 'tag_2'],
      minVotes: 10,
      dateFrom: '2026-04-01',
      responded: 'responded',
    }
    const { result } = renderHook(() => usePublicFilters())

    // status (1) + tagIds (2) + minVotes (1) + dateFrom (1) + responded (1) = 6
    expect(result.current.activeFilterCount).toBe(6)
    expect(result.current.hasActiveFilters).toBe(true)
  })

  it('clearFilters removes status, tags, minVotes, dateFrom, responded but preserves search/sort/board', () => {
    routerSearch = {
      board: 'feature-requests',
      search: 'login',
      sort: 'new',
      status: ['open'],
      tagIds: ['tag_1'],
      minVotes: 10,
      dateFrom: '2026-04-01',
      responded: 'responded',
    }
    const { result } = renderHook(() => usePublicFilters())

    act(() => {
      result.current.clearFilters()
    })

    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/',
        search: expect.objectContaining({
          board: 'feature-requests',
          sort: 'new',
          search: 'login',
          status: undefined,
          tagIds: undefined,
          minVotes: undefined,
          dateFrom: undefined,
          responded: undefined,
        }),
      })
    )
  })

  it('setFilters writes new filter fields to the URL', () => {
    routerSearch = { sort: 'top' }
    const { result } = renderHook(() => usePublicFilters())

    act(() => {
      result.current.setFilters({ minVotes: 25 })
    })

    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({ minVotes: 25 }),
      })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/james/quackback && bun run --cwd apps/web vitest run src/components/public/feedback/__tests__/use-public-filters.test.ts
```

Expected: tests fail (`activeFilterCount` is wrong, `clearFilters` doesn't clear new fields, `setFilters` doesn't write new fields).

- [ ] **Step 3: Update `usePublicFilters`**

Replace the entire `apps/web/src/components/public/feedback/use-public-filters.ts` with:

```ts
import { useNavigate } from '@tanstack/react-router'
import { Route } from '@/routes/_portal/index'
import { useMemo, useCallback, useRef, useSyncExternalStore } from 'react'
import type { PublicFeedbackFilters } from '@/lib/shared/types'

export type { PublicFeedbackFilters }

let optimisticState: PublicFeedbackFilters | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return optimisticState
}

function getServerSnapshot() {
  return null
}

function setOptimistic(filters: PublicFeedbackFilters | null) {
  optimisticState = filters
  listeners.forEach((l) => l())
}

export function usePublicFilters() {
  const navigate = useNavigate()
  const routerSearch = Route.useSearch()

  const optimistic = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const lastRouterSearchRef = useRef(routerSearch)

  // Clear optimistic state when ANY tracked field changes (navigation completed)
  if (
    optimistic &&
    (lastRouterSearchRef.current.board !== routerSearch.board ||
      lastRouterSearchRef.current.sort !== routerSearch.sort ||
      lastRouterSearchRef.current.search !== routerSearch.search ||
      lastRouterSearchRef.current.minVotes !== routerSearch.minVotes ||
      lastRouterSearchRef.current.dateFrom !== routerSearch.dateFrom ||
      lastRouterSearchRef.current.responded !== routerSearch.responded ||
      lastRouterSearchRef.current.status?.join() !== routerSearch.status?.join() ||
      lastRouterSearchRef.current.tagIds?.join() !== routerSearch.tagIds?.join())
  ) {
    setOptimistic(null)
  }
  lastRouterSearchRef.current = routerSearch

  const filters: PublicFeedbackFilters = useMemo(() => {
    if (optimistic) return optimistic
    return {
      board: routerSearch.board,
      search: routerSearch.search,
      sort: routerSearch.sort,
      status: routerSearch.status?.length ? routerSearch.status : undefined,
      tagIds: routerSearch.tagIds?.length ? routerSearch.tagIds : undefined,
      minVotes: routerSearch.minVotes,
      dateFrom: routerSearch.dateFrom,
      responded: routerSearch.responded,
    }
  }, [optimistic, routerSearch])

  const setFilters = useCallback(
    (updates: Partial<PublicFeedbackFilters>) => {
      const newFilters = { ...filters, ...updates }
      setOptimistic(newFilters)

      void navigate({
        to: '/',
        search: {
          board: newFilters.board,
          search: newFilters.search,
          sort: newFilters.sort,
          status: newFilters.status,
          tagIds: newFilters.tagIds,
          minVotes: newFilters.minVotes,
          dateFrom: newFilters.dateFrom,
          responded: newFilters.responded,
        },
        replace: true,
      })
    },
    [navigate, filters]
  )

  const clearFilters = useCallback(() => {
    setFilters({
      status: undefined,
      tagIds: undefined,
      minVotes: undefined,
      dateFrom: undefined,
      responded: undefined,
    })
  }, [setFilters])

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (filters.status?.length) count += filters.status.length
    if (filters.tagIds?.length) count += filters.tagIds.length
    if (filters.minVotes) count += 1
    if (filters.dateFrom) count += 1
    if (filters.responded) count += 1
    return count
  }, [filters.status, filters.tagIds, filters.minVotes, filters.dateFrom, filters.responded])

  const hasActiveFilters = activeFilterCount > 0

  return {
    filters,
    setFilters,
    clearFilters,
    activeFilterCount,
    hasActiveFilters,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /home/james/quackback && bun run --cwd apps/web vitest run src/components/public/feedback/__tests__/use-public-filters.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/public/feedback/use-public-filters.ts apps/web/src/components/public/feedback/__tests__/use-public-filters.test.ts
git commit -m "feat(portal): extend usePublicFilters with minVotes/dateFrom/responded"
```

---

## Task 5: Add filter-bar constants

**Files:**

- Create: `apps/web/src/components/public/feedback/public-filters-bar-defaults.ts`

- [ ] **Step 1: Create the constants file**

Create `apps/web/src/components/public/feedback/public-filters-bar-defaults.ts`:

```ts
import { toIsoDateOnly } from '@/lib/shared/utils'

export const VOTE_THRESHOLDS = [
  { value: 5, label: '5+ votes' },
  { value: 10, label: '10+ votes' },
  { value: 25, label: '25+ votes' },
  { value: 50, label: '50+ votes' },
  { value: 100, label: '100+ votes' },
] as const

export const DATE_PRESETS = [
  { value: 'today', label: 'Today', daysAgo: 0 },
  { value: '7days', label: 'Last 7 days', daysAgo: 7 },
  { value: '30days', label: 'Last 30 days', daysAgo: 30 },
  { value: '90days', label: 'Last 90 days', daysAgo: 90 },
] as const

export type DatePresetValue = (typeof DATE_PRESETS)[number]['value']

export function getDateFromDaysAgo(days: number): string {
  const date = new Date()
  if (days > 0) {
    date.setDate(date.getDate() - days)
  } else {
    date.setHours(0, 0, 0, 0)
  }
  return toIsoDateOnly(date)
}

export const RESPONDED_OPTIONS = [
  { value: 'responded', label: 'Has team response' },
  { value: 'unresponded', label: 'Awaiting team response' },
] as const

export type RespondedValue = (typeof RESPONDED_OPTIONS)[number]['value']

/**
 * Status category groups for the Status submenu.
 * Order matches the settings page (Active first, then Complete, then Closed).
 */
export const STATUS_CATEGORY_ORDER = ['active', 'complete', 'closed'] as const
```

- [ ] **Step 2: Typecheck**

```bash
cd /home/james/quackback && bun run --cwd apps/web typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/public/feedback/public-filters-bar-defaults.ts
git commit -m "feat(portal): add filter-bar preset constants"
```

---

## Task 6: Build `PublicFiltersBar` component

**Files:**

- Create: `apps/web/src/components/public/feedback/public-filters-bar.tsx`
- Test: `apps/web/src/components/public/feedback/__tests__/public-filters-bar.test.tsx`

- [ ] **Step 1: Write the component test**

Create `apps/web/src/components/public/feedback/__tests__/public-filters-bar.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { PublicFiltersBar } from '../public-filters-bar'
import type { PostStatusEntity, Tag } from '@/lib/shared/db-types'

const statuses: PostStatusEntity[] = [
  {
    id: 'status_1' as PostStatusEntity['id'],
    slug: 'open',
    name: 'Open',
    color: '#3b82f6',
    category: 'active',
  } as PostStatusEntity,
  {
    id: 'status_2' as PostStatusEntity['id'],
    slug: 'complete',
    name: 'Complete',
    color: '#10b981',
    category: 'complete',
  } as PostStatusEntity,
]

const tags: Tag[] = [
  { id: 'tag_1', name: 'Backend', color: '#8b5cf6' } as Tag,
  { id: 'tag_2', name: 'Frontend', color: '#ec4899' } as Tag,
]

function renderBar(overrides: Partial<React.ComponentProps<typeof PublicFiltersBar>> = {}) {
  const setFilters = vi.fn()
  const clearFilters = vi.fn()
  render(
    <IntlProvider locale="en" defaultLocale="en">
      <PublicFiltersBar
        filters={{ sort: 'top' }}
        setFilters={setFilters}
        clearFilters={clearFilters}
        statuses={statuses}
        tags={tags}
        {...overrides}
      />
    </IntlProvider>
  )
  return { setFilters, clearFilters }
}

describe('PublicFiltersBar', () => {
  it('renders the Add filter button when no filters are active', () => {
    renderBar()
    expect(screen.getByRole('button', { name: /add filter/i })).toBeInTheDocument()
  })

  it('shows the "Hiding completed and closed" hint when no status filter is set', () => {
    renderBar()
    expect(screen.getByText(/hiding completed and closed/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show all/i })).toBeInTheDocument()
  })

  it('hides the hint once a status is selected', () => {
    renderBar({ filters: { sort: 'top', status: ['open'] } })
    expect(screen.queryByText(/hiding completed and closed/i)).not.toBeInTheDocument()
  })

  it('Show all sets status to all known status slugs', () => {
    const { setFilters } = renderBar()
    fireEvent.click(screen.getByRole('button', { name: /show all/i }))
    expect(setFilters).toHaveBeenCalledWith({ status: ['open', 'complete'] })
  })

  it('renders a status chip per active status with correct label', () => {
    renderBar({ filters: { sort: 'top', status: ['open'] } })
    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByText(/^Status:$/)).toBeInTheDocument()
  })

  it('renders combined Tags chip when 3+ tags selected', () => {
    const tagsMany: Tag[] = [
      ...tags,
      { id: 'tag_3', name: 'API', color: '#f59e0b' } as Tag,
      { id: 'tag_4', name: 'Mobile', color: '#06b6d4' } as Tag,
    ]
    renderBar({
      filters: { sort: 'top', tagIds: ['tag_1', 'tag_2', 'tag_3', 'tag_4'] },
      tags: tagsMany,
    })
    expect(screen.getByText(/Backend, Frontend \+2/)).toBeInTheDocument()
  })

  it('shows Clear all when 2+ chips active', () => {
    renderBar({ filters: { sort: 'top', minVotes: 10, dateFrom: '2026-04-01' } })
    expect(screen.getByRole('button', { name: /clear all/i })).toBeInTheDocument()
  })

  it('does not show Clear all with only 1 chip', () => {
    renderBar({ filters: { sort: 'top', minVotes: 10 } })
    expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument()
  })

  it('clicking a vote-count preset calls setFilters with minVotes', () => {
    const { setFilters } = renderBar()
    fireEvent.click(screen.getByRole('button', { name: /add filter/i }))
    fireEvent.click(screen.getByRole('button', { name: /vote count/i }))
    fireEvent.click(screen.getByRole('button', { name: /25\+ votes/i }))
    expect(setFilters).toHaveBeenCalledWith({ minVotes: 25 })
  })

  it('clicking a status in the submenu adds it via setFilters', () => {
    const { setFilters } = renderBar()
    fireEvent.click(screen.getByRole('button', { name: /^add filter$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^Status$/i }))
    // 'Open' status is rendered as a button with the status name as text content.
    // No role='dialog' on Radix Popover, so locate the menu item by its accessible name directly.
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(setFilters).toHaveBeenCalledWith({ status: ['open'] })
  })

  it('Clear all calls clearFilters', () => {
    const { clearFilters } = renderBar({
      filters: { sort: 'top', minVotes: 10, dateFrom: '2026-04-01' },
    })
    fireEvent.click(screen.getByRole('button', { name: /clear all/i }))
    expect(clearFilters).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/james/quackback && bun run --cwd apps/web vitest run src/components/public/feedback/__tests__/public-filters-bar.test.tsx
```

Expected: fails because `PublicFiltersBar` does not exist.

- [ ] **Step 3: Implement the component**

Create `apps/web/src/components/public/feedback/public-filters-bar.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import {
  TagIcon,
  CalendarIcon,
  ArrowTrendingUpIcon,
  ChatBubbleLeftRightIcon,
  PlusIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { FilterChip, type FilterOption } from '@/components/shared/filter-chip'
import type { PublicFeedbackFilters } from '@/lib/shared/types'
import type { PostStatusEntity, Tag } from '@/lib/shared/db-types'
import { toggleItem } from '@/components/admin/feedback/filter-utils'
import {
  VOTE_THRESHOLDS,
  DATE_PRESETS,
  RESPONDED_OPTIONS,
  STATUS_CATEGORY_ORDER,
  getDateFromDaysAgo,
  type DatePresetValue,
  type RespondedValue,
} from './public-filters-bar-defaults'

type FilterCategory = 'status' | 'tag' | 'votes' | 'date' | 'response'

type IconComponent = React.ComponentType<{ className?: string }>

function CircleIcon({ className }: { className?: string }) {
  return <span className={`inline-block rounded-full bg-current ${className}`} />
}

const MENU_BUTTON_STYLES =
  'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-muted/50 transition-colors'

interface MenuButtonProps {
  onClick: () => void
  children: React.ReactNode
  className?: string
}

function MenuButton({ onClick, children, className }: MenuButtonProps) {
  return (
    <button type="button" onClick={onClick} className={cn(MENU_BUTTON_STYLES, className)}>
      {children}
    </button>
  )
}

interface PublicFiltersBarProps {
  filters: PublicFeedbackFilters
  setFilters: (updates: Partial<PublicFeedbackFilters>) => void
  clearFilters: () => void
  statuses: PostStatusEntity[]
  tags: Tag[]
}

export function PublicFiltersBar({
  filters,
  setFilters,
  clearFilters,
  statuses,
  tags,
}: PublicFiltersBarProps) {
  const intl = useIntl()
  const showHidingHint = !filters.status?.length

  const handleShowAll = () => {
    setFilters({ status: statuses.map((s) => s.slug) })
  }

  const activeChips = useMemo(
    () => buildActiveChips({ filters, setFilters, statuses, tags, intl }),
    [filters, setFilters, statuses, tags, intl]
  )

  return (
    <div className="bg-card/50" role="region" aria-label="Active filters">
      <div className="flex flex-wrap gap-1 items-center">
        {activeChips.map(({ key, type, ...chipProps }) => (
          <FilterChip key={key} icon={getIconForType(type)} {...chipProps} />
        ))}

        <AddFilterButton
          filters={filters}
          setFilters={setFilters}
          statuses={statuses}
          tags={tags}
        />

        {activeChips.length >= 2 && (
          <button
            type="button"
            onClick={clearFilters}
            className={cn(
              'text-[11px] text-muted-foreground hover:text-foreground',
              'px-1.5 py-0.5 rounded',
              'hover:bg-muted/50',
              'transition-colors'
            )}
          >
            <FormattedMessage id="portal.feedback.filter.clearAll" defaultMessage="Clear all" />
          </button>
        )}
      </div>

      {showHidingHint && (
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>
            <FormattedMessage
              id="portal.feedback.filter.hidingCompleted"
              defaultMessage="Hiding completed and closed posts."
            />
          </span>
          <button
            type="button"
            onClick={handleShowAll}
            className="underline hover:text-foreground transition-colors"
          >
            <FormattedMessage id="portal.feedback.filter.showAll" defaultMessage="Show all" />
          </button>
        </div>
      )}
    </div>
  )
}

interface AddFilterButtonProps {
  filters: PublicFeedbackFilters
  setFilters: (updates: Partial<PublicFeedbackFilters>) => void
  statuses: PostStatusEntity[]
  tags: Tag[]
}

function AddFilterButton({ filters, setFilters, statuses, tags }: AddFilterButtonProps) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState<FilterCategory | null>(null)

  const closePopover = () => {
    setOpen(false)
    setActiveCategory(null)
  }

  const categories: { key: FilterCategory; label: string; icon: IconComponent }[] = [
    {
      key: 'status',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.category.status',
        defaultMessage: 'Status',
      }),
      icon: CircleIcon,
    },
    {
      key: 'tag',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.category.tag',
        defaultMessage: 'Tag',
      }),
      icon: TagIcon,
    },
    {
      key: 'votes',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.category.votes',
        defaultMessage: 'Vote count',
      }),
      icon: ArrowTrendingUpIcon,
    },
    {
      key: 'date',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.category.date',
        defaultMessage: 'Created date',
      }),
      icon: CalendarIcon,
    },
    {
      key: 'response',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.category.response',
        defaultMessage: 'Team response',
      }),
      icon: ChatBubbleLeftRightIcon,
    },
  ]

  const groupedStatuses = useMemo(() => {
    const groups: Record<string, PostStatusEntity[]> = {}
    for (const cat of STATUS_CATEGORY_ORDER) groups[cat] = []
    for (const s of statuses) {
      const cat = (s.category ?? 'active') as string
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(s)
    }
    return groups
  }, [statuses])

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen) setActiveCategory(null)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5',
            'rounded-full text-xs',
            'border border-dashed border-border/50',
            'text-muted-foreground hover:text-foreground',
            'hover:border-border hover:bg-muted/30',
            'transition-colors'
          )}
        >
          <PlusIcon className="h-3 w-3" />
          <FormattedMessage id="portal.feedback.filter.addFilter" defaultMessage="Add filter" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-0">
        {activeCategory === null ? (
          <div className="py-1">
            {categories.map((category) => {
              const Icon = category.icon
              return (
                <button
                  key={category.key}
                  type="button"
                  onClick={() => setActiveCategory(category.key)}
                  className={cn(
                    'w-full flex items-center justify-between gap-2 px-2.5 py-1.5',
                    'text-xs text-left',
                    'hover:bg-muted/50 transition-colors'
                  )}
                  aria-label={category.label}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    {category.label}
                  </span>
                  <ChevronRightIcon className="h-3 w-3 text-muted-foreground" />
                </button>
              )
            })}
          </div>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground border-b border-border/50"
            >
              <ChevronRightIcon className="h-2.5 w-2.5 rotate-180" />
              <FormattedMessage id="portal.feedback.filter.back" defaultMessage="Back" />
            </button>
            <div className="max-h-[250px] overflow-y-auto py-1">
              {activeCategory === 'status' &&
                STATUS_CATEGORY_ORDER.map((cat) => {
                  const list = groupedStatuses[cat] ?? []
                  if (list.length === 0) return null
                  return (
                    <div key={cat}>
                      <div className="px-2.5 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        <FormattedMessage
                          id={`portal.feedback.filter.statusGroup.${cat}`}
                          defaultMessage={cat[0].toUpperCase() + cat.slice(1)}
                        />
                      </div>
                      {list.map((status) => (
                        <MenuButton
                          key={status.id}
                          onClick={() => {
                            setFilters({ status: toggleItem(filters.status, status.slug) })
                            closePopover()
                          }}
                        >
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: status.color }}
                          />
                          {status.name}
                        </MenuButton>
                      ))}
                    </div>
                  )
                })}

              {activeCategory === 'tag' &&
                tags.map((tag) => (
                  <MenuButton
                    key={tag.id}
                    onClick={() => {
                      setFilters({ tagIds: toggleItem(filters.tagIds, tag.id) })
                      closePopover()
                    }}
                  >
                    {tag.name}
                  </MenuButton>
                ))}

              {activeCategory === 'votes' &&
                VOTE_THRESHOLDS.map((t) => (
                  <MenuButton
                    key={t.value}
                    onClick={() => {
                      setFilters({ minVotes: t.value })
                      closePopover()
                    }}
                  >
                    {t.label}
                  </MenuButton>
                ))}

              {activeCategory === 'date' &&
                DATE_PRESETS.map((p) => (
                  <MenuButton
                    key={p.value}
                    onClick={() => {
                      setFilters({ dateFrom: getDateFromDaysAgo(p.daysAgo) })
                      closePopover()
                    }}
                  >
                    {p.label}
                  </MenuButton>
                ))}

              {activeCategory === 'response' &&
                RESPONDED_OPTIONS.map((opt) => (
                  <MenuButton
                    key={opt.value}
                    onClick={() => {
                      setFilters({ responded: opt.value })
                      closePopover()
                    }}
                  >
                    {opt.label}
                  </MenuButton>
                ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

interface ActiveChipDescriptor {
  key: string
  type: 'status' | 'tags' | 'votes' | 'date' | 'response'
  label: string
  value: string
  valueId: string
  color?: string
  options?: FilterOption[]
  onChange?: (newId: string) => void
  onRemove: () => void
}

function buildActiveChips(args: {
  filters: PublicFeedbackFilters
  setFilters: (updates: Partial<PublicFeedbackFilters>) => void
  statuses: PostStatusEntity[]
  tags: Tag[]
  intl: ReturnType<typeof useIntl>
}): ActiveChipDescriptor[] {
  const { filters, setFilters, statuses, tags, intl } = args
  const chips: ActiveChipDescriptor[] = []

  const statusOptions: FilterOption[] = statuses.map((s) => ({
    id: s.slug,
    label: s.name,
    color: s.color,
  }))

  // Status chips — one per selected slug
  if (filters.status?.length) {
    for (const slug of filters.status) {
      const status = statuses.find((s) => s.slug === slug)
      if (!status) continue
      chips.push({
        key: `status-${slug}`,
        type: 'status',
        label: intl.formatMessage({
          id: 'portal.feedback.filter.chip.status',
          defaultMessage: 'Status:',
        }),
        value: status.name,
        valueId: slug,
        color: status.color,
        options: statusOptions,
        onChange: (newSlug) => {
          const others = filters.status?.filter((s) => s !== slug) ?? []
          setFilters({ status: [...others, newSlug] })
        },
        onRemove: () => {
          const next = filters.status?.filter((s) => s !== slug)
          setFilters({ status: next?.length ? next : undefined })
        },
      })
    }
  }

  // Tags — 1-2 individual, 3+ combined
  if (filters.tagIds?.length) {
    const tagOptions: FilterOption[] = tags.map((t) => ({ id: t.id, label: t.name }))
    if (filters.tagIds.length <= 2) {
      for (const id of filters.tagIds) {
        const tag = tags.find((t) => t.id === id)
        if (!tag) continue
        chips.push({
          key: `tag-${id}`,
          type: 'tags',
          label: intl.formatMessage({
            id: 'portal.feedback.filter.chip.tag',
            defaultMessage: 'Tag:',
          }),
          value: tag.name,
          valueId: id,
          options: tagOptions,
          onChange: (newId) => {
            const others = filters.tagIds?.filter((t) => t !== id) ?? []
            setFilters({ tagIds: [...others, newId] })
          },
          onRemove: () => {
            const next = filters.tagIds?.filter((t) => t !== id)
            setFilters({ tagIds: next?.length ? next : undefined })
          },
        })
      }
    } else {
      const names = filters.tagIds
        .map((id) => tags.find((t) => t.id === id)?.name)
        .filter((n): n is string => !!n)
      chips.push({
        key: 'tags-combined',
        type: 'tags',
        label: intl.formatMessage({
          id: 'portal.feedback.filter.chip.tags',
          defaultMessage: 'Tags:',
        }),
        value: `${names.slice(0, 2).join(', ')} +${names.length - 2}`,
        valueId: 'combined',
        onRemove: () => setFilters({ tagIds: undefined }),
      })
    }
  }

  // Vote count
  if (filters.minVotes) {
    const opts: FilterOption[] = VOTE_THRESHOLDS.map((t) => ({
      id: String(t.value),
      label: t.label,
    }))
    const matched = VOTE_THRESHOLDS.find((t) => t.value === filters.minVotes)
    chips.push({
      key: 'minVotes',
      type: 'votes',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.chip.votes',
        defaultMessage: 'Min votes:',
      }),
      value: matched ? matched.label : `${filters.minVotes}+`,
      valueId: String(filters.minVotes),
      options: opts,
      onChange: (id) => setFilters({ minVotes: parseInt(id, 10) }),
      onRemove: () => setFilters({ minVotes: undefined }),
    })
  }

  // Created date
  if (filters.dateFrom) {
    const opts: FilterOption[] = DATE_PRESETS.map((p) => ({ id: p.value, label: p.label }))
    const matched = DATE_PRESETS.find((p) => getDateFromDaysAgo(p.daysAgo) === filters.dateFrom)
    chips.push({
      key: 'dateFrom',
      type: 'date',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.chip.date',
        defaultMessage: 'Date:',
      }),
      value: matched ? matched.label : filters.dateFrom,
      valueId: matched?.value ?? filters.dateFrom,
      options: opts,
      onChange: (presetId) => {
        const preset = DATE_PRESETS.find((p) => p.value === (presetId as DatePresetValue))
        if (preset) setFilters({ dateFrom: getDateFromDaysAgo(preset.daysAgo) })
      },
      onRemove: () => setFilters({ dateFrom: undefined }),
    })
  }

  // Team response
  if (filters.responded) {
    const opts: FilterOption[] = RESPONDED_OPTIONS.map((o) => ({ id: o.value, label: o.label }))
    const matched = RESPONDED_OPTIONS.find((o) => o.value === filters.responded)
    chips.push({
      key: 'responded',
      type: 'response',
      label: intl.formatMessage({
        id: 'portal.feedback.filter.chip.response',
        defaultMessage: 'Team response:',
      }),
      value: matched?.label ?? filters.responded,
      valueId: filters.responded,
      options: opts,
      onChange: (id) => setFilters({ responded: id as RespondedValue }),
      onRemove: () => setFilters({ responded: undefined }),
    })
  }

  return chips
}

function getIconForType(type: ActiveChipDescriptor['type']): IconComponent {
  const map: Record<ActiveChipDescriptor['type'], IconComponent> = {
    status: CircleIcon,
    tags: TagIcon,
    votes: ArrowTrendingUpIcon,
    date: CalendarIcon,
    response: ChatBubbleLeftRightIcon,
  }
  return map[type]
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /home/james/quackback && bun run --cwd apps/web vitest run src/components/public/feedback/__tests__/public-filters-bar.test.tsx
```

Expected: all 11 tests pass. (If `toggleItem` import path differs, check `apps/web/src/components/admin/feedback/filter-utils.ts` and adjust.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/public/feedback/public-filters-bar.tsx apps/web/src/components/public/feedback/__tests__/public-filters-bar.test.tsx
git commit -m "feat(portal): add PublicFiltersBar component with chip system"
```

---

## Task 7: Wire `PublicFiltersBar` into the toolbar; remove old dropdown

**Files:**

- Modify: `apps/web/src/components/public/feedback/feedback-container.tsx`
- Modify: `apps/web/src/components/public/feedback/feedback-toolbar.tsx`
- Delete: `apps/web/src/components/public/feedback/filter-dropdown.tsx`

- [ ] **Step 1: Trim `FeedbackToolbar`**

In `apps/web/src/components/public/feedback/feedback-toolbar.tsx`:

a) Remove imports:

```ts
import { FilterDropdown } from '@/components/public/feedback/filter-dropdown'
import type { PostStatusEntity, Tag } from '@/lib/shared/db-types'
```

b) Remove these props from the `FeedbackToolbarProps` interface: `statuses`, `tags`, `selectedStatuses`, `selectedTagIds`, `onStatusChange`, `onTagChange`, `onClearFilters`, `activeFilterCount`.

c) Remove the destructure entries for those props in the function signature.

d) Remove the `<FilterDropdown ... />` JSX block (around lines 156-165) at the end of the toolbar.

After: the toolbar component receives only `currentSort`, `onSortChange`, `currentSearch`, `onSearchChange`, `isLoading` and renders Sort buttons + Search popover.

- [ ] **Step 2: Wire `<PublicFiltersBar>` into `FeedbackContainer`**

In `apps/web/src/components/public/feedback/feedback-container.tsx`:

a) Add the import:

```ts
import { PublicFiltersBar } from '@/components/public/feedback/public-filters-bar'
```

b) Update `usePublicFilters` destructure to include `clearFilters`:

```ts
const { filters, setFilters, clearFilters, activeFilterCount } = usePublicFilters()
```

c) Update `mergedFilters` (around lines 80-89) to include the new fields:

```ts
const mergedFilters = useMemo(
  () => ({
    board: activeBoard,
    search: activeSearch,
    sort: activeSort,
    status: activeStatuses.length > 0 ? activeStatuses : undefined,
    tagIds: activeTagIds.length > 0 ? activeTagIds : undefined,
    minVotes: filters.minVotes,
    dateFrom: filters.dateFrom,
    responded: filters.responded,
  }),
  [
    activeBoard,
    activeSearch,
    activeSort,
    activeStatuses,
    activeTagIds,
    filters.minVotes,
    filters.dateFrom,
    filters.responded,
  ]
)
```

d) Update the `filterKey` for animations (around line 65):

```ts
const filterKey = `${filters.board ?? currentBoard}-${filters.sort ?? currentSort}-${filters.search ?? currentSearch}-${(filters.status ?? []).join()}-${(filters.tagIds ?? []).join()}-${filters.minVotes ?? ''}-${filters.dateFrom ?? ''}-${filters.responded ?? ''}`
```

e) Update `filtersMatchInitial` (around lines 99-104) to also account for the new fields:

```ts
const filtersMatchInitial =
  mergedFilters.board === initialFiltersRef.current.board &&
  mergedFilters.search === initialFiltersRef.current.search &&
  mergedFilters.sort === initialFiltersRef.current.sort &&
  !mergedFilters.status?.length &&
  !mergedFilters.tagIds?.length &&
  !mergedFilters.minVotes &&
  !mergedFilters.dateFrom &&
  !mergedFilters.responded
```

f) Replace the toolbar invocation (around lines 220-236) — drop the now-removed props:

```tsx
<FeedbackToolbar
  currentSort={activeSort}
  onSortChange={handleSortChange}
  currentSearch={activeSearch}
  onSearchChange={handleSearchChange}
  isLoading={isLoading}
/>
```

g) Add the new bar directly below the toolbar (still inside `<div className="flex-1">`):

```tsx
<div className="flex-1">
  <FeedbackToolbar
    currentSort={activeSort}
    onSortChange={handleSortChange}
    currentSearch={activeSearch}
    onSearchChange={handleSearchChange}
    isLoading={isLoading}
  />
  <div className="mt-2">
    <PublicFiltersBar
      filters={filters}
      setFilters={setFilters}
      clearFilters={clearFilters}
      statuses={statuses}
      tags={tags}
    />
  </div>
</div>
```

h) Delete the now-unused handlers (`handleStatusChange`, `handleTagChange`, `handleClearFilters`) from `FeedbackContainer`. Also remove the now-unused `activeFilterCount` reference if only the toolbar consumed it (the empty-state guard around line 242 still uses `activeFilterCount` — keep the destructure, just stop passing it to toolbar).

- [ ] **Step 3: Delete the old dropdown**

```bash
rm /home/james/quackback/apps/web/src/components/public/feedback/filter-dropdown.tsx
```

- [ ] **Step 4: Typecheck and run vitest**

```bash
cd /home/james/quackback && bun run --cwd apps/web typecheck
cd /home/james/quackback && bun run --cwd apps/web vitest run src/components/public/feedback
```

Expected: no type errors; all component tests pass.

- [ ] **Step 5: Smoke-test in dev**

```bash
cd /home/james/quackback && bun run dev
```

Visit `http://localhost:3000/`. Verify:

- Old `Filter` button is gone.
- `+ Add filter` button is visible below the Sort/Search row.
- Hint _"Hiding completed and closed posts. Show all"_ is visible by default.
- Clicking `+ Add filter` opens the menu with 5 categories; submenus work.
- Adding a status chip removes the hint.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/public/feedback/feedback-toolbar.tsx apps/web/src/components/public/feedback/feedback-container.tsx
git rm apps/web/src/components/public/feedback/filter-dropdown.tsx
git commit -m "feat(portal): replace Filter button with chip-based PublicFiltersBar"
```

---

## Task 8: i18n cleanup

**Files:**

- Modify: `apps/web/src/locales/en.json`
- Modify: `apps/web/src/locales/{ar,de,es,fr,ru}.json`

- [ ] **Step 1: Remove stale keys from all locale files**

For each of `en.json`, `ar.json`, `de.json`, `es.json`, `fr.json`, `ru.json` in `apps/web/src/locales/`, delete these keys (search for and remove the JSON entries):

- `portal.feedback.toolbar.filter`
- `portal.feedback.filter.title`
- `portal.feedback.filter.clearAll`
- `portal.feedback.filter.statusLabel`
- `portal.feedback.filter.tagsLabel`
- `portal.feedback.filter.noFilters`

Use a one-shot script:

```bash
cd /home/james/quackback/apps/web/src/locales
for f in *.json; do
  bun -e "const fs=require('fs'); const p='$f'; const o=JSON.parse(fs.readFileSync(p,'utf8')); for (const k of ['portal.feedback.toolbar.filter','portal.feedback.filter.title','portal.feedback.filter.clearAll','portal.feedback.filter.statusLabel','portal.feedback.filter.tagsLabel','portal.feedback.filter.noFilters']) delete o[k]; fs.writeFileSync(p, JSON.stringify(o,null,2)+'\n');"
done
```

- [ ] **Step 2: Add new English entries to `en.json`**

Add these key/value pairs to `apps/web/src/locales/en.json` (anywhere in the JSON object — preserve alphabetical-ish ordering if the file has one, otherwise append):

```json
"portal.feedback.filter.addFilter": "Add filter",
"portal.feedback.filter.clearAll": "Clear all",
"portal.feedback.filter.back": "Back",
"portal.feedback.filter.hidingCompleted": "Hiding completed and closed posts.",
"portal.feedback.filter.showAll": "Show all",
"portal.feedback.filter.category.status": "Status",
"portal.feedback.filter.category.tag": "Tag",
"portal.feedback.filter.category.votes": "Vote count",
"portal.feedback.filter.category.date": "Created date",
"portal.feedback.filter.category.response": "Team response",
"portal.feedback.filter.statusGroup.active": "Active",
"portal.feedback.filter.statusGroup.complete": "Complete",
"portal.feedback.filter.statusGroup.closed": "Closed",
"portal.feedback.filter.chip.status": "Status:",
"portal.feedback.filter.chip.tag": "Tag:",
"portal.feedback.filter.chip.tags": "Tags:",
"portal.feedback.filter.chip.votes": "Min votes:",
"portal.feedback.filter.chip.date": "Date:",
"portal.feedback.filter.chip.response": "Team response:"
```

(Other locale files don't need new entries — `react-intl` falls back to `defaultMessage`. Stub translations can be added in a follow-up.)

- [ ] **Step 3: Validate JSON**

```bash
cd /home/james/quackback/apps/web/src/locales && for f in *.json; do bun -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || (echo "FAIL: $f"; exit 1); done && echo "all locales valid"
```

Expected: `all locales valid`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/locales/
git commit -m "chore(i18n): swap public portal filter message IDs to chip-based keys"
```

---

## Task 9: Playwright e2e

**Files:**

- Create: `apps/web/e2e/tests/public/post-list-filters.spec.ts`

- [ ] **Step 1: Write the e2e spec**

Create `apps/web/e2e/tests/public/post-list-filters.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test.describe('Public Post List — chip filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('shows the "Hiding completed and closed" hint by default', async ({ page }) => {
    await expect(page.getByText(/hiding completed and closed/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /show all/i })).toBeVisible()
  })

  test('Show all reveals all statuses (URL contains status param)', async ({ page }) => {
    await page.getByRole('button', { name: /show all/i }).click()
    await expect(page).toHaveURL(/[?&]status=/, { timeout: 5000 })
  })

  test('Add filter → Vote count → 5+ filters posts and adds a chip', async ({ page }) => {
    await page.getByRole('button', { name: /add filter/i }).click()
    await page.getByRole('button', { name: /^Vote count$/i }).click()
    await page.getByRole('button', { name: /5\+ votes/i }).click()

    await expect(page).toHaveURL(/[?&]minVotes=5/, { timeout: 5000 })
    await expect(page.getByText(/min votes:/i)).toBeVisible()
  })

  test('adding a Status chip removes the hint and updates URL', async ({ page }) => {
    await page.getByRole('button', { name: /add filter/i }).click()
    await page.getByRole('button', { name: /^Status$/i }).click()

    // Click the seeded "Open" status (default seed includes Open in the Active group).
    // If the seed changes status names, swap to whatever Active status the seed exposes.
    await page.getByRole('button', { name: /^Open$/ }).click()

    await expect(page).toHaveURL(/[?&]status=/, { timeout: 5000 })
    await expect(page.getByText(/hiding completed and closed/i)).not.toBeVisible()
  })

  test('Clear all wipes filters and the hint reappears', async ({ page }) => {
    // Apply two chips
    await page.getByRole('button', { name: /add filter/i }).click()
    await page.getByRole('button', { name: /^Vote count$/i }).click()
    await page.getByRole('button', { name: /5\+ votes/i }).click()

    await page.getByRole('button', { name: /add filter/i }).click()
    await page.getByRole('button', { name: /^Created date$/i }).click()
    await page.getByRole('button', { name: /last 7 days/i }).click()

    // Clear all
    await page.getByRole('button', { name: /clear all/i }).click()

    await expect(page).not.toHaveURL(/minVotes/)
    await expect(page).not.toHaveURL(/dateFrom/)
    await expect(page.getByText(/hiding completed and closed/i)).toBeVisible()
  })
})
```

- [ ] **Step 2: Run the e2e**

```bash
cd /home/james/quackback && bun run --cwd apps/web test:e2e -- e2e/tests/public/post-list-filters.spec.ts
```

Expected: all 5 tests pass. If a test is flaky on the "first status" selector, use `page.getByRole('button', { name: 'Open' })` (assumes seed has an `Open` status — verify via `bun run db:seed` output if unsure).

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/tests/public/post-list-filters.spec.ts
git commit -m "test(e2e): cover public portal chip filter flow + active-by-default hint"
```

---

## Task 10: Final verification

- [ ] **Step 1: Run the full test suite**

```bash
cd /home/james/quackback && bun run test
cd /home/james/quackback && bun run --cwd apps/web typecheck
cd /home/james/quackback && bun run lint
```

Expected: no new failures.

- [ ] **Step 2: Manual smoke in dev**

```bash
cd /home/james/quackback && bun run dev
```

Visit `http://localhost:3000/`. Verify:

1. Default load shows only `Active`-category posts (no Closed/Complete).
2. The hint _"Hiding completed and closed posts. Show all"_ is visible.
3. Clicking `Show all` adds all status slugs to the URL and reveals everything; hint disappears.
4. `+ Add filter` opens a menu with 5 items in order: Status / Tag / Vote count / Created date / Team response.
5. Status submenu groups statuses under `Active` / `Complete` / `Closed` headings.
6. Tag/votes/date/response submenus all work and create the right chip.
7. Selecting 3+ tags collapses to one combined chip.
8. `Clear all` appears with 2+ chips and wipes all filter chips on click.
9. Mobile viewport: chips wrap correctly; nothing overflows horizontally.
10. Browser back/forward navigation preserves filter state (URL params).

- [ ] **Step 3: Final commit (if any pending fixes)**

If any small adjustments are needed from the smoke test:

```bash
git add -A
git commit -m "fix(portal): <specific fix> from smoke-test"
```

---

## Self-review notes

- **Spec coverage:** Each spec section maps to a task — server changes (Task 1, 2), URL/types (Task 3), hook (Task 4), constants (Task 5), component (Task 6), integration (Task 7), i18n (Task 8), e2e (Task 9). ✅
- **Default-active hint:** Task 6 implements it; the `showHidingHint` boolean is gated on `!filters.status?.length` (matches spec's "undefined or empty"). Task 9 covers the e2e behavior.
- **Type consistency:** `PublicFeedbackFilters` shape defined in Task 3 is consumed identically in Tasks 4, 6, 7. `RespondedValue` from constants (Task 5) flows into the chip's `onChange` cast (Task 6). `DatePresetValue` similarly.
- **Active-by-default server interaction:** Task 1 includes a test pinning that the active-category default coexists with `minVotes` (i.e., is gated only on status-absence, not other filters).
- **No placeholders.** All code blocks are concrete; no "fill in details".
