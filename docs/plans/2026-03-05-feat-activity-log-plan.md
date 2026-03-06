# Plan: Post Activity Log

**Date**: 2026-03-05
**Type**: Feature (Data Model + UI)
**Status**: Draft
**Replaces**: Phase 2 of merge-ux-overhaul-plan.md (merge events in timeline)

## Problem

Quackback has no activity log. When a PM opens a post, they see comments and nothing else.
They can't answer: "Who changed the status last week?", "When was this moved to the roadmap?",
"Who merged that duplicate in?", or "What happened to this post while I was on leave?"

Competitors (Canny, Featurebase) solve this with a Comments / Activity tab split on every post.
Activity shows a chronological log of all state changes — status transitions, merges, tag
changes, owner assignments — interleaved with timestamps and actor names.

We already dispatch events for webhooks (`post.created`, `post.status_changed`,
`comment.created`) but **never persist them**. The event system proves we know about
these transitions — we just don't store them for internal use.

## Goals

1. Persist all meaningful post state changes in a queryable `post_activity` table
2. Add a Comments / Activity tab pair to the post modal (admin only)
3. Instrument all existing mutation paths to emit activity records
4. Remove the need for the separate "Merged Feedback" section (activity timeline handles it)

## Non-goals

- Global activity feed across all posts (future work — this is post-scoped only)
- Public portal activity (portal users see comments only, as today)
- Retroactive backfill of historical activity (we start recording from deployment forward)
- Changing how comments work (comments stay in their own table and timeline)

---

## Data Model

### New table: `post_activity`

```sql
CREATE TABLE post_activity (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  principal_id  UUID REFERENCES principal(id),       -- who did it (null for system actions)
  type          TEXT NOT NULL,                        -- activity type enum
  metadata      JSONB NOT NULL DEFAULT '{}',          -- type-specific payload
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_post_activity_post_id ON post_activity(post_id, created_at);
CREATE INDEX idx_post_activity_type ON post_activity(type);
```

TypeID prefix: `activity`

### Activity Types

Every type below maps to a specific mutation in the codebase. The "Metadata" column
shows the JSONB payload stored with each activity record.

#### Post Lifecycle

| Type            | Trigger            | Metadata        | Service Function   |
| --------------- | ------------------ | --------------- | ------------------ |
| `post.created`  | Post creation      | `{ boardName }` | `createPost()`     |
| `post.deleted`  | Soft delete        | `{}`            | `softDeletePost()` |
| `post.restored` | Restore from trash | `{}`            | `restorePost()`    |

#### Status Changes

| Type             | Trigger       | Metadata                                   | Service Function |
| ---------------- | ------------- | ------------------------------------------ | ---------------- |
| `status.changed` | Status update | `{ fromName, fromColor, toName, toColor }` | `changeStatus()` |

Note: Status changes already create a comment with `statusChangeFromId`/`statusChangeToId`.
The activity record is separate — the comment is user-facing content in the Comments tab,
the activity record is the audit entry in the Activity tab.

#### Merge Operations

| Type               | Trigger                       | Metadata                                  | Service Function |
| ------------------ | ----------------------------- | ----------------------------------------- | ---------------- |
| `post.merged_in`   | Post merged into this one     | `{ duplicatePostId, duplicatePostTitle }` | `mergePost()`    |
| `post.merged_away` | This post merged into another | `{ canonicalPostId, canonicalPostTitle }` | `mergePost()`    |
| `post.unmerged`    | Unmerge reversed              | `{ otherPostId, otherPostTitle }`         | `unmergePost()`  |

Both the canonical and duplicate posts get an activity record when a merge happens.
The canonical gets `post.merged_in`, the duplicate gets `post.merged_away`.

#### Owner Assignment

| Type               | Trigger           | Metadata                            | Service Function |
| ------------------ | ----------------- | ----------------------------------- | ---------------- |
| `owner.assigned`   | Owner set/changed | `{ ownerName, previousOwnerName? }` | `updatePost()`   |
| `owner.unassigned` | Owner removed     | `{ previousOwnerName }`             | `updatePost()`   |

#### Tags

| Type           | Trigger                | Metadata                 | Service Function   |
| -------------- | ---------------------- | ------------------------ | ------------------ |
| `tags.added`   | Tags added to post     | `{ tagNames: string[] }` | `updatePostTags()` |
| `tags.removed` | Tags removed from post | `{ tagNames: string[] }` | `updatePostTags()` |

We batch tag changes into a single activity record per operation (a user might add 3 tags
at once — that's one `tags.added` with `tagNames: ["bug", "urgent", "v3"]`).

#### Roadmap

| Type              | Trigger                   | Metadata          | Service Function          |
| ----------------- | ------------------------- | ----------------- | ------------------------- |
| `roadmap.added`   | Post added to roadmap     | `{ roadmapName }` | `addPostToRoadmap()`      |
| `roadmap.removed` | Post removed from roadmap | `{ roadmapName }` | `removePostFromRoadmap()` |

#### Comments Lock

| Type                | Trigger           | Metadata | Service Function       |
| ------------------- | ----------------- | -------- | ---------------------- |
| `comments.locked`   | Comments locked   | `{}`     | `toggleCommentsLock()` |
| `comments.unlocked` | Comments unlocked | `{}`     | `toggleCommentsLock()` |

#### Pinned Comment

| Type               | Trigger                             | Metadata        | Service Function |
| ------------------ | ----------------------------------- | --------------- | ---------------- |
| `comment.pinned`   | Comment pinned as official response | `{ commentId }` | `pinComment()`   |
| `comment.unpinned` | Pinned comment removed              | `{}`            | `unpinComment()` |

### Types NOT included (and why)

| Candidate                  | Why excluded                                                       |
| -------------------------- | ------------------------------------------------------------------ |
| Votes                      | Too high-volume, low signal. Votes table already tracks this.      |
| Comment creation           | Comments have their own tab. No need to duplicate in activity.     |
| Post edits                 | `postEditHistory` table already tracks these with full diffs.      |
| AI signal created/resolved | AI Insights panel handles this. Activity log is for human actions. |
| Embedding/summary updates  | System internals, not user-facing activity.                        |
| Moderation state           | Not currently used. Add when moderation feature ships.             |

---

## Service Layer: `activity.service.ts`

New domain service at `apps/web/src/lib/server/domains/activity/activity.service.ts`.

```typescript
type ActivityType =
  | 'post.created'
  | 'post.deleted'
  | 'post.restored'
  | 'status.changed'
  | 'post.merged_in'
  | 'post.merged_away'
  | 'post.unmerged'
  | 'owner.assigned'
  | 'owner.unassigned'
  | 'tags.added'
  | 'tags.removed'
  | 'roadmap.added'
  | 'roadmap.removed'
  | 'comments.locked'
  | 'comments.unlocked'
  | 'comment.pinned'
  | 'comment.unpinned'

interface CreateActivityOpts {
  postId: PostId
  principalId: PrincipalId | null
  type: ActivityType
  metadata?: Record<string, unknown>
}

export async function createActivity(opts: CreateActivityOpts): Promise<void>
export async function getActivityForPost(postId: PostId): Promise<ActivityRow[]>
```

`createActivity` is fire-and-forget — it should never throw or block the parent operation.
Wrap in try/catch with console.error fallback.

---

## Instrumentation Points

Each existing service function gets a `createActivity()` call added. The activity insert
happens AFTER the main operation succeeds (not in a transaction — activity is best-effort).

### Files to modify

| File                  | Function                  | Activity Type                                                                                                           |
| --------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `post.service.ts`     | `createPost()`            | `post.created`                                                                                                          |
| `post.service.ts`     | `updatePost()`            | `owner.assigned`, `owner.unassigned` (when ownerPrincipalId changes), `tags.added`, `tags.removed` (when tagIds change) |
| `post.status.ts`      | `changeStatus()`          | `status.changed`                                                                                                        |
| `post.merge.ts`       | `mergePost()`             | `post.merged_in` (on canonical), `post.merged_away` (on duplicate)                                                      |
| `post.merge.ts`       | `unmergePost()`           | `post.unmerged` (on both posts)                                                                                         |
| `post.permissions.ts` | `softDeletePost()`        | `post.deleted`                                                                                                          |
| `post.permissions.ts` | `restorePost()`           | `post.restored`                                                                                                         |
| `roadmap.service.ts`  | `addPostToRoadmap()`      | `roadmap.added`                                                                                                         |
| `roadmap.service.ts`  | `removePostFromRoadmap()` | `roadmap.removed`                                                                                                       |

### Server functions to modify (for comment lock, pin/unpin)

These operations currently live directly in server functions, not domain services:

| File                    | Function               | Activity Type                           |
| ----------------------- | ---------------------- | --------------------------------------- |
| `functions/posts.ts`    | `toggleCommentsLockFn` | `comments.locked` / `comments.unlocked` |
| `functions/comments.ts` | `pinCommentFn`         | `comment.pinned`                        |
| `functions/comments.ts` | `unpinCommentFn`       | `comment.unpinned`                      |

### Tag change detection

`updatePost()` receives the new tag set. To emit `tags.added` / `tags.removed`, we need
to compare old vs new tag IDs. The function already receives `tagIds` — we need to query
current tags before the update to compute the diff.

```
const currentTagIds = await getCurrentTagIds(postId)
const added = newTagIds.filter(id => !currentTagIds.includes(id))
const removed = currentTagIds.filter(id => !newTagIds.includes(id))
// ... perform update ...
if (added.length) createActivity({ type: 'tags.added', metadata: { tagNames: [...] } })
if (removed.length) createActivity({ type: 'tags.removed', metadata: { tagNames: [...] } })
```

### Owner change detection

Similarly, `updatePost()` receives `ownerPrincipalId`. Compare against current value:

```
if (newOwnerId !== currentOwnerId) {
  if (newOwnerId) createActivity({ type: 'owner.assigned', ... })
  else createActivity({ type: 'owner.unassigned', ... })
}
```

---

## UI: Comments / Activity Tabs

### Post Modal Changes

```
apps/web/src/components/admin/feedback/post-modal.tsx
  - Add tab state: 'comments' | 'activity' (default: 'comments')
  - Render tab bar above the comments/activity area
  - Comments tab: existing CommentsSection (unchanged)
  - Activity tab: new PostActivityTimeline component
```

### Tab bar design

```
22 Comments    Activity
──────────────────────────
```

Simple underline tabs. Activity tab gets a subtle count badge if desired, but count
is optional (activity entries are less actionable than comments).

### PostActivityTimeline Component

```
apps/web/src/components/admin/feedback/detail/post-activity-timeline.tsx (new)
```

Fetches activity for the post and renders a chronological list. Each entry shows:

```
[Icon] [Actor name] [verb description]        [time ago]
       [optional detail line / inline card]
```

#### Entry formatting by type

| Type                | Icon | Description                             | Detail                            |
| ------------------- | ---- | --------------------------------------- | --------------------------------- |
| `post.created`      | +    | **James** created this post             | —                                 |
| `status.changed`    | ○→   | **James** changed status                | [Open] → [In Progress] (badges)   |
| `post.merged_in`    | ↗    | **James** merged in a post              | Inline card: title, votes, author |
| `post.merged_away`  | ↗    | **James** merged this into another post | Link to canonical post            |
| `post.unmerged`     | ↩    | **James** unmerged a post               | Link to other post                |
| `owner.assigned`    | 👤   | **James** assigned **Sarah**            | —                                 |
| `owner.unassigned`  | 👤   | **James** removed assignee              | Previously: Sarah                 |
| `tags.added`        | 🏷   | **James** added tags                    | [bug] [urgent] (badges)           |
| `tags.removed`      | 🏷   | **James** removed tags                  | [bug] (badges)                    |
| `roadmap.added`     | 📋   | **James** added to roadmap              | General Roadmap                   |
| `roadmap.removed`   | 📋   | **James** removed from roadmap          | General Roadmap                   |
| `comments.locked`   | 🔒   | **James** locked comments               | —                                 |
| `comments.unlocked` | 🔓   | **James** unlocked comments             | —                                 |
| `post.deleted`      | 🗑   | **James** deleted this post             | —                                 |
| `post.restored`     | ↩    | **James** restored this post            | —                                 |
| `comment.pinned`    | 📌   | **James** pinned a response             | —                                 |
| `comment.unpinned`  | 📌   | **James** unpinned the response         | —                                 |

#### Merge event inline card

For `post.merged_in`, show an inline card (similar to current MergedPostsList style):

```
┌──────────────────────────────────────┐
│ Add product price discount           │
│ 1 vote · by Josh Knights             │
│                             [Unmerge] │
└──────────────────────────────────────┘
```

This replaces the current "Merged Feedback (N)" section entirely. The unmerge action
lives on the inline card's context menu or button.

### Server function for activity

```
apps/web/src/lib/server/functions/activity.ts (new)
  - getActivityForPostFn: fetches activity rows with principal names resolved
```

### Query hook

```
apps/web/src/lib/client/queries/activity.ts (new)
  - activityQueries.forPost(postId)
```

---

## Migration

### Drizzle schema addition

```
packages/db/src/schema/activity.ts (new)
  - postActivity table definition
  - Relations to posts and principal tables
```

### Migration

```
packages/db/drizzle/XXXX_post_activity.sql
  - CREATE TABLE post_activity
  - CREATE INDEX idx_post_activity_post_id
  - CREATE INDEX idx_post_activity_type
```

No backfill needed — we start recording from deployment forward. Posts created before
this feature will simply have no activity entries, which is fine.

---

## What Gets Removed

1. **MergedPostsList** (`merge-section.tsx`) — replaced by merge events in activity timeline
   with inline cards and unmerge actions
2. The "Merged Feedback (N)" section above comments — no longer needed

---

## Execution Order

```
Step 1: Schema + migration                        ~30 min
  - Create postActivity table in Drizzle schema
  - Generate and run migration

Step 2: Activity service                           ~30 min
  - createActivity() and getActivityForPost()
  - Fire-and-forget pattern with error handling

Step 3: Instrument service layer                   ~1-2 hours
  - Add createActivity() calls to all mutation paths
  - Tag/owner diff detection in updatePost()
  - Test each activity type fires correctly

Step 4: Server function + query hook               ~30 min
  - getActivityForPostFn with principal name resolution
  - activityQueries.forPost() query option

Step 5: Activity timeline UI                       ~1-2 hours
  - PostActivityTimeline component
  - Type-specific entry rendering
  - Merge event inline cards with unmerge

Step 6: Comments/Activity tabs in post modal       ~30 min
  - Tab state management
  - Swap CommentsSection / PostActivityTimeline based on active tab

Step 7: Remove MergedPostsList                     ~15 min
  - Delete the component
  - Remove from MergeActions
```

## Files Changed (Summary)

### New files

- `packages/db/src/schema/activity.ts` — table definition
- `apps/web/src/lib/server/domains/activity/activity.service.ts` — service
- `apps/web/src/lib/server/functions/activity.ts` — server function
- `apps/web/src/lib/client/queries/activity.ts` — query hook
- `apps/web/src/components/admin/feedback/detail/post-activity-timeline.tsx` — UI

### Modified files

- `packages/db/src/schema/index.ts` — export new table
- `apps/web/src/lib/server/domains/posts/post.service.ts` — instrument create/update
- `apps/web/src/lib/server/domains/posts/post.status.ts` — instrument status change
- `apps/web/src/lib/server/domains/posts/post.merge.ts` — instrument merge/unmerge
- `apps/web/src/lib/server/domains/posts/post.permissions.ts` — instrument delete/restore
- `apps/web/src/lib/server/domains/roadmaps/roadmap.service.ts` — instrument add/remove
- `apps/web/src/lib/server/functions/posts.ts` — instrument comments lock
- `apps/web/src/lib/server/functions/comments.ts` — instrument pin/unpin
- `apps/web/src/components/admin/feedback/post-modal.tsx` — add tabs
- `apps/web/src/components/admin/feedback/merge-section.tsx` — remove MergedPostsList

### No schema changes to existing tables

The `post_activity` table is fully additive. No existing columns or tables are modified.
