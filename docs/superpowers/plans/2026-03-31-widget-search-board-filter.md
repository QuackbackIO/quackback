# Widget Search + Board Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact search input and horizontal board filter pills to the widget's Popular Ideas section, letting users find posts by text or narrow to a board.

**Architecture:** All changes are in `widget-home.tsx`. Board filter extends the existing `useInfiniteQuery` with a `boardSlug` param and dynamic query key. Popular search adds a separate debounced `useQuery` that calls the existing `/api/widget/search` endpoint; the Popular Ideas list renders either the search results or the infinite list depending on whether a search query is active. No backend changes needed — `listPublicPostsFn` already accepts `boardSlug` + `search`, and the search API already accepts a `board` param.

**Tech Stack:** React, TanStack Query (`useInfiniteQuery`, `useQuery`), Heroicons, TanStack Start

---

### Task 0: Rename existing similar-ideas search variables for clarity

The existing search state (`searchResults`, `isSearching`, `debounceRef`, `searchCache`) is for the "similar ideas" feature shown while the user drafts a new post. These names have no context prefix, which will become confusing once popular-ideas search state is added alongside them. Rename them before adding anything new.

**Files:**

- Modify: `apps/web/src/components/widget/widget-home.tsx`

- [ ] **Step 1: Rename all four identifiers throughout the file**

Run these four find-and-replace operations (exact string, case-sensitive, scoped to `widget-home.tsx`):

| Old name        | New name             |
| --------------- | -------------------- |
| `searchCache`   | `similarSearchCache` |
| `searchResults` | `similarPostResults` |
| `isSearching`   | `isSimilarSearching` |
| `debounceRef`   | `similarDebounceRef` |

Every occurrence in the file must be updated — declarations, reads, and writes. There are no other files that reference these variables (they are component-local state and a module-level `Map`).

- [ ] **Step 2: Typecheck**

```bash
cd apps/web && bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/widget/widget-home.tsx
git commit -m "refactor(widget): rename similar-ideas search vars for clarity"
```

---

### Task 1: Board filter — state, query update, pills UI

Adds `activeBoardSlug` state, wires it into the infinite query, and renders horizontal board pills below the "Popular ideas" heading.

**Files:**

- Modify: `apps/web/src/components/widget/widget-home.tsx`

- [ ] **Step 1: Add `activeBoardSlug` state**

Find the state block (around line 168) and add the new state after `isSearching`:

```ts
// Before (around line 178, after Task 0 renames):
const [isSimilarSearching, setIsSimilarSearching] = useState(false)
const similarDebounceRef = useRef<ReturnType<typeof setTimeout>>(null)

// After:
const [isSimilarSearching, setIsSimilarSearching] = useState(false)
const similarDebounceRef = useRef<ReturnType<typeof setTimeout>>(null)
const [activeBoardSlug, setActiveBoardSlug] = useState<string | null>(null)
```

- [ ] **Step 2: Update `useInfiniteQuery` to respect `activeBoardSlug`**

Find the `useInfiniteQuery` call (around line 189) and replace it:

```ts
// Before:
const {
  data: postsData,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
} = useInfiniteQuery({
  queryKey: ['widget', 'posts', 'popular', 'top'],
  queryFn: ({ pageParam }) =>
    listPublicPostsFn({ data: { sort: 'top', page: pageParam, limit: 20 } }),
  initialPageParam: 1,
  getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length + 1 : undefined),
  initialData: {
    pages: [{ items: initialPosts, total: -1, hasMore: initialHasMore }],
    pageParams: [1],
  },
})

// After:
const {
  data: postsData,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
} = useInfiniteQuery({
  queryKey: ['widget', 'posts', 'popular', 'top', activeBoardSlug ?? 'all'],
  queryFn: ({ pageParam }) =>
    listPublicPostsFn({
      data: {
        sort: 'top',
        page: pageParam,
        limit: 20,
        boardSlug: activeBoardSlug ?? undefined,
      },
    }),
  initialPageParam: 1,
  getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length + 1 : undefined),
  // Only seed from SSR data on the initial unfiltered view
  initialData:
    activeBoardSlug === null
      ? {
          pages: [{ items: initialPosts, total: -1, hasMore: initialHasMore }],
          pageParams: [1],
        }
      : undefined,
})
```

- [ ] **Step 3: Insert board pills between heading and post list**

Find the Popular ideas section (around line 577):

```tsx
{/* Popular ideas — unaffected by search */}
<div className="mt-2">
  <p className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide px-1 py-1.5">
    Popular ideas
  </p>
```

Replace with:

```tsx
{/* Popular ideas */}
<div className="mt-2">
  <p className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide px-1 py-1.5">
    Popular ideas
  </p>

  {/* Board filter pills — only when 2+ boards exist */}
  {boards.length >= 2 && (
    <div className="flex gap-1.5 overflow-x-auto scrollbar-none px-1 pb-2">
      <button
        type="button"
        onClick={() => setActiveBoardSlug(null)}
        className={`rounded-full text-xs px-2.5 py-1 whitespace-nowrap transition-colors shrink-0 ${
          activeBoardSlug === null
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted/50 text-muted-foreground hover:bg-muted'
        }`}
      >
        All
      </button>
      {boards.map((board) => (
        <button
          key={board.id}
          type="button"
          onClick={() => setActiveBoardSlug(board.slug)}
          className={`rounded-full text-xs px-2.5 py-1 whitespace-nowrap transition-colors shrink-0 ${
            activeBoardSlug === board.slug
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted/50 text-muted-foreground hover:bg-muted'
          }`}
        >
          {board.name}
        </button>
      ))}
    </div>
  )}
```

- [ ] **Step 4: Typecheck**

```bash
cd apps/web && bun run typecheck
```

Expected: no errors.

- [ ] **Step 5: Manual verification**

Run `bun run dev`. Open the widget. Confirm:

- With 2+ boards: pills appear below "Popular ideas" — "All" is active by default
- Clicking a board pill filters the list to that board's posts
- Clicking "All" restores the full list
- With only 1 board: no pills rendered

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/widget/widget-home.tsx
git commit -m "feat(widget): board filter pills on popular ideas"
```

---

### Task 2: Popular ideas search — input, debounce, query, conditional list

Adds a search input above the board pills (or above the list if no pills) and conditionally renders search results instead of the infinite list when a query is active.

**Files:**

- Modify: `apps/web/src/components/widget/widget-home.tsx`

- [ ] **Step 1: Add new imports**

Update the import lines at the top of the file:

```ts
// Add useQuery to the react-query import (line 5):
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

// Add MagnifyingGlassIcon and XMarkIcon to heroicons (line 3 area):
// The file currently has:
import { Squares2X2Icon, PencilIcon } from '@heroicons/react/24/solid'
import { LightBulbIcon } from '@heroicons/react/24/outline'
// Change to:
import { Squares2X2Icon, PencilIcon } from '@heroicons/react/24/solid'
import { LightBulbIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline'
```

- [ ] **Step 2: Add popular search state and debounce ref**

In the state block (right after the `activeBoardSlug` line added in Task 1):

```ts
const [activeBoardSlug, setActiveBoardSlug] = useState<string | null>(null)
const [popularSearch, setPopularSearch] = useState('')
const [debouncedPopularSearch, setDebouncedPopularSearch] = useState('')
const popularSearchDebounceRef = useRef<ReturnType<typeof setTimeout>>(null)
```

- [ ] **Step 3: Add debounce effect for popular search**

Add this `useEffect` right after the existing `debounceRef` effect (which handles the post-creation similar-ideas search, ending around line 270). Place it after that block:

```ts
// Debounce popular ideas search
useEffect(() => {
  if (popularSearchDebounceRef.current) clearTimeout(popularSearchDebounceRef.current)
  popularSearchDebounceRef.current = setTimeout(() => {
    setDebouncedPopularSearch(popularSearch)
  }, 300)
  return () => {
    if (popularSearchDebounceRef.current) clearTimeout(popularSearchDebounceRef.current)
  }
}, [popularSearch])
```

- [ ] **Step 4: Add popular search query**

Add this `useQuery` right after the `useInfiniteQuery` block (after the `postsSentinelRef` line):

```ts
// Search query for popular ideas — replaces infinite list when active
const { data: popularSearchData, isFetching: isPopularSearchFetching } = useQuery({
  queryKey: ['widget', 'search', 'popular', debouncedPopularSearch, activeBoardSlug ?? 'all'],
  queryFn: async () => {
    const params = new URLSearchParams({ q: debouncedPopularSearch, limit: '20' })
    if (activeBoardSlug) params.set('board', activeBoardSlug)
    const res = await fetch(`/api/widget/search?${params}`)
    const json = await res.json()
    return { posts: (json.data?.posts ?? []) as WidgetPost[] }
  },
  enabled: debouncedPopularSearch.length > 0,
})
```

- [ ] **Step 5: Add search input UI above board pills**

In the Popular ideas section (Task 1 added the board pills block). Insert the search input **between** the "Popular ideas" heading `<p>` and the board pills `{boards.length >= 2 && ...}` block:

```tsx
{
  /* Search input */
}
;<div className="flex items-center gap-1.5 h-8 px-2.5 mx-1 mb-2 bg-muted/50 border border-border/40 rounded-md">
  <MagnifyingGlassIcon className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
  <input
    type="text"
    value={popularSearch}
    onChange={(e) => setPopularSearch(e.target.value)}
    placeholder="Search ideas..."
    className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/50 outline-none"
  />
  {popularSearch && (
    <button
      type="button"
      onClick={() => setPopularSearch('')}
      className="shrink-0 text-muted-foreground/60 hover:text-foreground transition-colors"
    >
      <XMarkIcon className="w-3 h-3" />
    </button>
  )}
</div>
```

- [ ] **Step 6: Replace post list with conditional search/infinite rendering**

Find the existing post list block (after the board pills, currently lines 583–615):

```tsx
{
  allPopularPosts.length === 0 && (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <LightBulbIcon className="w-8 h-8 text-muted-foreground/30 mb-2" />
      <p className="text-sm font-medium text-muted-foreground/70">No ideas yet</p>
      <p className="text-xs text-muted-foreground/50 mt-0.5">Be the first to share one!</p>
    </div>
  )
}

{
  allPopularPosts.length > 0 && (
    <div className="space-y-0.5">
      {allPopularPosts.map((post) => (
        <WidgetPostRow
          key={post.id}
          post={post}
          statusMap={statusMap}
          showBoard
          canVote={canVote}
          ensureSessionThen={ensureSessionThen}
          onAuthRequired={() => handleAuthRequired(post.id)}
          onSelect={() => onPostSelect?.(post.id)}
        />
      ))}
      {hasNextPage && (
        <div ref={postsSentinelRef} className="flex justify-center py-2">
          {isFetchingNextPage && (
            <span className="text-[10px] text-muted-foreground/50">Loading...</span>
          )}
        </div>
      )}
    </div>
  )
}
```

Replace with:

```tsx
{
  /* Search results mode */
}
{
  debouncedPopularSearch.length > 0 && (
    <>
      {isPopularSearchFetching && (
        <div className="flex justify-center py-4">
          <span className="text-[10px] text-muted-foreground/50">Searching...</span>
        </div>
      )}
      {!isPopularSearchFetching && (popularSearchData?.posts.length ?? 0) === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <MagnifyingGlassIcon className="w-8 h-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm font-medium text-muted-foreground/70">No ideas found</p>
          <p className="text-xs text-muted-foreground/50 mt-0.5">Try a different search term</p>
        </div>
      )}
      {!isPopularSearchFetching && (popularSearchData?.posts.length ?? 0) > 0 && (
        <div className="space-y-0.5">
          {popularSearchData!.posts.map((post) => (
            <WidgetPostRow
              key={post.id}
              post={post}
              statusMap={statusMap}
              showBoard
              canVote={canVote}
              ensureSessionThen={ensureSessionThen}
              onAuthRequired={() => handleAuthRequired(post.id)}
              onSelect={() => onPostSelect?.(post.id)}
            />
          ))}
        </div>
      )}
    </>
  )
}

{
  /* Infinite list mode (no active search) */
}
{
  debouncedPopularSearch.length === 0 && (
    <>
      {allPopularPosts.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <LightBulbIcon className="w-8 h-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm font-medium text-muted-foreground/70">
            {activeBoardSlug ? 'No ideas in this board yet' : 'No ideas yet'}
          </p>
          {!activeBoardSlug && (
            <p className="text-xs text-muted-foreground/50 mt-0.5">Be the first to share one!</p>
          )}
        </div>
      )}
      {allPopularPosts.length > 0 && (
        <div className="space-y-0.5">
          {allPopularPosts.map((post) => (
            <WidgetPostRow
              key={post.id}
              post={post}
              statusMap={statusMap}
              showBoard
              canVote={canVote}
              ensureSessionThen={ensureSessionThen}
              onAuthRequired={() => handleAuthRequired(post.id)}
              onSelect={() => onPostSelect?.(post.id)}
            />
          ))}
          {hasNextPage && (
            <div ref={postsSentinelRef} className="flex justify-center py-2">
              {isFetchingNextPage && (
                <span className="text-[10px] text-muted-foreground/50">Loading...</span>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 7: Typecheck**

```bash
cd apps/web && bun run typecheck
```

Expected: no errors.

- [ ] **Step 8: Run lint**

```bash
cd ../.. && bun run lint
```

Expected: no errors.

- [ ] **Step 9: Manual verification**

Run `bun run dev`. Open the widget and confirm:

- Search input appears below "Popular ideas", above any board pills
- Typing in the search input debounces 300ms then shows matching results
- Clear button (×) appears when search is non-empty and clears on click
- Search + board filter compose: filtering by board then searching shows results scoped to that board
- Empty search state shows "No ideas found" with magnifying glass icon
- Clearing search restores the infinite list (with board filter still applied)

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/components/widget/widget-home.tsx
git commit -m "feat(widget): search input for popular ideas with board scoping"
```
