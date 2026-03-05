# Plan: Merge UX Overhaul

**Date**: 2026-03-05
**Type**: Feature (UX + Architecture)
**Status**: Draft
**Inspired by**: Featurebase merge UX

## Problem

Quackback has three disconnected merge experiences:
1. **"Mark as duplicate"** button in post header - opens search dialog (one direction only)
2. **AI Insights panel** `DuplicateSignalCard` - triage from the canonical post's detail view
3. **Insights tab** `SuggestionTriageRow` - batch triage of AI-detected duplicates

These experiences don't share a mental model. Worse, merge events are invisible in the post
timeline - there's no audit trail of when posts were merged, by whom, or what content was
absorbed. The PM has to check a separate "Merged Feedback" section above the comments to see
what happened.

Featurebase solves this with:
- Merge events as first-class entries in the activity timeline
- Bidirectional merge initiation ("Merge others to this" / "Merge to existing")
- Inline merged post cards with per-card context menus (copy link, unmerge)

## Goals

1. Make merge history visible in the post timeline
2. Support bidirectional merge from any post
3. Connect AI duplicate suggestions to the manual merge flow
4. Unify the three merge experiences into a coherent system

## Non-goals

- Bulk multi-select merge from inbox (future work)
- Activity feed as a general-purpose feature (we're adding merge events specifically)
- Changing the underlying merge data model (posts.canonicalPostId is fine)

---

## Feature 1: Bidirectional Merge Dropdown

**Priority**: High | **Effort**: Low-Medium

### Current state

The post header has a single "Mark as duplicate" button that opens `MergeIntoDialog`. This
only works in one direction: the current post becomes the duplicate, and the PM searches for
the canonical post to merge into.

```
Header: [Mark as duplicate] [Lock comments] [Delete] ...
```

### Target state

Replace the single button with a dropdown that offers two merge directions:

```
Header: [Merge v] [Lock comments] [Delete] ...
              |
              +-- Merge others into this   (this post is canonical)
              +-- Merge into existing...   (this post is the duplicate)
```

### How it works

**"Merge into existing"** - identical to current "Mark as duplicate" behavior. Reuses
`MergeIntoDialog` directly. The current post becomes a duplicate, absorbed into a canonical.

**"Merge others into this"** - new flow. Opens a similar search dialog but with inverted
semantics:
- Dialog title: "Merge posts into [current post title]"
- PM searches for posts that are duplicates of the current one
- Selected posts become duplicates; the current post is the canonical
- Can select multiple posts before confirming (unlike "Merge into existing" which is 1:1)

### Implementation

**New component**: `MergeOthersDialog`

```
apps/web/src/components/admin/feedback/merge-section.tsx
  - Add MergeOthersDialog (modeled after MergeIntoDialog)
  - Reuses findSimilarPostsFn for search
  - Supports multi-select: checkboxes on each search result
  - Confirmation shows all selected posts with arrow into current post
  - Calls mergePost() for each selected post sequentially
```

**Modified component**: Post modal header

```
apps/web/src/components/admin/feedback/post-modal.tsx
  - Replace the single "Mark as duplicate" <Button> with a <DropdownMenu>
  - Two items: "Merge others into this" and "Merge into existing..."
  - Use a merge/fork icon instead of DocumentDuplicateIcon
  - Hide entirely when post is already merged (has canonicalPostId)
  - Show only "Merge into existing" when post has mergedPosts (it's already canonical -
    but the PM might also want to merge it further up; edge case, allow both)
```

**AI signal integration**: When opening "Merge others into this", the dialog should show
AI-suggested duplicates at the top (from pending merge suggestions for this post), above
the manual search results. This connects Feature 4.

### Data flow

```
PM clicks "Merge others into this"
  -> MergeOthersDialog opens
  -> Fetches AI suggestions: getPendingSuggestionsForPost(postId)
  -> Shows them as "AI suggested" section at top of results
  -> PM can also search manually (findSimilarPostsFn)
  -> PM selects one or more posts via checkbox
  -> Clicks "Merge N posts"
  -> For each selected: mergePost(selectedPostId, currentPostId, actorPrincipalId)
  -> Invalidate queries, close dialog
```

### UI sketch

```
+--------------------------------------------------+
| Merge posts into "Add Supplier Discount..."    X |
|                                                  |
| [Search for similar feedback...              ]   |
|                                                  |
| -- AI Suggested -------------------------------- |
| [ ] ^ 1  Open  Add product price discount...     |
|          90% match                               |
| [ ] ^ 1  Open  Add product price discount...     |
|          95% match                               |
|                                                  |
| -- Search Results ------------------------------ |
| [ ] ^ 2  Open  Supplier discount tracking        |
|          Strong match                            |
| [ ] ^ 1  Open  Product line pricing              |
|          Good match                              |
|                                                  |
|                      [Cancel]  [Merge 2 posts]   |
+--------------------------------------------------+
```

---

## Feature 2: Merge Events in the Activity Timeline

**Priority**: High | **Effort**: Medium

### Current state

When posts are merged into a canonical post, the canonical post shows a separate "Merged
Feedback (N)" section above the comments. This is disconnected from the timeline:

```
[Post content]
[AI Summary]
[AI Insights]
───────────────────────────
Merged Feedback (3)
  [title] [votes] [Unmerge]
  [title] [votes] [Unmerge]
  [title] [votes] [Unmerge]
───────────────────────────
22 Comments
  [comment 1]
  [comment 2]
  ...
```

Merge events are invisible - no audit trail, no chronological context.

### Target state

Merge events appear as first-class entries in the comments timeline, interleaved
chronologically with comments:

```
[Post content]
[AI Summary]
[AI Insights]

22 Comments · 3 Merged
  [comment 1 - 7 months ago]
  [comment 2 - 6 months ago]
  [merge event - "Demo User merged in a post" - 2 days ago]
    ┌──────────────────────────────────────┐
    │ Add product price discount           │
    │ 1 vote · by Josh Knights             │
    │                             [...] ↓  │
    └──────────────────────────────────────┘
  [merge event - "Demo User merged in a post" - 2 days ago]
    ┌──────────────────────────────────────┐
    │ Supplier discount in details section │
    │ 1 vote · by Alex J                   │
    │                             [...] ↓  │
    └──────────────────────────────────────┘
  [comment 3 - 1 day ago]
```

### Approach: Read-time assembly (no schema change)

We already have all the data needed:
- `posts.mergedAt` - when the merge happened (timestamp for chronological ordering)
- `posts.mergedByPrincipalId` - who performed the merge (for "Demo User merged in a post")
- `posts.canonicalPostId` - which canonical post it was merged into
- `getMergedPosts()` already queries this data

Instead of creating a new activity_log table, we assemble the timeline at read time by
combining comments and merged posts into a single sorted array.

### Implementation

**Step 1: Extend merged posts query to include actor info**

```
apps/web/src/lib/server/domains/posts/post.merge.ts
  - getMergedPosts() already returns MergedPostSummary
  - Add: mergedByName (join principal table for display name)
  - Add: content (first 200 chars of post content for preview)
  - Return type becomes MergedPostSummary & { mergedByName, content }
```

**Step 2: Create unified timeline assembly**

```
apps/web/src/components/admin/feedback/detail/post-timeline.ts (new)
  - Type: TimelineEntry = { type: 'comment', data: Comment, date: Date }
                        | { type: 'merge', data: MergedPostSummary, date: Date }
  - Function: assembleTimeline(comments, mergedPosts) -> TimelineEntry[]
  - Sorts by date ascending
  - Comments use their createdAt, merged posts use their mergedAt
```

**Step 3: Create MergeEventCard component**

```
apps/web/src/components/admin/feedback/detail/merge-event-card.tsx (new)
  - Shows: "[Actor name] merged in a post · [time ago]"
  - Inline card: title, vote count, author name, content preview (line-clamp-2)
  - Context menu (...): "View original post", "Copy link", "Unmerge"
  - Unmerge triggers confirmation dialog, then calls unmergePost()
  - Matches existing card styles (border-border/60, bg-muted/30, etc.)
```

**Step 4: Integrate into CommentsSection**

```
apps/web/src/components/admin/feedback/post-modal.tsx
  - Pass mergedPosts to CommentsSection (or a new wrapper component)
  - The section header changes: "22 Comments" -> "22 Comments · 3 merged"

apps/web/src/components/admin/feedback/detail/admin-comments-section.tsx (new wrapper)
  - Wraps CommentsSection but adds merge events into the timeline
  - Only used in admin context (portal comments don't show merge events)
  - Calls assembleTimeline() to interleave comments and merge events
  - Renders MergeEventCard for merge entries, existing comment UI for comments
```

**Step 5: Remove or simplify MergedPostsList**

```
apps/web/src/components/admin/feedback/merge-section.tsx
  - MergedPostsList becomes unnecessary (its content is now in the timeline)
  - Keep it as a simple count indicator if needed: "3 posts merged into this"
  - Or remove entirely - the timeline handles it
```

### UI detail: MergeEventCard

```
┌─ merge event ──────────────────────────────────────────────┐
│ ↗ Demo User merged in a post             · about 2 days ago│
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ ^ Open                                               │  │
│  │ 1 Add product price discount in supplier details     │  │
│  │   We receive discounts from suppliers based on...    │  │
│  │   1 vote · Josh Knights                         ...  │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘

Context menu (...):
  - View original post  (navigates to the merged post)
  - Copy link
  - ──────────
  - Unmerge post        (confirmation dialog)
```

### Considerations

- **Performance**: getMergedPosts() is already called for the post detail. The only new query
  cost is the principal name join, which is cheap.
- **Portal vs Admin**: Merge events only show in the admin post modal, not the public portal.
  The portal doesn't need to expose merge history.
- **Sorting stability**: Comments have createdAt, merges have mergedAt. Both are timestamps
  with timezone, so chronological sorting is straightforward.

---

## Feature 3: AI Suggestions in the Manual Merge Flow

**Priority**: Medium | **Effort**: Low

### Current state

The "Mark as duplicate" dialog (`MergeIntoDialog`) uses `findSimilarPostsFn` to search
for similar posts by title. It has no awareness of AI-detected duplicates.

Meanwhile, the AI Insights panel shows `DuplicateSignalCard` with merge actions, and the
Insights tab shows `SuggestionTriageRow`. These three flows are completely independent.

### Target state

When the PM opens any merge dialog, AI-suggested matches appear at the top as a
"Suggested" section, before manual search results. This creates a unified experience
where AI suggestions surface everywhere the PM encounters merge decisions.

### Implementation

**Step 1: Add AI suggestions to MergeIntoDialog**

```
apps/web/src/components/admin/feedback/merge-section.tsx
  - MergeIntoDialog already takes postId
  - Add useQuery(signalQueries.mergeSuggestionsForPost(postId))
  - Render pending suggestions as a "Suggested by AI" section above search results
  - Each suggestion shows: matched post + confidence label + AI reasoning (truncated)
  - Clicking a suggestion selects it as the merge target (same as clicking a search result)
```

**Step 2: Add badge indicator on the merge button**

```
apps/web/src/components/admin/feedback/post-modal.tsx
  - Query pending signal count for the current post
  - If > 0, show a small dot/badge on the merge dropdown button
  - Visual cue: "AI has suggestions for you" without being intrusive
```

**Step 3: Dismiss AI signals when manual merge is performed**

```
apps/web/src/lib/server/domains/posts/post.merge.ts
  - After mergePost() succeeds, resolve any pending duplicate signals for both posts
  - Already partially done in merge-suggestion.service.ts (acceptMergeSuggestion calls
    resolveDuplicateSignalsForPosts)
  - Need to also call this from the manual merge path (mergePost directly)
```

### UI sketch for MergeIntoDialog with AI suggestions

```
+--------------------------------------------------+
| Mark as Duplicate                              X |
| Select the original post to merge into.          |
|                                                  |
| [Search for similar feedback...              ]   |
|                                                  |
| -- Suggested by AI ----------------------------- |
|   ^ 3 Open  Add Supplier Discount...             |
|   "Both posts request supplier-specific..."      |
|                                                  |
| -- Search Results ------------------------------ |
|   ^ 2 Open  Supplier discount tracking           |
|        Strong match                              |
|   ^ 1 Open  Product line pricing                 |
|        Good match                                |
|                                                  |
+--------------------------------------------------+
```

---

## Feature 4: Badge Indicator on Merge Button

**Priority**: Medium | **Effort**: Low

### Current state

The "Mark as duplicate" button in the post header has no indication that AI suggestions
exist. The PM has to scroll down to the AI Insights panel to discover them.

### Target state

When there are pending AI duplicate signals for the current post, the merge dropdown button
shows a small indicator (e.g. a dot badge or count). This creates a connection between the
header action and the AI system.

### Implementation

```
apps/web/src/components/admin/feedback/post-modal.tsx
  - Add useQuery(signalQueries.forPost(postId)) in the modal
  - Count signals where type === 'duplicate'
  - If count > 0, render a small amber dot on the merge dropdown trigger
  - Uses the same query that PostSignalsPanel already runs (cached, no extra request)
```

The dot is a subtle visual nudge - it doesn't require the PM to act, but it tells them
"there's something here" before they even scroll down.

---

## Execution Order

```
Phase 1 (quick wins):
  Feature 1: Bidirectional Merge Dropdown     ~1 session
  Feature 4: Badge Indicator on Merge Button  ~30 min (can do alongside Feature 1)

Phase 2 (timeline integration):
  Feature 2: Merge Events in Timeline         ~1-2 sessions
    - Step 1: Extend getMergedPosts query
    - Step 2: Timeline assembly utility
    - Step 3: MergeEventCard component
    - Step 4: Admin comments section wrapper
    - Step 5: Remove/simplify MergedPostsList

Phase 3 (connection):
  Feature 3: AI Suggestions in Manual Flow    ~1 session
    - Step 1: Add suggestions to MergeIntoDialog
    - Step 2: Add suggestions to MergeOthersDialog
    - Step 3: Auto-dismiss signals on manual merge
```

## Files Changed (Summary)

### New files
- `apps/web/src/components/admin/feedback/detail/merge-event-card.tsx`
- `apps/web/src/components/admin/feedback/detail/post-timeline.ts`
- `apps/web/src/components/admin/feedback/detail/admin-comments-section.tsx`

### Modified files
- `apps/web/src/components/admin/feedback/merge-section.tsx`
  - Add `MergeOthersDialog` component
  - Add AI suggestions section to `MergeIntoDialog`
  - Simplify/remove `MergedPostsList` (replaced by timeline)
- `apps/web/src/components/admin/feedback/post-modal.tsx`
  - Replace "Mark as duplicate" button with merge dropdown
  - Add badge indicator for AI signals
  - Pass mergedPosts to new admin comments section
- `apps/web/src/lib/server/domains/posts/post.merge.ts`
  - Extend `getMergedPosts()` to include actor name and content preview
  - Add signal resolution to manual `mergePost()` path
- `apps/web/src/lib/server/domains/posts/post.types.ts`
  - Extend `MergedPostSummary` with `mergedByName` and `content`

### No schema changes required
All data needed already exists in the posts table:
- `canonical_post_id` - merge relationship
- `merged_at` - when (for timeline ordering)
- `merged_by_principal_id` - who (for event attribution)
