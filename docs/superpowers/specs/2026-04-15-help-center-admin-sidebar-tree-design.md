# Help Center Admin Sidebar Tree — Design

## Goal

Replace the current flat category finder with a persistent sidebar category tree. The tree becomes the canonical navigator for help center hierarchy; the main area becomes article-centric.

## Motivation

The admin area supports 3-level category hierarchies but the current UI does not make the tree visible:

- The root view shows only top-level categories as tiles. A level-3 category requires drilling twice to be seen.
- Inside a category, there are no breadcrumbs and no lateral navigation to siblings.
- The sidebar has a "Jump to" text input — a workaround for the missing tree.
- Root vs inside-category views use different mental models (tiles vs expandable cards).
- `HelpCenterCategoryGroup` renders each sub-category as a collapsible card with its own lazy `useInfiniteQuery`, duplicating what a single tree node can express in one line.

A sidebar tree is the standard primitive for navigating hierarchy in admin tools (Linear, Notion, Intercom). At depth=3 and small N, a tree is compact, scannable, and persistent.

## Non-goals

- Drag-and-drop to move categories (future work; move is handled via the existing category edit dialog's parent picker).
- Multi-select / bulk actions across the tree.
- Virtualized tree rendering — current category counts are small; a plain list is fine.
- Keyboard navigation inside the tree (arrow keys, j/k). Not in scope for v1. Normal tab order only.
- Changes to the public-facing portal help center. This is admin-only.

## Architecture

### Data

Categories are already fetched as a flat array via `helpCenterQueries.categories()` (non-deleted) from `help-center-filters.tsx` and `help-center-finder.tsx`. The tree is derived client-side from that flat list by grouping on `parentId`. No server changes.

Each node already carries `articleCount` (direct only — see `help-center.service.ts` `listCategories`). Parent nodes do NOT aggregate descendant counts; the direct count is what we display.

### Selection state

The currently-selected category lives in the existing URL search param via `useHelpCenterFilters`. The tree reads `filters.category` and reflects it as the highlighted row. Clicking a row calls `setFilters({ category: id })`.

### Expansion state

Expansion is **derived, not stored**. On each render, the tree expands exactly the ancestor chain of `filters.category` (including the selected category itself so its direct children are visible). Categories outside that chain render collapsed.

Users can toggle expansion on any node via the chevron; that adds an override to a local `expandedOverrides: Set<string>` (collapses and expansions both recorded). The override is transient — lives in component state, reset on unmount. Rationale: persistent expansion state is a headache (needs storage, staleness on rename/delete, conflicts with auto-expand); transient state is predictable and matches how file explorers behave when you navigate.

Resolution rule, per category id:

1. If id is in `expandedOverrides`, use that value.
2. Else if id is in the ancestor chain of the selected category, expanded.
3. Else collapsed.

### Delete / restore behavior

When a selected category is deleted, the finder falls back to the category's parent (this already happens in `handleDeleteCategory`). The tree just re-renders — no special handling needed.

When `filters.category` points to a category that no longer exists in the current category list (e.g., deleted, restored elsewhere), the tree silently treats it as root and the main area falls back to the root view. This matches current behavior.

### showDeleted

When `filters.showDeleted` is true, the tree is hidden from the sidebar and the existing `DeletedItemsView` renders in the main area as today. The tree has no awareness of deleted items. This keeps two visual modes instead of merging them.

## Component structure

### New files

- `apps/web/src/components/admin/help-center/help-center-category-tree.tsx`
  The tree itself. Builds the nested structure from the flat `categories` prop, tracks `expandedOverrides`, renders rows, handles the "+ New top-level category" affordance at the bottom.

- `apps/web/src/components/admin/help-center/help-center-category-tree-row.tsx`
  A single row. Props: `category`, `depth`, `isSelected`, `isExpanded`, `hasChildren`, `onToggle`, `onNavigate`, `onAddSub`, `onEdit`, `onDelete`. Renders:
  - Indentation proportional to `depth` (0, 1, 2)
  - Chevron button (only if `hasChildren`) — left of the row
  - Icon + name (truncated with ellipsis) — main click target, calls `onNavigate`
  - Article count — right-aligned, muted
  - Hover-only action cluster (absolutely positioned, appears on row hover): small icon buttons for `+ sub`, edit, delete. Hidden when depth is already 2 for the `+ sub` button (depth cap).

### Modified files

- `apps/web/src/components/admin/help-center/help-center-filters.tsx`
  Remove `Jump to` section and its state/query. Add a `Categories` section rendering `HelpCenterCategoryTree`. Status section stays at top. Deleted items stays at bottom. The category data prop comes from the same `useQuery(helpCenterQueries.categories())` currently used here.

  The component's props change: add `onNavigateCategory`, `onOpenNewCategory`, `onEditCategory`, `onDeleteCategory` callbacks. The parent wires these to the same handlers that `HelpCenterFinder` already uses.

- `apps/web/src/components/admin/help-center/help-center-finder.tsx`
  Significant rewrite of the render block:
  - **Top area** (unchanged structurally): `AdminListHeader` with search, sort pills, and actions. The header actions change — see below.
  - **Breadcrumb row** (new): when a category is selected, render `HelpCenterBreadcrumbs` (existing component) at the top of the main content with the ancestor chain. On root, render nothing.
  - **Sub-category chip row** (new): when a category is selected and has direct children, render a horizontal row of chips for lateral nav. Each chip = sub-category name + article count. Clicking navigates to that sub-category. A trailing "+ New sub-category" chip with dashed border. On root, this row renders the top-level categories as chips too, so root isn't empty of navigation.
  - **Article list** (refined): the current-category card wrapper is removed. Articles render in a plain rounded-xl border card with a thin header ("Articles in X" or "Recent articles" at root) and the existing `HelpCenterListItem` rows inside, same divide styling. Load-more button stays at the bottom inside the same card.
  - **Root article list**: at root, query `articleList({ sort: 'newest' })` with no category filter and no status filter, limit 10 (use existing infinite query but show only first page; hide load-more on root). Heading is "Recent articles".
  - **Kill**: the entire current-category-as-card block, the root-tile block, the `HelpCenterCategoryGroup` rendering for sub-categories. The file shrinks noticeably.

  Header actions simplify:
  - Root: `New article`, `New category`.
  - Inside a category: `New article`, plus the existing `CategoryActionsDropdown` (edit/delete) — these move into the tree row hover actions as well but stay in the header as the large-target version. Keep both; tree hover actions are fast-access, header button is the big obvious one for first-time users.

- `apps/web/src/components/admin/help-center/help-center-list.tsx`
  This is the sidebar-layout parent. Its children props for the sidebar change to pass the new category-action callbacks into `HelpCenterFiltersPanel`. Needs verification during implementation — may be straightforward.

### Files to delete

- `apps/web/src/components/admin/help-center/help-center-category-group.tsx`
  No longer referenced after the finder rewrite. Delete the file.

- Any test file for `HelpCenterCategoryGroup`. Remove.

## Visual sketch

```
┌──────────────────┬─────────────────────────────────────────┐
│ Status           │ Help Center / Product / Billing    ⋯    │
│ ○ All            │ ─────────────────────────────────────── │
│ ○ Draft          │ Search in Billing…    Newest ▾  Actions │
│ ● Published      │ ─────────────────────────────────────── │
│                  │ [Refunds 9] [Invoices 6] [+ New sub]    │
│ Categories       │                                         │
│ ▾ Product    24  │ ┌─ Articles in Billing ────────────── ┐ │
│   ▾ Billing 18   │ │ • Payment methods            18  ⋯  │ │
│     ● Refunds 9  │ │ • Failed charges              3  ⋯  │ │
│     ○ Invoices 6 │ │ • Recurring vs one-off        1  ⋯  │ │
│   ▸ Onboarding 6 │ └──────────────────────────────────────┘│
│ ▸ Account    11  │                                         │
│ ▸ API          7 │                                         │
│                  │                                         │
│ ─────────────    │                                         │
│ Deleted items    │                                         │
└──────────────────┴─────────────────────────────────────────┘
```

Row states:

- `●` filled dot on the left margin indicates the currently-selected category (or highlight the row background instead — see Styling below).
- `▾` expanded, `▸` collapsed. Chevron is the toggle; row body is the navigate click.
- Indentation: 12px per level. Max depth 3 → max indent 24px.
- Hover reveals a 3-icon cluster on the right (before the count): `+`, pencil, trash.

Root view (no category selected):

```
┌──────────────────┬─────────────────────────────────────────┐
│ ...              │ Help Center                         ⋯   │
│ Categories       │ ─────────────────────────────────────── │
│ ▸ Product    24  │ Search all articles…  Newest ▾  Actions │
│ ▸ Account    11  │ ─────────────────────────────────────── │
│ ▸ API          7 │ [Product 24] [Account 11] [API 7] [+]   │
│                  │                                         │
│                  │ ┌─ Recent articles ─────────────────── ┐│
│                  │ │ • Getting started           2h · ⋯   ││
│                  │ │ • API rate limits           1d · ⋯   ││
│                  │ │ …                                    ││
│                  │ └──────────────────────────────────────┘│
└──────────────────┴─────────────────────────────────────────┘
```

## Styling

- Tree rows: `h-7` (~28px), `text-xs`, `rounded-md` on hover.
- Selected row: `bg-muted text-foreground font-medium`. Non-selected: `text-muted-foreground hover:text-foreground hover:bg-muted/50`. Same tokens as the existing status filter list.
- Chevron: `h-3.5 w-3.5`, rotates 90° on expand.
- Article count: `text-[10px] text-muted-foreground tabular-nums`.
- Hover actions: each is `h-5 w-5` icon button, `text-muted-foreground hover:text-foreground`. Cluster is absolutely positioned on the right, fading in on row hover. To avoid overlap with the article count, the count is hidden (or nudged) while hover actions are visible.
- Indentation via left padding, not CSS indent. First-level rows at `pl-2`, deeper levels add `pl-3` per depth.

## Interaction details

- **Clicking a row body** → navigate into that category (sets `filters.category`).
- **Clicking the chevron** → toggles `expandedOverrides[id]`. Does NOT navigate.
- **Hover `+ sub`** → opens the category form dialog with `defaultParentId` set to that row's id. Button hidden when the row is at depth 2 (depth cap 3, enforced server-side; button just hides to avoid a confusing error path).
- **Hover edit** → opens the category form dialog pre-filled for that row.
- **Hover delete** → opens the existing confirm dialog, wired to `useDeleteCategory`, same cascade impact calculation that already exists in the finder. Needs to work for any row, not just the currently-selected category — generalize `cascadeImpact` to accept a category id parameter.
- **Sub-category chips in main area**: clicking navigates into that sub-category (same as clicking a tree row). Purely lateral; chevron/expand is irrelevant here.
- **"+ New sub-category" chip** (only inside a category): opens category form dialog with parent = current category.
- **"+ New top-level category" at the root chip row**: opens dialog with no parent.
- **Search input** remains global to the current category context (if one is selected) or all articles (if root). No change to search scoping.

## Data flow

```
helpCenterQueries.categories()
      │
      ▼
  HelpCenterList (sidebar layout parent)
      │
      ├─▶ HelpCenterFiltersPanel (sidebar)
      │       └─▶ HelpCenterCategoryTree
      │               └─▶ HelpCenterCategoryTreeRow × N
      │
      └─▶ HelpCenterFinder (main)
              ├─ breadcrumbs (from ancestor chain)
              ├─ sub-category chip row
              └─ article list
```

Both sidebar and main consume the same categories query and the same filters store. Tree row click and chip click both call `setFilters({ category })` — they're two views of the same state.

## Breadcrumbs

Use the existing `HelpCenterBreadcrumbs` component with a new builder that returns an ancestor chain where the last crumb is not a link. The existing `buildAdminCategoryBreadcrumbs` in `help-center-utils-admin.ts` already does this — bring it back into use (it was recently orphaned) and render the result at the top of the main content when `filters.category` is set. Drop the first empty `"Help Center"` root crumb or keep it as a click-to-root — whichever the existing component renders naturally.

## Empty / edge states

- **No categories exist**: sidebar tree renders only the "+ New top-level category" button. Main area renders the existing "No help categories yet" empty state.
- **Selected category has no direct children**: sub-category chip row renders only the "+ New sub-category" chip. No orphan spacing above the article list.
- **Selected category has no articles**: existing empty state inside the article card.
- **Current category is deleted out-of-band** (another tab / stale URL): fall back to root silently. No error toast.

## Accessibility

- Tree uses `role="tree"` on the container, `role="treeitem"` on rows, with `aria-level`, `aria-expanded` (when has children), and `aria-selected` (on the currently-filtered row).
- Keyboard: tab order includes each row body and each chevron. Arrow-key navigation is out of scope for v1.
- Hover actions are also focusable via tab (not hidden from AT). Revealing them on hover is a visual-only optimization; keyboard users see them focused in-line.

## Testing strategy

This is primarily a UI refactor with client-side derivation. Tests focus on the tree logic and the finder's content-switching behavior:

- **Unit test `help-center-category-tree.tsx`** (or a pure helper extracted from it): given a flat list + selected id, the ancestor chain resolution and the derived expanded set are correct.
- **Integration-level render test of the tree row**: hover actions reveal, click behaviors fire the right callbacks, depth indentation.
- **Finder integration test**: with `filters.category` set, the finder renders breadcrumbs + sub-category chips + article list; at root, it renders recent articles. The current category card and sub-category groups are gone.
- **Delete path**: deleting a non-selected category via tree hover action does not change `filters.category`; deleting the selected category falls back to its parent.

Test framework: existing vitest + React Testing Library setup used elsewhere in the admin components.

## Migration / rollout

No feature flag. This replaces the existing admin help center root UI in-place. The `helpCenter` feature flag at the route level still gates the whole area.

No backend changes, no schema changes, no migrations.

## Out of scope (deferred)

- Drag-and-drop reordering / reparenting in the tree.
- Persisted expansion state.
- Keyboard tree navigation.
- A "move article to category" UI. Today, article category is changed via the editor's category pill; still the case after this change.
- "Recent articles" pagination on root. Just the first page.
- Mobile-specific tree behavior (sidebar is already hidden on narrow viewports via the existing layout).

## Open questions

None. All four decisions confirmed inline (tree only, hover row actions, root = recent articles, kill `HelpCenterCategoryGroup`).
