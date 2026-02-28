# Feedback UX Redesign: Ideas as Central Planning Unit

Date: 2026-02-26
Status: Proposed

## 1. Vision

Redesign the feedback system around **Ideas** (renamed from Themes) as the central unit connecting user feedback to roadmap decisions.

**Core principles:**

1. **Posts are inputs.** Users submit posts, vote, and comment. Posts are one signal source among many (Slack, Zendesk, Intercom, API, etc.). Posts are never "created from" ideas.
2. **Ideas are synthesis.** The AI pipeline clusters signals from all sources into ideas. Ideas are the PM's workspace for understanding what users need.
3. **Ideas are the roadmap.** Ideas have a planning lifecycle (under review → planned → in progress → shipped). The public roadmap shows ideas, not posts.
4. **Links are automatic.** When a signal from a post clusters into an idea, that post is auto-linked. PMs can also manually link posts. No "promote" action exists.

## 2. Mental Model

### Current (problems)

```
Posts = feedback + roadmap items + promotion targets (overloaded)
Themes = internal AI grouping, disconnected from posts and roadmap
Roadmap = posts filtered by status (no connection to aggregated signals)
"Promote to Post" = awkward bridge that creates duplicates
```

### Proposed

```
Posts    = user voice (input only). Users submit, vote, comment.
Ideas    = AI synthesis + PM planning unit. Contains signals from all sources.
Roadmap  = Ideas filtered by status (planned, in progress, shipped).
Board    = Posts browsable by users. Posts show linked idea status.
Changelog = References shipped ideas. Notifies all signal authors.
```

### Data flow

```
┌─────────────────────────────────────────────────────────────────┐
│                          INPUTS                                  │
│                                                                  │
│  Board Posts ──┐                                                 │
│  Slack ────────┤                                                 │
│  Zendesk ──────┼──→ Pipeline ──→ Signals ──→ Ideas               │
│  Intercom ─────┤                               │                 │
│  API/CSV ──────┘                               │                 │
│                                                │                 │
│  When a signal comes from a post, the post     │                 │
│  is auto-linked to the idea.                   │                 │
│                                                │                 │
├────────────────────────────────────────────────┤                 │
│                     PM DECISIONS               │                 │
│                                                ▼                 │
│  PM reviews ideas in admin workspace                             │
│  PM changes status: Under Review → Planned → In Progress → Ship │
│  PM merges duplicate ideas, archives noise                       │
│  PM manually links additional posts if needed                    │
│                                                │                 │
├────────────────────────────────────────────────┤                 │
│                   PUBLIC SURFACES              │                 │
│                                                ▼                 │
│  Board:     Posts (browse, vote, comment). Shows linked idea.    │
│  Roadmap:   Ideas by status. Shows linked posts + vote counts.   │
│  Post page: Shows "Part of idea with N requests — Planned".      │
│  Changelog: Shows shipped ideas with linked posts.               │
│  Notifications: Fan out to post voters + signal authors.         │
└─────────────────────────────────────────────────────────────────┘
```

### PM actions on an idea (simplified — no "promote")

| Action                 | When                                   | Result                                                  |
| ---------------------- | -------------------------------------- | ------------------------------------------------------- |
| **Change status**      | Always                                 | Moves idea through lifecycle. Cascades to linked posts. |
| **Link post**          | Similar post found but not auto-linked | Manual connection.                                      |
| **Merge ideas**        | Two ideas overlap                      | Signals + post links transfer. Source archived.         |
| **Archive**            | Idea is noise or resolved              | Removed from active list.                               |
| **Edit title/summary** | AI-generated text needs curation       | PM rewrites for public consumption.                     |

## 3. End-User Lifecycle

### A post's journey

1. User submits post → appears on board, pipeline ingests it
2. Pipeline extracts signals → signals cluster into an idea → post auto-linked to idea
3. User sees on their post: "Part of 'Data Export' — 11 similar requests — Planned"
4. If idea is already planned: "Great news — this is already on the roadmap!"
5. PM progresses idea → status cascades to post → user gets notified at each stage
6. Idea ships → changelog published → user notified "Your feedback shipped!"

### Posts with signals in multiple ideas

"I need CSV export AND dark mode" → two signals → two ideas. Post shows both:

```
This post relates to multiple ideas:
  📋 "Data Export" — Planned
  ●  "Dark Mode" — Under Review
```

Post fully resolves when all linked ideas are addressed.

### Idea with no linked posts

All signals from external channels (Slack, Zendesk). Idea appears on roadmap. No posts to vote on. If a user cares, they submit a post (normal board flow) → pipeline auto-links it → now there's something to vote on.

### Post not yet linked to any idea

Pipeline hasn't processed it yet, or content was too vague to extract a signal. Post shows its own manually-set status (Open, Closed). Falls back gracefully.

### New post matches a planned idea

Pipeline clusters the signal into the existing idea → auto-links the post → user immediately sees "Great news — this is already on the roadmap!" No PM action required.

## 4. Terminology Changes

| Old                        | New              | Scope                                       |
| -------------------------- | ---------------- | ------------------------------------------- |
| Theme                      | Idea             | All UI labels, component names, route names |
| feedback_themes (DB)       | feedback_themes  | Keep DB table name (avoid migration pain)   |
| FeedbackThemeId            | FeedbackThemeId  | Keep TypeID prefix internally               |
| Insights (tab)             | Ideas (tab)      | Admin nav                                   |
| Stream (tab)               | Pipeline (tab)   | Admin nav                                   |
| Promote to Post            | (removed)        | No replacement — posts are inputs only      |
| theme-card.tsx             | idea-card.tsx    | Component rename                            |
| theme-list.tsx             | idea-list.tsx    | Component rename                            |
| theme-detail.tsx           | idea-detail.tsx  | Component rename                            |
| insights-layout.tsx        | ideas-layout.tsx | Component rename                            |
| promote-to-post-dialog.tsx | (deleted)        | No longer needed                            |

## 5. Data Model Changes

### 5.1 feedback_themes — column changes

```sql
-- Expand status values for planning lifecycle
-- Old: 'active', 'merged', 'archived'
-- New: 'under_review', 'planned', 'in_progress', 'shipped', 'merged', 'archived'

-- Lifecycle timestamps
ALTER TABLE feedback_themes ADD COLUMN reviewed_at      timestamptz;
ALTER TABLE feedback_themes ADD COLUMN planned_at       timestamptz;
ALTER TABLE feedback_themes ADD COLUMN in_progress_at   timestamptz;
ALTER TABLE feedback_themes ADD COLUMN shipped_at       timestamptz;

-- Weekly signal trend (computed by maintenance job)
ALTER TABLE feedback_themes ADD COLUMN signals_this_week integer NOT NULL DEFAULT 0;
ALTER TABLE feedback_themes ADD COLUMN signals_last_week integer NOT NULL DEFAULT 0;

-- Deprecate promoted_to_post_id (replaced by idea_post_links)
-- Keep column initially, drop in later phase after migration complete
```

### 5.2 idea_post_links — new junction table

```sql
CREATE TABLE idea_post_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_id      uuid NOT NULL REFERENCES feedback_themes(id) ON DELETE CASCADE,
  post_id       uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  link_type     varchar(20) NOT NULL DEFAULT 'auto',
    -- 'auto'   = pipeline clustered a signal from this post into the idea
    -- 'manual' = PM explicitly linked via UI
  linked_at     timestamptz NOT NULL DEFAULT now(),
  linked_by_principal_id uuid REFERENCES principal(id),
  UNIQUE(theme_id, post_id)
);

CREATE INDEX idx_idea_post_links_theme ON idea_post_links(theme_id);
CREATE INDEX idx_idea_post_links_post  ON idea_post_links(post_id);
```

Auto-linking happens in the clustering service: when a signal's raw feedback item originated from a post (source_type = 'quackback'), create an auto link.

### 5.3 idea_roadmaps — new junction table (Phase 6)

```sql
CREATE TABLE idea_roadmaps (
  theme_id    uuid NOT NULL REFERENCES feedback_themes(id) ON DELETE CASCADE,
  roadmap_id  uuid NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  position    integer NOT NULL DEFAULT 0,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (theme_id, roadmap_id)
);
```

Ideas can be assigned to named roadmaps (like posts are today via `post_roadmaps`). Status determines the column placement.

### 5.4 dismissed_merge_pairs — new table

```sql
CREATE TABLE dismissed_merge_pairs (
  theme_a_id    uuid NOT NULL REFERENCES feedback_themes(id) ON DELETE CASCADE,
  theme_b_id    uuid NOT NULL REFERENCES feedback_themes(id) ON DELETE CASCADE,
  dismissed_at  timestamptz NOT NULL DEFAULT now(),
  dismissed_by  uuid REFERENCES principal(id),
  PRIMARY KEY (theme_a_id, theme_b_id)
);
```

### 5.5 Status cascading logic

When PM changes idea status, optionally cascade to linked posts:

| Idea Status  | Maps to Post Status | Cascade Rule                                        |
| ------------ | ------------------- | --------------------------------------------------- |
| under_review | Under Review        | Only if post is "Open" or has no status             |
| planned      | Planned             | Auto-cascade (don't regress more advanced statuses) |
| in_progress  | In Progress         | Auto-cascade                                        |
| shipped      | Complete            | Auto-cascade                                        |

Cascading matches idea status to post status by slug: `under_review` → post status with slug `under_review`, etc. The existing `post_statuses` table already has these slugs as defaults.

### 5.6 Columns to deprecate

| Column                   | Table           | Replaced by       |
| ------------------------ | --------------- | ----------------- |
| `promoted_to_post_id`    | feedback_themes | `idea_post_links` |
| `promoted_from_theme_id` | posts           | `idea_post_links` |

Keep both during transition. Drop after all references migrated.

### 5.7 Migration SQL

```sql
-- Migrate status values
UPDATE feedback_themes SET status = 'under_review' WHERE status = 'active';

-- Migrate promoted_to_post_id to idea_post_links
INSERT INTO idea_post_links (theme_id, post_id, link_type, linked_at)
SELECT id, promoted_to_post_id, 'auto', COALESCE(updated_at, created_at)
FROM feedback_themes
WHERE promoted_to_post_id IS NOT NULL;

-- Backfill auto-links from pipeline data
-- (post ingested as raw item → signal → clustered into theme = auto link)
INSERT INTO idea_post_links (theme_id, post_id, link_type, linked_at)
SELECT DISTINCT fs.theme_id, p.id, 'auto', fs.created_at
FROM feedback_signals fs
JOIN raw_feedback_items ri ON fs.raw_feedback_item_id = ri.id
JOIN posts p ON ri.external_id = CONCAT('post:', p.id)
WHERE fs.theme_id IS NOT NULL
  AND ri.source_type = 'quackback'
ON CONFLICT (theme_id, post_id) DO NOTHING;

-- Update partial unique index for title dedup
DROP INDEX IF EXISTS feedback_themes_title_active_unique;
CREATE UNIQUE INDEX feedback_themes_title_active_unique
  ON feedback_themes (LOWER(TRIM(title)))
  WHERE status IN ('under_review', 'planned', 'in_progress');
```

## 6. Affected Surfaces — Complete Inventory

### 6.1 Admin: Feedback — Ideas (renamed from Insights)

| File                                                            | Change                                                                                                                                                                     |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routes/admin/feedback.insights.tsx`                            | Rename to `feedback.ideas.tsx`. Update search param `theme` → `idea`. Update loader, page title.                                                                           |
| `components/admin/feedback/insights/insights-layout.tsx`        | Rename to `ideas/ideas-layout.tsx`. Add attention bar. Update column headers.                                                                                              |
| `components/admin/feedback/insights/theme-list.tsx`             | Rename to `ideas/idea-list.tsx`. Add search, pagination totals, trend indicators.                                                                                          |
| `components/admin/feedback/insights/theme-card.tsx`             | Rename to `ideas/idea-card.tsx`. Add status indicator (▲/●/✓), trend arrow. Remove "promoted" rocket icon.                                                                 |
| `components/admin/feedback/insights/theme-detail.tsx`           | Rename to `ideas/idea-detail.tsx`. Remove "Promote to post" button. Add status dropdown, linked posts section, similar posts section. Add `[···]` menu with merge/archive. |
| `components/admin/feedback/insights/signal-row.tsx`             | Rename to `ideas/signal-row.tsx`. No functional change.                                                                                                                    |
| `components/admin/feedback/insights/evidence-quote.tsx`         | Rename to `ideas/evidence-quote.tsx`. No functional change.                                                                                                                |
| `components/admin/feedback/insights/promote-to-post-dialog.tsx` | **Delete.** No longer needed.                                                                                                                                              |
| `components/admin/feedback/insights/merge-theme-dialog.tsx`     | Rename to `ideas/merge-idea-dialog.tsx`. Update labels.                                                                                                                    |
| `components/admin/feedback/insights/move-signal-dialog.tsx`     | Rename to `ideas/move-signal-dialog.tsx`. Update labels.                                                                                                                   |

**New files:**
| File | Purpose |
|------|---------|
| `ideas/attention-bar.tsx` | Merge candidates count, unassigned boards, failed items |
| `ideas/linked-posts-section.tsx` | Shows posts linked to idea with vote counts |
| `ideas/similar-posts-section.tsx` | Shows unlinked similar posts with "Link" action |
| `ideas/merge-candidates-view.tsx` | Side-by-side merge candidate comparison |
| `ideas/link-post-dialog.tsx` | Search/select a post to manually link |
| `ideas/idea-status-dropdown.tsx` | Status lifecycle dropdown with cascade option |

### 6.2 Admin: Feedback — Pipeline (renamed from Stream)

| File                                                         | Change                                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `routes/admin/feedback.stream.tsx`                           | Rename to `feedback.pipeline.tsx`. Update search params.                      |
| `components/admin/feedback/stream/stream-layout.tsx`         | Rename to `pipeline/pipeline-layout.tsx`. Add pipeline flow visualization.    |
| `components/admin/feedback/stream/stream-feed.tsx`           | Rename to `pipeline/pipeline-feed.tsx`. Add "Retry All", pagination totals.   |
| `components/admin/feedback/stream/stream-feed-item.tsx`      | Rename to `pipeline/pipeline-feed-item.tsx`. Use friendly state labels.       |
| `components/admin/feedback/stream/stream-source-sidebar.tsx` | Rename to `pipeline/pipeline-sidebar.tsx`. Use friendly filter labels.        |
| `components/admin/feedback/stream/pipeline-stats-bar.tsx`    | Move to `pipeline/pipeline-stats-bar.tsx`. Becomes secondary to the flow viz. |

**New files:**
| File | Purpose |
|------|---------|
| `pipeline/pipeline-flow.tsx` | Visual funnel (Ingested → Queued → Processing → Done / Failed) with progress bar |

### 6.3 Admin: Roadmap

Currently post-centric. Will transition to idea-centric in later phase.

| File                                           | Change (Phase 6)                                               |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `components/admin/roadmap-admin.tsx`           | Add idea-based roadmap view alongside post-based               |
| `components/admin/roadmap-board.tsx`           | Support idea cards in addition to post cards                   |
| `components/admin/roadmap-column.tsx`          | Render idea cards in status columns                            |
| `components/admin/roadmap-card.tsx`            | New idea card variant showing signal count + linked post votes |
| `components/admin/roadmap-modal.tsx`           | Idea detail modal (reuse idea-detail content)                  |
| `components/admin/roadmap-sidebar.tsx`         | Filter by board, source type, signal count                     |
| `components/admin/add-to-roadmap-dropdown.tsx` | Work with ideas instead of (or alongside) posts                |
| `routes/admin/roadmap.tsx`                     | Load ideas with planning statuses for roadmap display          |

### 6.4 Admin: Changelog

| File                                                                | Change (Phase 7)                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------- |
| `components/admin/changelog/create-changelog-dialog.tsx`            | Pre-fill from linked idea data (title, summary, signal count) |
| `components/admin/changelog/changelog-metadata-sidebar-content.tsx` | Link ideas to changelog entries (in addition to posts)        |
| `lib/server/domains/changelog/changelog.service.ts`                 | Support idea references in changelog entries                  |
| `lib/server/functions/changelog.ts`                                 | Include idea data in changelog creation/queries               |

### 6.5 Admin: Settings & Navigation

| File                                                 | Change                                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `components/admin/settings/settings-nav.tsx`         | "Feedback" section remains. No label changes needed (Boards, Statuses, Sources).             |
| `routes/admin/settings.feedback-sources.tsx`         | Update description text: "themes" → "ideas"                                                  |
| `components/admin/settings/statuses/status-list.tsx` | No immediate change. Later: note that idea statuses may supersede post statuses for roadmap. |

### 6.6 Public: Post Detail

| File                                                     | Change                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------- |
| `routes/_portal.b.$slug.posts.$postId.tsx`               | Load linked idea data alongside post. Pass to components.                   |
| `components/public/post-detail/post-content-section.tsx` | Show linked idea status section above content (progress bar, signal count). |
| `components/public/post-detail/metadata-sidebar.tsx`     | Show linked idea in metadata (name, status, signal count).                  |
| `components/public/post-card.tsx`                        | Show linked idea status badge alongside post status.                        |

**New files:**
| File | Purpose |
|------|---------|
| `components/public/post-detail/idea-status-section.tsx` | "Part of 'Data Export' — Planned — 11 similar requests" with progress bar |

### 6.7 Public: Roadmap

Currently shows posts in status columns. Will transition to ideas in later phase.

| File                                                | Change (Phase 6)                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `routes/_portal/roadmap.index.tsx`                  | Load ideas with planning statuses. Columns from idea status, not post status.      |
| `components/public/roadmap-board.tsx`               | Render idea cards instead of post cards.                                           |
| `components/public/roadmap-card.tsx`                | New: idea title, summary, signal count, linked post vote total, linked posts list. |
| `components/public/roadmap-column.tsx`              | Columns: Planned, In Progress, Shipped Recently.                                   |
| `components/public/use-public-roadmap-selection.ts` | Selection state for idea-based roadmap.                                            |
| `components/public/use-public-roadmap-filters.ts`   | Filter by board, source type.                                                      |

**New files:**
| File | Purpose |
|------|---------|
| `components/public/idea-roadmap-card.tsx` | Idea card for public roadmap showing linked posts |
| `routes/_portal/roadmap.idea.$ideaId.tsx` | Public idea detail page (linked posts, signal count, "submit a post" CTA) |

### 6.8 Public: Changelog

| File                                                     | Change (Phase 7)                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `components/portal/changelog/changelog-entry-card.tsx`   | Show linked idea data (signal count, linked posts)                                   |
| `components/portal/changelog/changelog-entry-detail.tsx` | Show "This addresses feedback from N requests across your board, Slack, and Zendesk" |

### 6.9 Public: Portal Navigation

| File                                  | Change                                                            |
| ------------------------------------- | ----------------------------------------------------------------- |
| `components/public/portal-header.tsx` | No change needed. Feedback / Roadmap / Changelog structure stays. |

### 6.10 Server Functions & Services

| File                                                             | Change                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/server/functions/feedback.ts`                               | Rename theme functions → idea naming. Remove `promoteThemeToPostFn`. Add: `updateIdeaStatus`, `linkIdeaToPost`, `unlinkIdeaFromPost`, `findSimilarPostsForIdea`, `fetchLinkedPosts`, `fetchAttentionItems`, `retryAllFailedItems`. Update `fetchFeedbackThemes` with search, total count. |
| `lib/server/domains/feedback/promotion/promote-theme.service.ts` | **Delete.** No longer needed.                                                                                                                                                                                                                                                             |
| `lib/server/domains/posts/post.service.ts`                       | Remove `promotedFromThemeId` handling in `createPost`.                                                                                                                                                                                                                                    |
| `lib/server/domains/posts/post.status.ts`                        | Add check: if post is linked to idea, status changes may cascade.                                                                                                                                                                                                                         |
| `lib/server/views/portal-detail.ts`                              | Include linked ideas in `PublicPostDetailView`.                                                                                                                                                                                                                                           |
| `lib/server/views/roadmap.ts`                                    | Add idea-based roadmap data query (Phase 6).                                                                                                                                                                                                                                              |
| `lib/server/functions/roadmaps.ts`                               | Support idea roadmap operations (Phase 6).                                                                                                                                                                                                                                                |
| `lib/server/functions/changelog.ts`                              | Support idea references in changelog (Phase 7).                                                                                                                                                                                                                                           |

**New files:**
| File | Purpose |
|------|---------|
| `lib/server/domains/feedback/idea-status.service.ts` | Status change logic, post status cascading, notification dispatch |
| `lib/server/domains/feedback/idea-linking.service.ts` | Auto-linking from pipeline, manual link/unlink, similar post detection |

### 6.11 Pipeline Services

| File                                                               | Change                                                                                         |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `lib/server/domains/feedback/pipeline/clustering.service.ts`       | After assigning signal to idea: if signal came from a post, auto-create `idea_post_links` row. |
| `lib/server/domains/feedback/pipeline/merge-detection.service.ts`  | Exclude dismissed pairs from results.                                                          |
| `lib/server/domains/feedback/queues/feedback-maintenance-queue.ts` | Add weekly trend computation job.                                                              |
| `lib/server/domains/feedback/types.ts`                             | Update `ThemeStatus` type. Add `FeedbackMaintenanceJob` variant for trend computation.         |

### 6.12 Client Queries & Mutations

| File                                    | Change                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| `lib/client/queries/feedback.ts`        | Rename theme queries → idea. Add: linked posts, attention items, similar posts. |
| `lib/client/queries/portal-detail.ts`   | Include linked idea data in post detail query.                                  |
| `lib/client/queries/portal.ts`          | Add idea-based roadmap queries (Phase 6).                                       |
| `lib/client/mutations/roadmap-posts.ts` | Add idea-roadmap mutations (Phase 6).                                           |

### 6.13 Event System

| File                                              | Change                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `lib/server/events/types.ts`                      | Remove `promotedFromThemeId` from `EventPostData`. Add idea status change event type. |
| `lib/server/events/dispatch.ts`                   | Remove `promotedFromThemeId` from post event payloads.                                |
| `lib/server/events/registry.ts`                   | Register idea status change event handlers.                                           |
| `lib/server/events/handlers/feedback-pipeline.ts` | Remove post.created → theme promotion logic.                                          |

### 6.14 Database Schema

| File                                 | Change                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `packages/db/src/schema/feedback.ts` | Add new columns to `feedbackThemes`. Add `ideaPostLinks` table. Add `dismissedMergePairs` table. Update relations. |
| `packages/db/src/schema/posts.ts`    | Deprecate `promotedFromThemeId`. Add relation to `ideaPostLinks`.                                                  |
| `packages/db/src/schema/boards.ts`   | Add `ideaRoadmaps` table (Phase 6).                                                                                |
| `packages/db/src/seed.ts`            | Update seed data for new status values.                                                                            |
| `packages/db/drizzle/`               | New migration files for each phase.                                                                                |

### 6.15 MCP Server

| File                    | Change                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `packages/mcp/src/*.ts` | If MCP tools reference themes, update terminology. Check `search_feedback`, `triage_post` tools for theme references. |

### 6.16 Email Templates

| File                                                   | Change (Phase 7)                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| `packages/email/src/templates/changelog-published.tsx` | Include idea context (signal count, linked posts) in notification. |

## 7. UI Screens

### 7.1 Admin: Ideas View (Default Landing)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Feedback                                                                   │
│  [● Ideas]   [Pipeline]                              234 items · 18 ideas   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─ Attention ────────────────────────────────────────────────────────────┐ │
│  │  🔀 2 ideas may be duplicates     📋 3 ideas have no board       ❌ 2 │ │
│  │     Review & merge →                  Assign boards →          failed │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌─ Filters ──┐ ┌─ Ideas ─────────────────────────────┐ ┌─────────────────┐│
│  │            │ │                                      │ │                 ││
│  │  Status    │ │  Search ideas...           Sort: ▾   │ │  ← Select an    ││
│  │  ● Under   │ │                          Strength    │ │    idea to      ││
│  │    Review  │ │  Showing 18 of 42                    │ │    see details  ││
│  │  ○ Planned │ ├──────────────────────────────────────┤ │                 ││
│  │  ○ In Prog │ │                                      │ │                 ││
│  │  ○ Shipped │ │  ▲  Better search               6.1  │ │                 ││
│  │  ○ Merged  │ │     8 signals · 5 people · ↑3/wk    │ │                 ││
│  │  ○ Archived│ │     No board · API, Widget           │ │                 ││
│  │            │ ├──────────────────────────────────────┤ │                 ││
│  │  Board     │ │                                      │ │                 ││
│  │  ┌──────┐  │ │  ●  Dark mode support            8.2  │ │                 ││
│  │  │All  ▾│  │ │     12 signals · 8 people · ↑5/wk   │ │                 ││
│  │  └──────┘  │ │     UI/UX · Slack, Widget            │ │                 ││
│  │            │ ├──────────────────────────────────────┤ │                 ││
│  │  Source    │ │                                      │ │                 ││
│  │  ┌──────┐  │ │  ●  Export to CSV                4.5  │ │                 ││
│  │  │All  ▾│  │ │     6 signals · 4 people · ↑1/wk    │ │                 ││
│  │  └──────┘  │ │     Integrations · API               │ │                 ││
│  │            │ ├──────────────────────────────────────┤ │                 ││
│  │            │ │                                      │ │                 ││
│  │            │ │  ✓  Mobile navigation            4.5  │ │                 ││
│  │            │ │     5 signals · 4 people · stable     │ │                 ││
│  │            │ │     Mobile · Intercom · Shipped       │ │                 ││
│  │            │ ├──────────────────────────────────────┤ │                 ││
│  │            │ │                                      │ │                 ││
│  │            │ │  Load more (showing 18 of 42)        │ │                 ││
│  │            │ │                                      │ │                 ││
│  └────────────┘ └──────────────────────────────────────┘ └─────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

**Idea card indicators:**

- `▲` = needs attention (no board, merge candidate)
- `●` = normal (under review, planned, in progress)
- `✓` = terminal (shipped, merged, archived)

**Trend indicators:**

- `↑5/wk` = growing (5 new signals this week)
- `stable` = flat
- `new` = created this week
- `↓2/wk` = declining

### 7.2 Admin: Idea Detail (Right Panel)

```
┌─ Dark mode support ──────────────────────────────────────────────┐
│                                                                   │
│  Users consistently request a dark color scheme for reduced       │
│  eye strain during evening use and accessibility.                 │
│                                                    [Edit ✎]      │
│                                                                   │
│  Status: [Under Review ▾]  ☐ Update 2 linked posts              │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  12 signals     8 people     8.2 strength                  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  Board: UI/UX · Sources: Slack, Widget                            │
│  Sentiment: 2+ 8~ 2- · Urgency: 1▲ 4● 7○                       │
│                                                                   │
│  ┌─ Linked Posts (2) ────────────────────────────────────────┐   │
│  │                                                            │   │
│  │  "Please add dark mode"                       23 votes     │   │
│  │   UI/UX board · Open · 3 comments                         │   │
│  │                                                            │   │
│  │  "Night theme for accessibility"               8 votes     │   │
│  │   UI/UX board · Open · 1 comment                          │   │
│  │                                                            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Similar Posts (1) ───────────────────────────────────────┐   │
│  │                                                            │   │
│  │  "Dark color scheme option"          87% match · 5 votes   │   │
│  │                                        [Link to this idea] │   │
│  │                                                            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  [Link a Post]                            [Merge ···] [Archive]   │
│                                                                   │
│  ─── Signals (12) ───────────────────────────────────────────    │
│                                                                   │
│  ┌─ Feature Request ─────────────────────────────────────────┐   │
│  │  Slack · 92% confidence                          [Move ↗] │   │
│  │  "Would love dark mode for late-night sessions"            │   │
│  │                                                            │   │
│  │  ❝ I always work at night and the bright UI hurts          │   │
│  │    my eyes ❞                                               │   │
│  │    — Sarah via Slack                                       │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Feature Request ─────────────────────────────────────────┐   │
│  │  Widget · 88% confidence                         [Move ↗] │   │
│  │  "Need dark theme option for better accessibility"         │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

**Key sections:**

1. Title + Summary (editable — PM curates for public display)
2. Status dropdown with cascade checkbox
3. Quick stats row
4. Board + source + sentiment/urgency metadata
5. Linked Posts — auto-linked + manually linked. Each clickable to post.
6. Similar Posts — AI-detected unlinked matches. "Link to this idea" action.
7. Action bar — "Link a Post" (manual search), Merge, Archive
8. Signals list — all extracted signals with evidence, source, confidence

### 7.3 Admin: Merge Candidates

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Feedback > Merge Candidates                                    [← Back]    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  These idea pairs have high similarity and may be duplicates.               │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                                                                      │   │
│  │  "Dark mode"              ←── 89% similarity ──→  "Dark theme"       │   │
│  │   12 signals · UI/UX                               4 signals · UI/UX │   │
│  │   str 8.2                                          str 3.1           │   │
│  │                                                                      │   │
│  │                        [Merge →]   [Not duplicates]                  │   │
│  │                                                                      │   │
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │                                                                      │   │
│  │  "Mobile navigation"     ←── 82% similarity ──→  "Navigation UX"    │   │
│  │   5 signals · Mobile                               3 signals · —     │   │
│  │   str 4.5                                          str 2.8           │   │
│  │                                                                      │   │
│  │                        [Merge →]   [Not duplicates]                  │   │
│  │                                                                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.4 Admin: Pipeline View

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Feedback                                                                   │
│  [Ideas]   [● Pipeline]                                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─ Pipeline Flow ────────────────────────────────────────────────────────┐ │
│  │                                                                        │ │
│  │   Ingested        Queued        Processing       Done        Failed    │ │
│  │   ┌──────┐       ┌──────┐       ┌──────┐       ┌──────┐    ┌──────┐  │ │
│  │   │ 234  │ ───── │  3   │ ───── │  1   │ ───── │ 228  │    │  2   │  │ │
│  │   │ total│       │      │       │      │       │  97% │    │  <1% │  │ │
│  │   └──────┘       └──────┘       └──────┘       └──────┘    └──────┘  │ │
│  │                                                                        │ │
│  │   ████████████████████████████████████████████████████████████████░░   │ │
│  │                                                                  97%   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌─ Filters ──┐ ┌─ Items ────────────────────────────────────────────────┐ │
│  │            │ │                                                        │ │
│  │  Status    │ │  Source        Feedback                       Status   │ │
│  │  ○ All     │ ├────────────────────────────────────────────────────────┤ │
│  │  ○ Done    │ │                                                        │ │
│  │  ● Failed  │ │  [Slack]  "Dark mode would be amazing..."     Failed   │ │
│  │  ○ Queued  │ │           Sarah K · 2h ago                   [Retry]  │ │
│  │  ○ Working │ │           ⚠ OpenAI rate limit exceeded                 │ │
│  │            │ │                                                        │ │
│  │  Source    │ ├────────────────────────────────────────────────────────┤ │
│  │  ○ All     │ │                                                        │ │
│  │  ○ Slack   │ │  [API]    "Rate limits on the v2 API..."      Failed   │ │
│  │  ○ Widget  │ │           james@co.com · 5h ago              [Retry]  │ │
│  │  ○ API     │ │           ⚠ Timeout after 30s                          │ │
│  │            │ │                                                        │ │
│  │            │ ├────────────────────────────────────────────────────────┤ │
│  │            │ │                                                        │ │
│  │            │ │  Showing 2 of 2 failed items                           │ │
│  │            │ │                                             [Retry All] │ │
│  │            │ │                                                        │ │
│  └────────────┘ └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Pipeline state mapping:**

| Internal State                            | Display Label | Filter Label |
| ----------------------------------------- | ------------- | ------------ |
| `pending_context`, `ready_for_extraction` | Queued        | Queued       |
| `extracting`, `interpreting`              | Processing    | Working      |
| `completed`                               | Done          | Done         |
| `failed`                                  | Failed        | Failed       |

### 7.5 Public: Post Detail with Linked Idea

```
┌─ Add CSV export for our reports ─────────────────────────────┐
│  Features board · 14 votes · 3 comments                      │
│                                                               │
│  ┌─ Idea: Data Export ──────────────────── Planned ─────────┐│
│  │                                                           ││
│  │  11 similar requests across Slack, Zendesk, and the       ││
│  │  feedback board.                                          ││
│  │                                                           ││
│  │  ● Collected  ● Under Review  ● Planned                  ││
│  │  ○ In Progress  ○ Shipped                                 ││
│  │                                                           ││
│  └───────────────────────────────────────────────────────────┘│
│                                                               │
│  We need to export our weekly reports to CSV so we can        │
│  share them with stakeholders who don't have accounts.        │
│  PDF would also work.                                         │
│                                                               │
│  --- Comments ---                                             │
│  PM (2d ago): We're seeing strong demand across the board.    │
│  Planning to ship in the next sprint.                         │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

**When post's idea is already planned (new user submits matching post):**

```
┌─ Idea: Data Export ──────────────────────── Planned ─────────┐
│                                                               │
│  Great news — this is already on the roadmap!                 │
│  Part of "Data Export" with 14 similar requests.              │
│                                                               │
│  ✓ Collected  ✓ Under Review  ● Planned                      │
│  ○ In Progress  ○ Shipped                                     │
└───────────────────────────────────────────────────────────────┘
```

**When post has signals in multiple ideas:**

```
┌─ This post relates to multiple ideas: ───────────────────────┐
│                                                               │
│  📋  "Data Export" — Planned                                  │
│  ●   "Dark Mode" — Under Review                              │
└───────────────────────────────────────────────────────────────┘
```

**When post has no linked idea (pipeline hasn't processed or no signal extracted):**

No idea section shown. Post displays its own manually-set status as today. No change from current behavior.

### 7.6 Public: Roadmap (Idea-Centric, Phase 6)

```
┌─ Roadmap ────────────────────────────────────────────────────────────┐
│                                                                       │
│  Planned                          In Progress                         │
│                                                                       │
│  ┌─────────────────────────────┐ ┌─────────────────────────────────┐ │
│  │ Data Export                  │ │ Dark Mode                       │ │
│  │ 11 requests · 31 votes      │ │ 12 requests · 38 votes          │ │
│  │                              │ │                                 │ │
│  │ Export data in CSV and PDF   │ │ Dark color scheme for reduced   │ │
│  │ for compliance and sharing.  │ │ eye strain and accessibility.   │ │
│  │                              │ │                                 │ │
│  │ Posts:                       │ │ Posts:                          │ │
│  │ ├ "Add CSV export"  14 ▲    │ │ ├ "Add dark mode"    23 ▲      │ │
│  │ ├ "GDPR export"     3 ▲     │ │ ├ "Night theme"       8 ▲      │ │
│  │ └ "Export to PDF"   8 ▲     │ │ └ "Dark color opt"    5 ▲      │ │
│  └─────────────────────────────┘ └─────────────────────────────────┘ │
│                                                                       │
│  ┌─────────────────────────────┐                                      │
│  │ API Webhooks                 │ Shipped Recently                     │
│  │ 6 requests · 8 votes        │ ┌─────────────────────────────────┐ │
│  │                              │ │ ✅ CSV Import        shipped 2d │ │
│  │ Real-time event webhooks     │ │    5 requests · 12 votes        │ │
│  │ for external integrations.   │ ├─────────────────────────────────┤ │
│  │                              │ │ ✅ Custom Domains    shipped 1w │ │
│  │ Posts:                       │ │    3 requests · 19 votes        │ │
│  │ └ "Webhook support"  8 ▲    │ └─────────────────────────────────┘ │
│  └─────────────────────────────┘                                      │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

**"N requests"** = idea signal count (from all channels).
**"N votes"** = sum of votes across linked posts.
**"Posts:"** = linked board posts. Each clickable. Vote button inline.

Ideas with no linked posts show signal count only, plus "Submit a post to add your voice →" CTA.

### 7.7 Public: Roadmap Idea Detail

When user clicks an idea on the roadmap:

```
┌─ Data Export ──────────────────────── Planned ───────────────┐
│                                                               │
│  ● Collected  ● Under Review  ● Planned                      │
│  ○ In Progress  ○ Shipped                                    │
│                                                               │
│  Users need the ability to export their data in CSV and       │
│  PDF formats for compliance audits and sharing with           │
│  stakeholders who don't have accounts.                        │
│                                                               │
│  11 requests from 4 channels · 31 votes                       │
│                                                               │
│  ┌─ Related Posts ─────────────────────────────────────────┐  │
│  │                                                         │  │
│  │  "Add CSV export for reports"            14 votes  [▲]  │  │
│  │   Features board · 3 comments                           │  │
│  │                                                         │  │
│  │  "Export dashboard to PDF"                8 votes  [▲]  │  │
│  │   Features board · 1 comment                            │  │
│  │                                                         │  │
│  │  "Data portability / GDPR"                3 votes  [▲]  │  │
│  │   Features board · 0 comments                           │  │
│  │                                                         │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  Don't see your specific use case?                            │
│  Submit a post to add your voice →                            │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

Users vote on linked posts (not on the idea directly). The idea aggregates demand.

### 7.8 Public: Changelog with Idea Context

```
┌─ Changelog ──────────────────────────────────────────────────┐
│                                                               │
│  Feb 24, 2026                                                 │
│                                                               │
│  Data Export                                                  │
│  ──────────                                                   │
│  Export your data to CSV or PDF from any report page.         │
│  Includes scheduled exports and GDPR compliance mode.         │
│                                                               │
│  This addresses 11 requests across your feedback board,       │
│  Slack, and Zendesk.                                          │
│                                                               │
│  Related posts:                                               │
│  ├ "Add CSV export for reports" · 14 votes                    │
│  ├ "Export dashboard to PDF" · 8 votes                        │
│  └ "Data portability / GDPR" · 3 votes                       │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

## 8. Implementation Phases

### Phase 1: Foundation — Rename + Idea Lifecycle

**Goal**: Rename UI, expand status system, add trend computation.

**DB migration:**

- Add lifecycle timestamp columns to `feedback_themes`
- Add `signals_this_week`, `signals_last_week` columns
- Migrate `status = 'active'` → `status = 'under_review'`
- Update partial unique index for new active statuses

**Backend:**

- Update `types.ts` — `ThemeStatus` adds `under_review`, `planned`, `in_progress`, `shipped`
- New `updateIdeaStatus` server function (changes status + sets timestamp)
- Add weekly signal trend computation to maintenance queue
- Update `fetchFeedbackThemes` for new status values

**Frontend (admin):**

- Rename all component files: `theme-*` → `idea-*`, `insights-*` → `ideas-*`
- Rename routes: `feedback.insights.tsx` → `feedback.ideas.tsx`, `feedback.stream.tsx` → `feedback.pipeline.tsx`
- Update all "Theme" labels → "Idea", "Insights" → "Ideas", "Stream" → "Pipeline"
- Add status dropdown to idea detail panel
- Update filter sidebar with new statuses
- Update idea cards with trend indicators
- Remove "Promote to post" button and dialog (delete `promote-to-post-dialog.tsx`)
- Add route redirects: `/admin/feedback/insights` → `/admin/feedback/ideas`

**Files:** ~25 files modified/renamed, 1 migration, 1 file deleted.

### Phase 2: Idea-Post Linking

**Goal**: Auto-link posts to ideas through pipeline. Manual linking in admin. Similar post detection.

**DB migration:**

- Create `idea_post_links` table
- Create `dismissed_merge_pairs` table
- Backfill links from existing `promoted_to_post_id` and pipeline data

**Backend:**

- New `idea-linking.service.ts` — auto-link logic, manual link/unlink, similar post search
- Update `clustering.service.ts` — after signal assignment, auto-create link if source is a post
- New server functions: `linkIdeaToPost`, `unlinkIdeaFromPost`, `findSimilarPostsForIdea`, `fetchLinkedPosts`
- Update `fetchMergeCandidates` to exclude dismissed pairs

**Frontend (admin):**

- Idea detail: add "Linked Posts" section (auto + manual links, with vote counts)
- Idea detail: add "Similar Posts" section (unlinked matches with "Link" button)
- New `link-post-dialog.tsx` (search existing posts to link)
- Update merge candidate dismissal flow

**Files:** ~10 files modified/created, 1 migration.

### Phase 3: Attention Bar + List Improvements

**Goal**: Surface actionable items. Improve list UX.

**Backend:**

- New `fetchAttentionItems` server function
- Update `fetchFeedbackThemes` — add search parameter, return total count
- New `retryAllFailedItems` server function

**Frontend (admin):**

- New `attention-bar.tsx` — merge candidates, unassigned boards, failed items
- New `merge-candidates-view.tsx` — side-by-side comparison with dismiss
- Add search input to idea list
- Add "Showing X of Y" pagination
- Improve idea cards: status indicators (▲/●/✓), better source icons

**Files:** ~8 files modified/created.

### Phase 4: Pipeline View Redesign

**Goal**: Better pipeline health monitoring.

**Backend:**

- Update `fetchFeedbackPipelineStats` for per-stage counts

**Frontend (admin):**

- Rename component files: `stream-*` → `pipeline-*`
- New `pipeline-flow.tsx` — visual funnel with progress bar
- Map internal states to friendly labels
- Add "Retry All" button for failed filter
- Add "Showing X of Y" pagination

**Files:** ~7 files renamed/modified, 1 new.

### Phase 5: Public Post Integration

**Goal**: Show linked idea context on public post pages. Status cascading.

**Backend:**

- New `idea-status.service.ts` — status change with post cascade logic
- Update `portal-detail.ts` — include linked idea data in `PublicPostDetailView`
- Status cascade: idea status change → optionally update linked post statuses

**Frontend (public):**

- New `idea-status-section.tsx` — "Part of 'Data Export' — Planned" with progress bar
- Update `post-content-section.tsx` — render idea section above content
- Update `metadata-sidebar.tsx` — show linked idea in sidebar
- Update `post-card.tsx` — show idea status badge

**Frontend (admin):**

- Status dropdown gets cascade checkbox: "☐ Update N linked posts"

**Files:** ~6 files modified, 2 new.

### Phase 6: Idea-Centric Roadmap

**Goal**: Roadmap shows ideas instead of posts.

**DB migration:**

- Create `idea_roadmaps` junction table

**Backend:**

- New roadmap query: ideas with planning statuses, linked posts, aggregated votes
- Server functions for assigning ideas to named roadmaps
- Public idea detail endpoint (for roadmap click-through)

**Frontend (public):**

- New `idea-roadmap-card.tsx` — idea title, summary, signal count, linked posts, vote total
- Update `roadmap-board.tsx` — render idea cards in status columns
- New route `roadmap.idea.$ideaId.tsx` — public idea detail page with linked posts
- "Submit a post" CTA for ideas with no linked posts

**Frontend (admin):**

- Update admin roadmap to manage ideas alongside (or replacing) posts
- "Add to roadmap" dropdown works with ideas

**Transition:** During this phase, the roadmap shows both legacy post-based items AND new idea-based items. Posts already linked to ideas show through the idea. Unlinked posts with planning statuses show directly (backward compat).

**Files:** ~12 files modified/created, 1 migration.

### Phase 7: Changelog + Notifications

**Goal**: Close the loop. Ship ideas, notify everyone.

**Backend:**

- Changelog entries can reference ideas
- When idea ships → dispatch notifications to:
  - Voters on all linked posts (existing post subscription system)
  - Signal authors from external channels (email if we have it)
- Pre-fill changelog content from idea summary + top signals

**Frontend (admin):**

- Changelog creation dialog: select idea to pre-fill content
- Show "Related posts" in changelog entry from linked posts

**Frontend (public):**

- Changelog entries show idea context (signal count, linked posts)

**Files:** ~8 files modified/created.

### Phase 8: Cleanup

**Goal**: Remove deprecated columns and legacy code.

- Drop `feedback_themes.promoted_to_post_id` column
- Drop `posts.promoted_from_theme_id` column
- Remove `promote-theme.service.ts`
- Remove `promoteThemeToPostFn` server function
- Remove `promotedFromThemeId` from event payloads
- Remove legacy post-based roadmap items (if all migrated to ideas)
- Update seed data

## 9. Edge Cases

### Pipeline timing

Post submitted → pipeline hasn't processed yet → no idea link. Post shows its own status normally. Within minutes, pipeline processes it, creates signal, clusters into idea, auto-links. Next page load shows the idea connection.

### Post with no extractable signal

"Me too" or "Thanks!" posts may not produce signals. No idea link. Post stays standalone. This is correct — not every post is meaningful feedback.

### Idea with zero linked posts

All signals from external channels. Appears on roadmap. No posts to vote on. "Submit a post to add your voice" CTA handles this. If a user cares, they create a post, pipeline auto-links.

### PM archives an idea that has linked posts

Posts lose their idea link for display purposes. They revert to showing their own manually-set status. They remain on the board.

### Two ideas merged

Signals transfer to target idea. Post links also transfer (re-pointed to target). Users see their post now "Part of 'Data Export'" instead of the old idea name.

### Post status vs idea status conflict

If a post is linked to an idea, the idea's status takes precedence for public display. The post's own `statusId` is used for moderation (spam, closed) and as a fallback when no idea is linked.

### Multi-idea post resolution

Post linked to ideas A (Shipped) and B (Planned). Post shows both statuses. When all linked ideas reach Shipped, the post is fully resolved.

### Existing roadmap transition

During Phase 6 transition: posts with planning statuses that aren't linked to ideas still appear on the roadmap. As pipeline backfills links, these transition naturally. Admin can also manually link legacy posts to ideas.

## 10. Open Questions

1. **Should users be able to subscribe to ideas?** Currently they subscribe to posts. An idea subscription would be a superset — notified when any linked post or the idea itself updates. This could reduce notification fragmentation.

2. **Idea title/summary curation**: AI-generated text may need PM editing for public roadmap display. Should we track "AI-generated" vs "PM-curated" state? Show an indicator?

3. **Multi-roadmap support for ideas**: The current system supports multiple named roadmaps. Should ideas be assignable to specific roadmaps (via `idea_roadmaps`), or should there be one global roadmap view filtered by idea status?

4. **Fan-out notifications to external channels**: When an idea ships, can we notify Slack/Zendesk/Intercom users back through their original channel? This requires bidirectional integration support.

5. **Voting on ideas**: If the public roadmap shows ideas, should users vote on them directly? Or always through linked posts? Direct idea voting would simplify the UX but adds a new voting surface.

6. **Idea visibility**: Should all ideas be publicly visible, or only those with planning statuses? An idea with status "under_review" might not be ready for public eyes. Options: ideas are public only when `planned` or later; or PMs explicitly mark ideas as "public."
