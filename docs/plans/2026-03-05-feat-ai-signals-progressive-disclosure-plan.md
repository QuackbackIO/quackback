# Plan: AI Signals with Progressive Disclosure

**Date**: 2026-03-05
**Type**: Feature (Architecture)
**Status**: Draft

## Problem

User testing revealed that the Insights tab is hard to discover. Duplicate suggestions are
hidden behind a tab that users don't naturally visit - it's a "pull" model when the system
should "push" signals to users where they already work (the Inbox).

Beyond discoverability, the current architecture is tightly coupled to duplicates. As we add
more AI capabilities (sentiment detection, auto-categorization, trend analysis), each would
need its own page or tab, fragmenting the PM workflow further.

## Vision

Introduce **Signal** as a first-class primitive. Every AI capability produces signals that
surface through three layers of progressive disclosure:

| Layer | Where | What | Purpose |
|-------|-------|------|---------|
| L1: Badge | Post row in Inbox | Small indicator (e.g. "2 dupes", "Urgent") | Passive awareness while scanning |
| L2: Filter view | Inbox with signal filter active | Focused triage list for one signal type | Batch action workflow |
| L3: Detail panel | Post detail page | Full context, suggested actions | Deep review and decision-making |

This means users encounter AI insights at every level of their workflow without needing to
learn about a separate tab.

### How the layers work together

```
LAYER 1 - Inbox list (always visible)
Signals appear as small badges on posts the user is already scanning.

  +-----------------------------------------------------------------+
  |  Inbox  208                                                     |
  |                                                                 |
  |  Search...                       Newest  Oldest  Top Votes      |
  |  + Add filter                                                   |
  |                                                                 |
  |  +- AI Signals -------------------------------------------------+
  |  | ** 12 duplicates  -  3 urgent  -  8 uncategorized            |
  |  +--------------------------------------------------------------+
  |                                                                 |
  | +-------------------------------------------------------------+ |
  | | ^  Open                             [2 duplicates] [Urgent] | |
  | | 7  Bulk order import                                        | |
  | |    We need a way to import orders from CSV...               | |
  | |    3 posts this week - Products - 2 days ago                | |
  | +-------------------------------------------------------------+ |
  | | ^  Open                                       [Frustrated]  | |
  | | 1  App crashes during stock take                            | |
  | |    This is the third time this week our warehouse...        | |
  | |    Alex Chen / BigRetail - 1 hour ago                       | |
  | +-------------------------------------------------------------+ |
  | | ^  NEW                          [Suggest: "Listings"]       | |
  | | 0  Add barcode scanning to listings                         | |
  | |    Would save us hours per day on inventory...              | |
  | |    Jamie / WarehouseCo - 30 min ago                         | |
  | +-------------------------------------------------------------+ |
  | | ^  Open                          [2 duplicates] [Draft]     | |
  | | 5  Credit Notes automation                                  | |
  | |    Make credit notes when an order is returned...           | |
  | |    Sam Quinn - 3 months ago                                 | |
  | +-------------------------------------------------------------+ |
  +-----------------------------------------------------------------+


LAYER 2 - Click a signal count to filter (e.g. "12 duplicates")
The inbox switches to a focused triage view for that signal type.

  +-----------------------------------------------------------------+
  |  Inbox  208        Showing: ** Duplicates (12)       [Clear x]  |
  |                                                                 |
  | +-------------------------------------------------------------+ |
  | | Possible duplicate                    less than a minute ago | |
  | |                                                             | |
  | | Both requests seek to improve pickwave sorting...           | |
  | | +--------------+    +--------- MERGED RESULT ----------+   | |
  | | | ^  - Closed   |    | ^                                |   | |
  | | | 4  Filter pick |    | 6  Filter pickwave by 2...      |   | |
  | | |    wave by 2.. | -> |    - Warehouse - 2 comments     |   | |
  | | +--------------+    +-----------------------------------+   | |
  | | | ^  - Duplicate |                                          | |
  | | | 2  pickwave in |             [Merge]  [Dismiss]           | |
  | | |    order       |                                          | |
  | | +--------------+                                            | |
  | +-------------------------------------------------------------+ |
  | | Possible duplicate                    less than a minute ago | |
  | |                                                             | |
  | | Both posts request stock takes within the system...         | |
  | | +--------------+    +--------- MERGED RESULT ----------+   | |
  | | | ^  - Complete  |    | ^                                |   | |
  | | | 5  Stock Take  |    | 6  Stock Take built into...     |   | |
  | | |    built into  | -> |    - Products - 2 comments      |   | |
  | | +--------------+    +-----------------------------------+   | |
  | | | ^  - Complete  |                                          | |
  | | | 1  Stock check |             [Merge]  [Dismiss]           | |
  | | |    with app    |                                          | |
  | | +--------------+                                            | |
  | +-------------------------------------------------------------+ |
  +-----------------------------------------------------------------+


LAYER 3 - Post detail page
All signals for this post shown in an "AI Insights" panel.

  +-----------------------------------------------------------------+
  |  <- Back                                                        |
  |                                                                 |
  |  ^  Open - Trending                                             |
  |  7  Bulk order import                                           |
  |     We need a way to import orders from CSV files directly...   |
  |     Orders - 2 days ago - 4 comments                            |
  |                                                                 |
  |  -- AI Insights -----------------------------------------------  |
  |  |                                                             | |
  |  |  Trend: 3 similar posts in the last 7 days                 | |
  |  |     __..__|__|..__..___..__.._                              | |
  |  |                                                             | |
  |  |  Similar Posts                                              | |
  |  |     87% - "CSV import for purchase orders" - ^ 3  [Merge]  | |
  |  |     71% - "Batch upload product listings" - ^ 2   [Merge]  | |
  |  |                                                             | |
  |  |  Segment: 4 of 7 voters are Enterprise accounts            | |
  |  |                                                             | |
  |  |  Suggested Response                          [Edit Draft]  | |
  |  |  "Thanks for this suggestion! We've heard from several..."  | |
  |  |                                                             | |
  |  +-------------------------------------------------------------+ |
  |                                                                 |
  |  -- Comments ---------------------------------------------------  |
  |  ...                                                            |
  +-----------------------------------------------------------------+
```

### Signals framework

The same 3-layer pattern generalizes to every AI capability:

```
  Every AI capability produces "signals" that surface at 3 layers:

    Layer 1 (Badge)    -> Tiny indicator on the post in the list
    Layer 2 (Filter)   -> Focused view to batch-act on that signal type
    Layer 3 (Detail)   -> Full context when viewing a single post
```

```
  +-------------------+--------------+-------------------+------------------+
  | Capability        | L1: Badge    | L2: Filter View   | L3: Detail Panel |
  +-------------------+--------------+-------------------+------------------+
  | Duplicates        | "2 dupes"    | All dupe pairs     | Similar posts    |
  | Sentiment         | Urgent       | Frustrated posts   | Sentiment score  |
  | Auto-categorize   | "Suggest"    | Uncategorized      | Suggested board  |
  | Themes            | Theme tag    | Posts by theme     | Related in theme |
  | Trends            | Trending     | Trending topics    | Trend graph      |
  | Summaries         | (on detail)  | --                 | AI summary       |
  | Response draft    | "Draft"      | Needs response     | Suggested reply  |
  +-------------------+--------------+-------------------+------------------+
```

## Signal Types (Current and Future)

### Phase 1 - Duplicates (refactor existing)
- **L1 Badge**: "2 duplicates" chip on post row
- **L2 Filter**: "Duplicates (12)" filter shows suggestion pairs with merge/dismiss
- **L3 Detail**: "Similar Posts" section on post detail with match scores

### Phase 2 - Sentiment & Urgency
- **L1 Badge**: Red "Urgent" or "Frustrated" indicator
- **L2 Filter**: "Urgent (3)" shows frustrated/high-priority posts with AI summary
- **L3 Detail**: Sentiment score, frustration signals, suggested response draft
- **Detection**: Classify sentiment during embedding pipeline (same async flow as dupes)

### Phase 3 - Auto-categorization
- **L1 Badge**: "Suggest: Listings" chip on uncategorized posts
- **L2 Filter**: "Uncategorized (8)" shows posts needing board/status assignment
- **L3 Detail**: Suggested board + status with accept/override
- **Detection**: Run on new posts that have no board assigned

### Phase 4 - Trends & Themes
- **L1 Badge**: "Trending" indicator when a topic has velocity
- **L2 Filter**: "Trending (5)" shows topics with recent acceleration
- **L3 Detail**: Sparkline chart, related posts in same theme cluster
- **Detection**: Periodic sweep comparing theme volume vs historical baseline

### Phase 5 - Response Drafts & Changelog
- **L1 Badge**: "Draft ready" on posts with shipped status and no response
- **L2 Filter**: "Needs response (14)" shows posts awaiting follow-up
- **L3 Detail**: AI-drafted response, one-click send
- **Detection**: Trigger on status change to "Complete" or "Closed"

## Data Model

### New: `signals` table

A unified table for all AI-generated signals. Replaces the Insights tab as the source of
truth and sits alongside the existing `merge_suggestions` table (which remains for merge-
specific data like scores and LLM reasoning).

```sql
CREATE TABLE signals (
  id          typeid PRIMARY KEY DEFAULT typeid('signal'),
  -- What kind of signal
  type        text NOT NULL,  -- 'duplicate', 'sentiment', 'categorize', 'trend', 'response_draft'
  severity    text NOT NULL DEFAULT 'info',  -- 'info', 'warning', 'urgent'
  -- What post it relates to
  post_id     typeid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  -- Type-specific payload (flexible JSON)
  payload     jsonb NOT NULL DEFAULT '{}',
  -- Lifecycle
  status      text NOT NULL DEFAULT 'pending',  -- 'pending', 'accepted', 'dismissed', 'expired'
  resolved_at timestamptz,
  resolved_by typeid REFERENCES principal(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX signals_post_id_idx ON signals(post_id);
CREATE INDEX signals_type_status_idx ON signals(type, status);
CREATE INDEX signals_severity_idx ON signals(severity) WHERE status = 'pending';
```

### Payload examples by type

```jsonc
// duplicate
{
  "mergeSuggestionId": "merge_sug_...",  // FK to merge_suggestions for full detail
  "matchedPostId": "post_...",
  "confidence": 0.87
}

// sentiment
{
  "score": -0.8,          // -1 (very negative) to 1 (very positive)
  "label": "frustrated",  // human-readable
  "keywords": ["broken", "third time", "switching"]
}

// categorize
{
  "suggestedBoardId": "board_...",
  "suggestedBoardName": "Listings",
  "confidence": 0.91
}

// trend
{
  "themeId": "theme_...",
  "themeName": "Bulk import",
  "velocity": 3,           // posts in last 7 days
  "baseline": 0.5          // avg posts per week historically
}

// response_draft
{
  "draft": "Thanks for this suggestion! We've shipped...",
  "trigger": "status_change",  // what caused the draft
  "statusChangedTo": "complete"
}
```

### Relationship to `merge_suggestions`

The `signals` table does NOT replace `merge_suggestions`. Instead:

- `merge_suggestions` remains the authoritative store for duplicate-specific data (vector
  scores, FTS scores, LLM reasoning, source/target post pairs)
- A `signal` row of type `"duplicate"` is created alongside each pending merge suggestion,
  pointing to the post and referencing the merge suggestion ID in its payload
- When a merge suggestion is accepted/dismissed, the corresponding signal is also resolved
- This avoids a risky migration of existing data while giving duplicates a unified surface

Over time, if we add more signal types that need rich type-specific storage (like a future
`auto_categorization_suggestions` table), the same pattern applies: detailed table + thin
signal row for unified surfacing.

### Architecture flow

```
  +-----------------------------------------------+
  |              AI Pipeline                       |
  |                                                |
  |  Feedback --> Embedding --> Analyzers ---+      |
  |                             |  |  |     |      |
  |                       Dupes Sent Theme  |      |
  |                             |  |  |     |      |
  |                             v  v  v     |      |
  |                          +----------+   |      |
  |                          | Signals  | <-+      |
  |                          |  Table   |          |
  |                          +----+-----+          |
  |                               |                |
  +-------------------------------+----------------+
                                  |
                      +-----------+-----------+
                      v           v           v
                 L1: Badge   L2: Filter   L3: Detail
```

## UI Architecture

### L1: Signal Badges on Post Rows

**Files to modify**:
- `apps/web/src/components/admin/feedback/inbox-post-row.tsx` (or equivalent post row component)

Add a `<SignalBadges postId={post.id} />` component that renders small chips. Data comes
from a `signalsByPostId` map hydrated in the inbox query (a single JOIN, not N+1).

```
┌───────────────────────────────────────────────────────────────┐
│ ^ Open                                  [2 duplicates] [Urgent] │
│ 7 Bulk order import                                           │
│   We need a way to import orders from CSV...                  │
│   Products - 2 days ago                                        │
└───────────────────────────────────────────────────────────────┘
```

Badges are interactive - clicking one navigates to L2 filter for that signal type.

### L2: Signal Filter in Inbox

**Files to modify**:
- `apps/web/src/routes/admin/feedback.index.tsx` - add `signal` search param
- `apps/web/src/components/admin/feedback/inbox-container.tsx` - render signal bar + filtered view

Add a signal summary bar above the post list:

```
┌─ AI Signals ──────────────────────────────────────────────┐
│ 12 duplicates - 3 urgent - 8 uncategorized                │
└───────────────────────────────────────────────────────────┘
```

Each count is clickable and sets a `?signal=duplicate` (or `sentiment`, etc.) search param.
When a signal filter is active, the list switches to the appropriate triage view:

- **Duplicates**: Reuse existing `SuggestionTriageRow` component (from the Insights tab)
- **Sentiment**: Post rows sorted by severity with AI summary inline
- **Categorize**: Post rows with suggested board chip + accept/dismiss buttons

This replaces the Insights tab. The Insights route (`/admin/feedback/insights`) redirects
to `/admin/feedback/?signal=duplicate` for backwards compatibility.

### L3: Signal Panel on Post Detail

**Files to modify**:
- `apps/web/src/routes/admin/feedback.$postId.tsx` (or post detail component)

Add an "AI Insights" section below the post content, before comments. Only renders if the
post has pending signals.

```
── AI Insights ────────────────────────────────────────────
  Similar Posts
    87% - "CSV import for purchase orders" - ^ 3   [Merge]
    71% - "Batch upload product listings" - ^ 2    [Merge]

  Suggested Board: "Import/Export"              [Accept] [X]
────────────────────────────────────────────────────────────
```

### Signal Summary Query

A new server function `getSignalSummary()` returns counts by type for the signal bar:

```ts
// Returns: { duplicate: 12, sentiment: 3, categorize: 8, trend: 2 }
const summary = await db
  .select({ type: signals.type, count: count() })
  .from(signals)
  .where(eq(signals.status, 'pending'))
  .groupBy(signals.type)
```

This query is cheap (indexed on `type, status`) and cached at the React Query level with
a 30-second stale time.

### Signals for Post Query

For L1 badges, the inbox posts query is extended with a LEFT JOIN:

```ts
// Append to existing inbox query
const postSignals = await db
  .select({
    postId: signals.postId,
    type: signals.type,
    severity: signals.severity,
    count: count(),
  })
  .from(signals)
  .where(
    and(
      eq(signals.status, 'pending'),
      inArray(signals.postId, postIds)  // only for posts on current page
    )
  )
  .groupBy(signals.postId, signals.type, signals.severity)
```

This is a single query batched for the page of posts, not N+1.

## Signal Lifecycle

```
┌──────────────┐
│ AI Pipeline  │  (embedding, classification, sweep jobs)
│ creates      │
│ signal       │
└──────┬───────┘
       │
       v
┌──────────────┐     User clicks     ┌──────────────┐
│   pending    │ ──── "Accept" ────> │   accepted   │
│              │                      └──────────────┘
│              │     User clicks     ┌──────────────┐
│              │ ──── "Dismiss" ───> │  dismissed   │
│              │                      └──────────────┘
│              │     30-day TTL      ┌──────────────┐
│              │ ──── (sweep job) ──>│   expired    │
└──────────────┘                      └──────────────┘
```

- **Accept**: Triggers type-specific action (merge for duplicates, assign board for
  categorize, send response for drafts). Marks signal as accepted.
- **Dismiss**: No action, signal hidden from UI. Useful for false positives.
- **Expire**: Periodic sweep expires stale pending signals (mirrors existing
  `expireStaleMergeSuggestions()` pattern).

## Signal Producer Pattern

Each AI capability registers a producer function:

```ts
// Example: duplicate signal producer (wraps existing merge-check pipeline)
async function produceDuplicateSignals(postId: PostId) {
  const suggestion = await checkPostForMergeCandidates(postId)
  if (suggestion) {
    await createSignal({
      type: 'duplicate',
      severity: 'info',
      postId: suggestion.targetPostId,
      payload: {
        mergeSuggestionId: suggestion.id,
        matchedPostId: suggestion.sourcePostId,
        confidence: suggestion.llmConfidence,
      },
    })
  }
}
```

New AI capabilities follow the same pattern:
1. Analyze the post (LLM call, embedding lookup, heuristic, etc.)
2. If actionable, call `createSignal()` with the appropriate type and payload
3. The UI picks it up automatically through the unified query

## Implementation Sequence

### Step 1: Signal table + basic service (backend foundation)
| File | Change |
|------|--------|
| `packages/db/src/schema/signals.ts` | New schema file for `signals` table |
| `packages/db/src/schema/index.ts` | Export new schema |
| `packages/db/drizzle/XXXX_signals.sql` | Migration |
| `apps/web/src/lib/server/domains/signals/signal.service.ts` | CRUD: create, resolve, expire, query by post, query summary |

### Step 2: Bridge duplicates to signals (wire existing feature)
| File | Change |
|------|--------|
| `apps/web/src/lib/server/domains/merge-suggestions/merge-check.service.ts` | After creating merge suggestion, also create a `duplicate` signal |
| `apps/web/src/lib/server/domains/merge-suggestions/merge-suggestion.service.ts` | On accept/dismiss, also resolve corresponding signal |
| One-off script or migration | Backfill signals for existing pending merge suggestions |

### Step 3: L1 - Signal badges on inbox post rows
| File | Change |
|------|--------|
| `apps/web/src/lib/server/functions/feedback.ts` | Extend inbox query to include signal counts per post |
| `apps/web/src/components/admin/feedback/signal-badges.tsx` | New component: renders chips by type |
| `apps/web/src/components/admin/feedback/inbox-post-row.tsx` | Render `<SignalBadges>` |

### Step 4: L2 - Signal filter view in inbox
| File | Change |
|------|--------|
| `apps/web/src/routes/admin/feedback.index.tsx` | Add `signal` search param |
| `apps/web/src/components/admin/feedback/inbox-container.tsx` | Signal summary bar + conditional triage view |
| `apps/web/src/components/admin/feedback/signal-filter-bar.tsx` | New component: clickable signal type counts |
| `apps/web/src/routes/admin/feedback.insights.tsx` | Redirect to `?signal=duplicate` |

### Step 5: L3 - Signal panel on post detail
| File | Change |
|------|--------|
| Post detail route/component | Add "AI Insights" section with signals for this post |
| Reuse `merge-preview-modal.tsx` | Trigger from L3 duplicate signals |

### Step 6: Remove Insights tab
| File | Change |
|------|--------|
| `apps/web/src/routes/admin/feedback.tsx` (parent layout) | Remove Insights tab from nav |
| `apps/web/src/routes/admin/feedback.insights.tsx` | Keep as redirect only |
| Suggestions components | Reuse within L2 filter view, remove standalone page wrapper |

## What We're NOT Doing

- **No new AI capabilities in this plan**: This plan builds the signal infrastructure and
  migrates duplicates onto it. Sentiment, categorization, trends, and response drafts are
  future work that plugs into this framework.
- **No `merge_suggestions` migration**: The existing table stays. Signals reference it via
  payload. This avoids a risky data migration and keeps merge-specific queries fast.
- **No real-time push (WebSocket/SSE)**: Signals appear on next page load or React Query
  refetch. Real-time push is a future enhancement.
- **No per-user signal preferences**: All signals show to all team members. Per-user
  muting/snoozing is future work.
- **No signal aggregation across org**: Signals are per-post. Org-level dashboards
  ("your feedback health score") are a separate feature.

## Risks

- **Query performance**: The signal badges query adds a JOIN to every inbox page load.
  Mitigated by: indexed on `(post_id, status)`, batched for current page only (not all
  posts), cached at React Query level.
- **Badge noise**: Too many badges per post could clutter the inbox. Mitigated by: max 2
  badges shown per row, overflow as "+2 more" tooltip. Severity-based priority (urgent
  badges always shown first).
- **Signal/suggestion drift**: If a merge suggestion is resolved outside the signal flow
  (e.g. direct DB edit, future API), signals could get stale. Mitigated by: expiry sweep
  + defensive checks in the UI that verify the underlying suggestion still exists.
- **Backfill complexity**: Existing pending merge suggestions need corresponding signal
  rows. This is a simple INSERT...SELECT, but should be tested on a staging copy first.

## Success Criteria

- Users discover duplicate suggestions without being told about the Insights tab
- Time to first merge action decreases (no tab-hunting)
- Adding a new signal type (Phase 2+) requires only: a producer function, a payload type,
  and a badge/detail renderer - no new routes, pages, or navigation changes
