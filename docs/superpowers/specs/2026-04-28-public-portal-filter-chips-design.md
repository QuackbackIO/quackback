# Public Portal Filter Chips — Design

**Date:** 2026-04-28
**Status:** Approved by user, ready for implementation plan

## Goals

1. Replace the public portal's single popover `Filter` button with the chip-based filter pattern already used in the admin inbox: an inline row of active filter chips followed by a `+ Add filter` button that opens a category menu and submenus.
2. By default, hide posts in `Complete` and `Closed` status categories so they don't pile up on the public board. Server-side default already implemented in `post.public.ts`; this spec covers the corresponding UI.

## Non-goals

- Roadmap page filters (separate filter system, out of scope).
- Admin filter changes — admin's `ActiveFiltersBar` stays as-is.
- Comment count, Board, Segment, Assigned to, or Has duplicates filters on the public side (deliberately excluded — admin-only or low-value publicly).

## Filter set

Five chip categories (in this order in the `+ Add filter` popover):

| Category      | Submenu                                                                                                                             | Selection mode                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Status        | All statuses, grouped under `Active` / `Complete` / `Closed` headings (matches settings page); each row shows the status color dot. | Multi-select (one chip per selected status)                                  |
| Tag           | All public tags.                                                                                                                    | Multi-select; 1–2 → individual chips, 3+ → one combined chip `Tags: A, B +N` |
| Vote count    | Presets: `5+`, `10+`, `25+`, `50+`, `100+`.                                                                                         | Single-select                                                                |
| Created date  | Presets: `Today`, `Last 7 days`, `Last 30 days`, `Last 90 days`.                                                                    | Single-select                                                                |
| Team response | `Has team response`, `Awaiting team response`.                                                                                      | Single-select                                                                |

Search and Sort remain as separate toolbar controls (unchanged).

## UX details

### Layout

- Existing toolbar becomes Sort | (right) Search. The dedicated `Filter` button is removed.
- A new chip row is rendered directly below the toolbar inside `feedback-container.tsx`, containing: active chips → `+ Add filter` (small dashed button) → `Clear all` (only when 2+ chips active).

### Default-active-status hint

- When `filters.status` is undefined or empty, render a one-line hint above/within the chip row:
  > _"Hiding completed and closed posts."_ `[Show all]`
- Clicking `Show all` sets `filters.status` to all known status slugs (which short-circuits the server's `category = 'active'` default and reveals everything).
- The hint disappears as soon as `filters.status` has any entries, even if those entries happen to all be `Active`-category statuses — once the user has touched the status filter, the hint becomes patronizing.
- Localized via new message IDs `portal.feedback.filter.hidingCompleted` / `portal.feedback.filter.showAll`.

### Chip rendering rules

Mirror admin's `computeActiveFilters` logic but typed against `PublicFeedbackFilters`:

- Status: one chip per selected slug, label `Status:`, color dot from `PostStatusEntity.color`. Dropdown lets the user swap to any other status.
- Tag: 1–2 → individual chips with dropdown. 3+ → one combined chip without dropdown, X clears all tags.
- Vote count / Created date / Team response: single chip each, dropdown swaps the preset, X clears.

### Clear all

- Visible when `activeFilterCount >= 2`.
- Clears `status`, `tagIds`, `minVotes`, `dateFrom`, `responded`. Leaves `search`, `sort`, `board` alone.

## Architecture

### New files

- `apps/web/src/components/public/feedback/public-filters-bar.tsx` — chip row + `+ Add filter` popover. Mirrors `admin/feedback/active-filters-bar.tsx` but typed against `PublicFeedbackFilters` and uses `react-intl` (`FormattedMessage` / `useIntl`) for all visible strings.
- `apps/web/src/components/public/feedback/public-filters-bar-defaults.ts` — `VOTE_THRESHOLDS`, `DATE_PRESETS`, etc.

### Modified files

- `apps/web/src/components/public/feedback/feedback-toolbar.tsx` — drop the `Filter` button and its props (`statuses`, `tags`, `selectedStatuses`, `selectedTagIds`, `onStatusChange`, `onTagChange`, `onClearFilters`, `activeFilterCount`).
- `apps/web/src/components/public/feedback/feedback-container.tsx` — render `<PublicFiltersBar>` below the toolbar; update `mergedFilters` and the `filterKey` for animations to include `minVotes`, `dateFrom`, `responded`.
- `apps/web/src/components/public/feedback/use-public-filters.ts` — extend `filters` derivation, `setFilters` URL writer, navigation-completed comparison, `activeFilterCount`, and `clearFilters` to handle the three new fields.
- `apps/web/src/routes/_portal/index.tsx` — extend `searchSchema`; pass new fields into the loader's `portalQueries.portalData(...)` call and the page-level `useQuery`.
- `apps/web/src/lib/shared/types/filters.ts` — extend `PublicFeedbackFilters` with `minVotes?`, `dateFrom?`, `responded?`.
- `apps/web/src/lib/client/queries/portal.ts` — extend the params type for `portalQueries.portalData(...)` so the new fields participate in the cache key.
- `apps/web/src/lib/server/functions/portal.ts` — extend `fetchPortalDataSchema` and pass the new fields into `listPublicPostsWithVotesAndAvatars(...)`.
- `apps/web/src/lib/server/domains/posts/post.public.ts` — extend `PostListParams` and `buildPostFilterConditions` (see Server section).

### Deleted

- `apps/web/src/components/public/feedback/filter-dropdown.tsx` — replaced.
- Stale i18n message IDs: `portal.feedback.toolbar.filter`, `portal.feedback.filter.title`, `portal.feedback.filter.clearAll`, `portal.feedback.filter.statusLabel`, `portal.feedback.filter.tagsLabel`, `portal.feedback.filter.noFilters`.

## Server-side changes (`post.public.ts`)

### `PostListParams` additions

```ts
minVotes?: number
dateFrom?: string                  // ISO date (YYYY-MM-DD)
responded?: 'responded' | 'unresponded'
```

### `buildPostFilterConditions` additions

After the existing `search` clause:

```ts
if (typeof minVotes === 'number' && minVotes > 0) {
  conditions.push(gte(posts.voteCount, minVotes))
}
if (dateFrom) {
  conditions.push(gte(posts.createdAt, new Date(dateFrom)))
}
if (responded === 'responded') {
  conditions.push(
    sql`EXISTS (SELECT 1 FROM comments WHERE comments.post_id = ${posts.id} AND comments.is_team_member = true AND comments.deleted_at IS NULL)`
  )
} else if (responded === 'unresponded') {
  conditions.push(
    sql`NOT EXISTS (SELECT 1 FROM comments WHERE comments.post_id = ${posts.id} AND comments.is_team_member = true AND comments.deleted_at IS NULL)`
  )
}
```

Pull `gte` into the `@/lib/server/db` imports. The `responded` SQL uses raw column names (`comments.post_id`, etc.) for the Drizzle relational-builder reason documented in `post.inbox.ts:138-142`.

### Default-active-status interaction

The active-category default block must remain gated **only** on `statusSlugs`/`statusIds` being absent — not on the new filters. So `?minVotes=10` alone still hides completed/closed posts. A test pins this.

### `fetchPortalDataSchema` (in `portal.ts`) additions

```ts
minVotes: z.number().int().min(1).optional(),
dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
responded: z.enum(['responded', 'unresponded']).optional(),
```

## URL / route schema (`routes/_portal/index.tsx`)

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

`z.coerce.number()` on `minVotes` because URL params are strings.

## Testing

### Server (`__tests__/post-public.test.ts`)

Extend the existing test file with cases for:

- `minVotes` produces `gte(posts.voteCount, n)`.
- `dateFrom` produces `gte(posts.createdAt, …)`.
- `responded='responded'` adds an `EXISTS` SQL on `comments.is_team_member`.
- `responded='unresponded'` adds the `NOT EXISTS` variant.
- Default-active-status block coexists with `minVotes` (gated only on status-absence).

### Client

- `apps/web/src/components/public/feedback/__tests__/public-filters-bar.test.tsx` — chip rendering for each filter type; `+ Add filter` menu opens; submenu picks call `setFilters` with the right shape; X removes; `Clear all` appears with ≥2 chips.
- `apps/web/src/components/public/feedback/__tests__/use-public-filters.test.ts` — `activeFilterCount` includes new fields; `clearFilters` clears them.

### E2E (Playwright)

One new spec under existing public portal e2e folder:

- Default load hides Complete/Closed posts (seed has at least one).
- Adding `Status: Closed` chip reveals it.
- Adding `Vote count: 5+` filters posts.
- `Clear all` wipes filters; hint reappears.

## Localization

New message IDs (defaults shown):

- `portal.feedback.filter.addFilter` — "Add filter"
- `portal.feedback.filter.clearAll` — "Clear all"
- `portal.feedback.filter.back` — "Back"
- `portal.feedback.filter.hidingCompleted` — "Hiding completed and closed posts."
- `portal.feedback.filter.showAll` — "Show all"
- `portal.feedback.filter.category.status` — "Status"
- `portal.feedback.filter.category.tag` — "Tag"
- `portal.feedback.filter.category.votes` — "Vote count"
- `portal.feedback.filter.category.date` — "Created date"
- `portal.feedback.filter.category.response` — "Team response"
- `portal.feedback.filter.statusGroup.active` / `.complete` / `.closed`
- `portal.feedback.filter.responded.has` — "Has team response"
- `portal.feedback.filter.responded.awaiting` — "Awaiting team response"
- Vote/date preset labels (existing patterns)

Stale IDs from the deleted `filter-dropdown.tsx` should be removed from locale files.

## Open questions / risks

- **Performance:** `EXISTS` subquery on `comments` runs per row. The admin already uses this pattern, so we're matching prior art. If this shows up in slow-query logs, add a partial index on `comments(post_id) WHERE is_team_member = true AND deleted_at IS NULL` later — out of scope here.
- **`Show all` semantics:** Setting `filters.status` to every known slug is functionally equivalent to "no status filter" for the user, but reads as "all statuses selected" in the URL. Acceptable trade-off — the alternative is a separate `showAllStatuses` boolean which leaks UI state into the data layer.
- **Mobile chip wrapping:** Admin's `flex-wrap` already proves this works. No new layout work expected.
