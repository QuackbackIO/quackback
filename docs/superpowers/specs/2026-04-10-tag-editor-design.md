# Tag Editor Settings Page

**Date:** 2026-04-10
**Issue:** QuackbackIO/quackback#130
**Branch:** cleanup/deduplicate-utils-and-integration-components

## Problem

Tags have a complete backend (CRUD service, API endpoints, server functions) but no admin UI for managing them. The `color` field exists in the database but is unused in rendering -- all tag badges use hardcoded theme colors. Users can only manage tags via the API.

## Design

GitHub Labels-style tag editor in Settings > Feedback > Tags. Dialog-based create/edit with live preview, search bar, and infinite scroll.

### Schema Change

Add `description` (nullable text) to the `tags` table:

```sql
ALTER TABLE "tags" ADD COLUMN "description" text;
```

Update `CreateTagInput` and `UpdateTagInput` types to include optional `description` field. Update server functions and API endpoint validation schemas accordingly.

### Tag List Page

New route at `/admin/settings/tags`. Added to settings nav under "Feedback" section (after Statuses).

**Layout:**

- Page header: "Tags" title + subtitle + "New tag" button (top right)
- Search input: filters tags by name server-side (debounced, resets cursor on change)
- Tag count: "N tags" below search
- Tag rows: colored badge (name with tinted background) + description text + three-dot menu
- Infinite scroll: cursor-based pagination, loads next batch on scroll

**Tag row structure:**

- Left: colored badge using `style={{ backgroundColor: color + '20', color: color }}` (hex alpha suffix pattern, matching `user-segments.tsx`)
- Middle: description in muted text, truncated with ellipsis
- Right: `DropdownMenu` with Edit and Delete actions

Clicking anywhere on a row (except the menu) opens the edit dialog.

### Create/Edit Dialog

Shared dialog component for both create and edit. Opens from "New tag" button or row click/menu.

**Fields:**

1. **Live preview** -- colored badge at top of dialog, updates as name/color change
2. **Name** -- required, 1-50 characters, unique across non-deleted tags
3. **Description** -- optional, free text
4. **Color** -- preset grid (same 32 colors from `status-list.tsx` `PRESET_COLORS`) + hex text input + randomize button

**Color picker behavior:**

- Clicking a preset swatch selects it and updates hex input
- Typing a valid hex in the input updates the selected swatch (outline) and preview
- Randomize button generates a random hex color
- Selected swatch shows `outline: 2px solid` indicator (matching status editor `ColorPickerGrid`)

**Validation:**

- Name required, max 50 chars
- Name must be unique (server validates, client shows error)
- Color must be valid hex (`/^#[0-9a-fA-F]{6}$/`)

**Create defaults:** empty name, empty description, random color (generated on dialog open).

**On save:** calls `createTagFn` or `updateTagFn`, invalidates query cache, closes dialog.

### Delete Flow

Three-dot menu > Delete opens `ConfirmDialog`:

- Title: "Delete tag"
- Description: "Are you sure you want to delete '{name}'? This will remove it from all posts."
- Variant: destructive
- On confirm: calls `deleteTagFn`, removes from local state, invalidates queries

### Tag Badge Rendering

Update tag display across the app to use `tag.color` instead of hardcoded theme classes.

**Display contexts (use dynamic color):**

- Post cards (`post-card.tsx`) -- replace `Badge variant="secondary"` with inline-styled badge: `backgroundColor: color + '20'`, `color: color`
- Metadata sidebar read-only tags (`metadata-sidebar.tsx`) -- same pattern
- Metadata sidebar editable tags -- same pattern, replacing `bg-primary/10 text-primary`

**Filter contexts (keep theme colors):**

- Inbox tag filter pills (`inbox-filters.tsx`) -- keep current `bg-foreground`/`bg-muted` toggle pattern for visual consistency with status filters

**Pattern:** `style={{ backgroundColor: tag.color + '20', color: tag.color }}` -- consistent with `user-segments.tsx:30-32`.

### Pagination

Server-side cursor-based pagination for the tag list:

- Add a `listTagsPaginated` function to `tag.service.ts` accepting `cursor`, `limit` (default 20), and `search` parameters
- Cursor uses tag `id` (same pattern as post/changelog pagination)
- Search filters by `name ILIKE %query%`
- Returns `{ items, hasMore }`
- New server function `fetchTagsPaginatedFn` exposed for the settings page

The existing `adminQueries.tags()` (unpaginated) remains for use in filters, dropdowns, and other contexts where the full list is needed.

### Files to Create

| File                                                       | Purpose                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| `apps/web/src/routes/admin/settings.tags.tsx`              | Route with loader, renders TagList                        |
| `apps/web/src/components/admin/settings/tags/tag-list.tsx` | Main list component with search, infinite scroll, dialogs |

### Files to Modify

| File                                                              | Change                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------ |
| `packages/db/src/schema/boards.ts`                                | Add `description` column to tags table                 |
| `packages/db/drizzle/`                                            | New migration for description column                   |
| `apps/web/src/lib/server/domains/tags/tag.types.ts`               | Add description to types                               |
| `apps/web/src/lib/server/domains/tags/tag.service.ts`             | Add description to CRUD, add `listTagsPaginated`       |
| `apps/web/src/lib/server/functions/tags.ts`                       | Update schemas for description, add paginated fetch fn |
| `apps/web/src/routes/api/v1/tags/index.ts`                        | Update create/list API schemas for description         |
| `apps/web/src/routes/api/v1/tags/$tagId.ts`                       | Update get/patch API schemas for description           |
| `apps/web/src/components/admin/settings/settings-nav.tsx`         | Add "Tags" entry under Feedback section                |
| `apps/web/src/components/public/post-card.tsx`                    | Render tag badges with dynamic color                   |
| `apps/web/src/components/public/post-detail/metadata-sidebar.tsx` | Render tag badges with dynamic color                   |

### Not in Scope

- Tag ordering/drag-and-drop (tags are alphabetical)
- Tag descriptions in post cards or filters (only in settings list and edit dialog)
- Bulk tag operations
- Tag merge/rename tracking
