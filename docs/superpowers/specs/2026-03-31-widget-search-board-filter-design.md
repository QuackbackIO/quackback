# Widget Search + Board Filter Design

**Date:** 2026-03-31
**Branch:** feat/trigger-as-toggle
**Scope:** `apps/web/src/components/widget/widget-home.tsx`

## Goal

Add a compact search input and horizontal board filter pills below the "Popular ideas" heading, letting users quickly find specific posts or narrow the list to a board — without leaving the widget or adding sort complexity.

## Layout

```
[ Popular ideas          ]   ← existing heading (line 579)
[ 🔍 Search ideas...    ]   ← NEW: full-width search input
[ All · Orders · Billing ]  ← NEW: board pills (only if 2+ boards)
─────────────────────────
  post list (infinite scroll or search results)
```

Both controls live in a `px-3 flex flex-col gap-2` wrapper inserted directly below the heading. The post list renders conditionally based on active state.

## Search Input

- Full-width, `h-8`, `text-xs`, `bg-muted/50 border border-border/40 rounded-md`
- Leading `MagnifyingGlassIcon` (`w-3.5 h-3.5 text-muted-foreground/60`)
- Placeholder: `"Search ideas..."`
- Trailing clear button (`XMarkIcon`, `w-3 h-3`) visible only when query is non-empty
- 300ms debounce before firing a fetch
- Controlled by new state: `popularSearch: string` (empty string = inactive)

This is **separate** from the existing `searchResults` state, which drives the "similar ideas" feature during post creation. The two searches are independent.

## Board Pills

- Rendered only when `boards.length >= 2`
- Horizontal row: `flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5`
- First pill always "All" (`activeBoardSlug === null`)
- One pill per board in `boards` prop order
- Pill styles:
  - Base: `rounded-full text-xs px-2.5 py-1 whitespace-nowrap transition-colors`
  - Active: `bg-primary text-primary-foreground`
  - Inactive: `bg-muted/50 text-muted-foreground hover:bg-muted`
- Controlled by new state: `activeBoardSlug: string | null` (null = All)

## Data Flow

### Popular Ideas list (when search is empty)

The existing `useInfiniteQuery` gains `boardSlug` as a dynamic param:

```ts
// Query key includes activeBoardSlug so React Query refetches on board change
queryKey: ['widget', 'posts', 'popular', 'top', activeBoardSlug ?? 'all']

// Query function passes boardSlug
queryFn: ({ pageParam }) =>
  listPublicPostsFn({
    data: { sort: 'top', page: pageParam, limit: 20, boardSlug: activeBoardSlug ?? undefined },
  })
```

`initialData` is only used when `activeBoardSlug` is null (the initial unfiltered load). When a board is selected, the query fetches fresh.

### Search results (when search is non-empty)

A separate `useQuery` (not infinite — search results are a flat list, not paginated):

```ts
queryKey: ['widget', 'search', 'popular', debouncedPopularSearch, activeBoardSlug ?? 'all']
queryFn: () =>
  fetch(
    `/api/widget/search?q=${encodeURIComponent(debouncedPopularSearch)}&board=${activeBoardSlug ?? ''}&limit=20`
  )
enabled: debouncedPopularSearch.length > 0
```

The `/api/widget/search` route already accepts `board` (boardSlug) — no backend changes needed.

### Composition rule

- `popularSearch` non-empty → show search results (scoped to `activeBoardSlug` if set)
- `popularSearch` empty → show infinite list (filtered by `activeBoardSlug`)
- Both controls are always visible and interactive simultaneously

## Empty States

- Search active, no results: `"No ideas match your search"` centred in muted text, same padding as post list
- Board selected, no posts: `"No ideas in this board yet"` — same treatment
- Loading: existing spinner pattern already used in the component

## What Changes

### `widget-home.tsx` only — no backend changes

1. Add state: `popularSearch` (string), `activeBoardSlug` (string | null)
2. Add `useDeferredValue` or `useState` with 300ms debounce for `debouncedPopularSearch`
3. Update `useInfiniteQuery` — add `activeBoardSlug` to query key + fn
4. Remove `initialData` when a board filter is active (pass `undefined`)
5. Add `useQuery` for search results
6. Insert search input + board pills UI between heading and list
7. Conditionally render search results vs infinite list based on `debouncedPopularSearch`

## Out of Scope

- Sort controls (top/new/trending) — not added
- Tag or status filters in the Popular Ideas section
- Any changes to the post-creation "similar ideas" search
- Mobile-specific changes (widget is already 400px)
- Backend changes (all params already supported)
