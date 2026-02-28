# Navigation Restructure: Feedback Inbox + Ideas & Roadmap

**Date:** 2026-02-26
**Branch:** feat/feedback-aggregation
**Status:** Plan

## Overview

Restructure the admin navigation from the current 4-tab model to a cleaner 2-concept model:

```
CURRENT                              PROPOSED
-------                              --------
Sidebar: Feedback | Roadmap          Sidebar: Feedback | Ideas

Feedback sub-tabs:                   Feedback (unified inbox):
  Inbox (posts)                        All sources in one list
  Insights (ideas/themes)              Posts + Intercom + API items
  Stream (pipeline items)              Source-aware detail views
                                       Pipeline stats bar

Roadmap:                             Ideas sub-tabs:
  Posts kanban                         Ideas (current insights)
  Ideas kanban                         Roadmap (ideas kanban)
```

**Mental model:** Input (Feedback) vs Output (Ideas & Roadmap)

---

## Phase 1: Route & Navigation Changes

### 1a. Update admin sidebar nav items

**File:** `components/admin/admin-sidebar.tsx`

```
BEFORE                                    AFTER
------                                    -----
Feedback  → /admin/feedback               Feedback  → /admin/feedback
Roadmap   → /admin/roadmap                Ideas     → /admin/ideas
Changelog → /admin/changelog              Changelog → /admin/changelog
Users     → /admin/users                  Users     → /admin/users
```

- Change `Roadmap` nav item to `Ideas`
- Change href from `/admin/roadmap` to `/admin/ideas`
- Change icon from `MapIcon` to `LightBulbIcon`

### 1b. Create new route files

**New routes:**

| Route file                | URL                    | Purpose                                   |
| ------------------------- | ---------------------- | ----------------------------------------- |
| `admin/ideas.tsx`         | `/admin/ideas`         | Layout with Ideas/Roadmap toggle + Outlet |
| `admin/ideas.index.tsx`   | `/admin/ideas`         | Ideas list (current insights page)        |
| `admin/ideas.roadmap.tsx` | `/admin/ideas/roadmap` | Roadmap kanban (ideas only)               |

**Routes to modify:**

| Route file                    | Change                                                 |
| ----------------------------- | ------------------------------------------------------ |
| `admin/feedback.tsx`          | Remove FeedbackTabs, keep as layout for inbox + stream |
| `admin/feedback.index.tsx`    | Becomes the unified inbox (posts + stream combined)    |
| `admin/feedback.insights.tsx` | DELETE — moves to `admin/ideas.index.tsx`              |
| `admin/feedback.stream.tsx`   | Keep as sub-route OR merge into feedback.index         |
| `admin/roadmap.tsx`           | DELETE — replaced by `admin/ideas.roadmap.tsx`         |

### 1c. Update feedback layout

**File:** `routes/admin/feedback.tsx`

- Remove `FeedbackTabs` component (no more Inbox/Insights/Stream tabs)
- The feedback route becomes a simple layout wrapper
- Keep PostModal for clicking into post detail
- Add pipeline stats bar (moved from stream)

### 1d. Create ideas layout

**File:** `routes/admin/ideas.tsx`

- Add Ideas/Roadmap toggle (similar to current Posts/Ideas toggle in roadmap)
- Outlet for child routes
- Pre-fetch shared data (boards, etc.)

---

## Phase 2: Unified Feedback Inbox

### 2a. Merge stream items into the inbox

The current inbox only shows board posts. The unified inbox shows ALL feedback:

- Board posts (from `adminQueries.inboxPosts`)
- Pipeline raw items (from `feedbackQueries.rawItems`)

**Approach: Keep them as separate sections, not interleaved**

Rather than merging two very different data shapes into one list (complex, fragile), use a tabbed or segmented approach within the inbox:

```
┌─────────────────────────────────────────────────────────────┐
│ Feedback                                          [search]  │
│ ┌── Pipeline: 142 done · 3 failed [Retry] ──────────────┐  │
│ └────────────────────────────────────────────────────────┘  │
├──────────┬──────────────────────────────────────────────────┤
│ SOURCES  │  [● All] [○ Posts] [○ External]                  │
│          │                                                   │
│ ● All    │  🔗 Dark mode toggle broken        Open    2m    │
│ ○ Posts  │  🔗 Can't export CSV               New     15m   │
│ ○ Interc │  💬 Billing question               Done    1h    │
│ ○ API    │  📡 Onboarding flow feedback       Done    2h    │
│          │  🔗 Search is too slow             New     3h    │
│ STATE    │                                                   │
│ ○ All    │                                                   │
│ ○ New    │                                                   │
│ ○ Done   │                                                   │
│ ○ Failed │                                                   │
└──────────┴──────────────────────────────────────────────────┘
```

**Implementation options (pick one):**

**Option A: Interleaved list with unified query** (complex)

- New server function merges posts + raw items into one sorted list
- Polymorphic rendering based on item type
- Complex pagination (two sources)

**Option B: Source tabs within inbox** (recommended)

- Left sidebar has source filters (same as current stream sidebar)
- "Posts" tab shows current inbox (posts list)
- "External" tab shows current stream (pipeline items)
- "All" shows both in separate sections
- Each has its own detail view when clicked

**Option C: Keep as separate sub-routes** (simplest)

- `/admin/feedback` = posts inbox (current behavior)
- `/admin/feedback/stream` = pipeline items (current behavior)
- Just remove the Insights tab and move it to Ideas
- Source sidebar acts as the navigator

**Recommendation: Option B** — it provides the "one inbox" feel while avoiding the complexity of interleaving two incompatible data shapes. The source sidebar becomes the unified filter panel.

### 2b. Source-aware detail views

When clicking an item in the inbox:

- **Post items:** Open PostModal (current behavior) — shows votes, comments, status, tags
- **External items:** Open a new FeedbackItemDetail panel/modal — shows raw content, extracted signals, metadata, external URL

### 2c. Pipeline stats integration

Move the `PipelineStatsBar` from Stream into the Feedback layout so it's visible across all inbox views. Shows total items, processing status, failed count with retry.

---

## Phase 3: Ideas Page (Current Insights)

### 3a. Move insights to ideas route

Copy the current `feedback.insights.tsx` route logic to `ideas.index.tsx`:

- Same search params (status, board, sort, q, theme)
- Same loader (themes, pipelineStats, mergeCandidates)
- Same component (InsightsLayout with theme list + detail)

### 3b. Ideas layout with toggle

**File:** `routes/admin/ideas.tsx`

```tsx
function IdeasLayout() {
  return (
    <div className="flex h-full flex-col">
      {/* Ideas / Roadmap toggle */}
      <div className="flex items-center gap-1 border-b px-4 py-2">
        <TabLink to="/admin/ideas" exact>
          Ideas
        </TabLink>
        <TabLink to="/admin/ideas/roadmap">Roadmap</TabLink>
      </div>
      <div className="flex-1 min-h-0">
        <Outlet />
      </div>
    </div>
  )
}
```

---

## Phase 4: Roadmap Page (Ideas Kanban)

### 4a. Move ideas roadmap view

Copy `RoadmapIdeasView` from the current roadmap page to `ideas.roadmap.tsx`:

- Kanban columns: Planned, In Progress, Shipped
- Idea cards with signal count, linked posts, vote aggregate
- Click navigates to `/admin/ideas?theme={id}`

### 4b. Remove posts roadmap

The posts-based roadmap (`RoadmapAdmin` with DnD Kanban) is being replaced. Options:

- **Remove entirely** — roadmap is now ideas-only
- **Keep as legacy** — accessible but not in main nav

**Recommendation:** Remove from main nav. The post status can be managed from the inbox or from within an idea's linked posts. If users need a posts kanban later, it can be re-added as a view option.

---

## Phase 5: Cleanup & Redirects

### 5a. Add redirects for old URLs

```
/admin/feedback/insights  →  /admin/ideas
/admin/roadmap            →  /admin/ideas/roadmap
/admin/roadmap?view=ideas →  /admin/ideas/roadmap
```

### 5b. Delete unused files

- `routes/admin/feedback.insights.tsx` (moved to ideas.index)
- `routes/admin/roadmap.tsx` (replaced by ideas.roadmap)
- `components/admin/feedback/feedback-tabs.tsx` (no more tabs)
- `components/admin/roadmap-admin.tsx` (posts kanban removed)
- `components/admin/roadmap-sidebar.tsx` (posts kanban removed)
- `components/admin/roadmap-*.tsx` (various roadmap post components)

### 5c. Update internal links

Search for all references to old URLs:

- `/admin/feedback/insights` → `/admin/ideas`
- `/admin/roadmap` → `/admin/ideas/roadmap`
- Navigation in `RoadmapIdeasView` card click → update to new ideas URL

---

## File Change Summary

### New files

| File                             | Purpose                                   |
| -------------------------------- | ----------------------------------------- |
| `routes/admin/ideas.tsx`         | Ideas layout with Ideas/Roadmap toggle    |
| `routes/admin/ideas.index.tsx`   | Ideas list (moved from feedback.insights) |
| `routes/admin/ideas.roadmap.tsx` | Ideas roadmap kanban                      |

### Modified files

| File                                                 | Change                                  |
| ---------------------------------------------------- | --------------------------------------- |
| `components/admin/admin-sidebar.tsx`                 | Roadmap → Ideas nav item                |
| `routes/admin/feedback.tsx`                          | Remove FeedbackTabs, add pipeline stats |
| `routes/admin/feedback.index.tsx`                    | Add source tabs for unified inbox       |
| `components/admin/feedback/stream/stream-layout.tsx` | Possibly merge into inbox               |
| `components/admin/roadmap-ideas-view.tsx`            | Update links to new routes              |

### Deleted files

| File                                          | Reason                    |
| --------------------------------------------- | ------------------------- |
| `routes/admin/feedback.insights.tsx`          | Moved to ideas.index      |
| `routes/admin/roadmap.tsx`                    | Replaced by ideas.roadmap |
| `components/admin/feedback/feedback-tabs.tsx` | No more sub-tabs          |

### Files needing URL updates

- Any component linking to `/admin/feedback/insights` or `/admin/roadmap`
- `promote-to-post-dialog` or similar components with navigation
- Settings nav if it references feedback sources under feedback section

---

## Implementation Order

1. **Phase 1** — Route & nav changes (create ideas routes, update sidebar)
2. **Phase 3** — Ideas page (move insights, most critical path)
3. **Phase 4** — Roadmap page (move ideas kanban)
4. **Phase 2** — Unified inbox (add source tabs, pipeline stats)
5. **Phase 5** — Cleanup (redirects, delete old files, fix links)

Phase 3 before Phase 2 because the Ideas page is a straightforward move, while the unified inbox requires more design work.

---

## Decisions

1. **Posts roadmap:** Removed entirely. Replaced by ideas roadmap with similar DnD UX.
2. **Stream route:** Fully merged into inbox via source tabs. No separate stream route.
3. **Settings nav:** "Sources" stays under "Feedback" section.

---

## Risk Assessment

- **Low risk:** Nav item rename, route moves (mostly copy-paste)
- **Medium risk:** Unified inbox (new data combination, needs testing)
- **Low risk:** Cleanup (redirects are straightforward)
- **No data migration needed** — this is purely a UI restructure
