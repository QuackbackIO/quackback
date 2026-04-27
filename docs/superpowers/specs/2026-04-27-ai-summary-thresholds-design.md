# Threshold-gated AI Summaries

**Status**: Approved design
**Date**: 2026-04-27
**Area**: `apps/web/src/lib/server/domains/summary`

## Problem

Today, AI summaries are generated for every post on `post.created` and regenerated for every comment on `comment.created` whenever OpenAI is configured. Two problems:

1. **Cost**: Every post — including thin posts where the title is already a summary — incurs an LLM call. Every comment, including "+1" replies, triggers a full regen with the post + all prior comments + previous summary in the prompt. On active threads this produces a regen storm.
2. **UX**: Posts with no real discussion produce summaries that just paraphrase the title. The `AiSummaryCard` shows a "Summary is being generated…" placeholder for every post that doesn't have one yet, including thin posts that arguably shouldn't have a summary at all.

## Goals

- Skip generation for posts that don't yet have enough discussion to summarize meaningfully
- Avoid regenerating on every single comment when summaries already exist
- Hide the AI Summary UI entirely for posts below threshold, rather than showing a permanent "generating…" placeholder
- Keep the implementation small — no schema migration, gating logic centralized in one service

## Non-goals

- Comment-content-quality filtering (detecting "+1" / "thanks" replies as low-signal). Layer on later if needed.
- An on-demand "Regenerate summary now" admin button. Out of scope for this change.
- Backfill cleanup of summaries that exist on now-below-threshold posts. Leave them; they cost nothing to keep.
- Changes to other AI features (sentiment, embeddings, merge suggestions).

## Design

### Generation rules

A post is eligible for **initial generation** when:

- It has no existing `summaryJson`
- Its live count of non-team, non-deleted comments is ≥ 2

A post is eligible for a **refresh** when:

- It has an existing `summaryJson`
- `liveNonTeamCommentCount - summaryCommentCount ≥ 3`
- `now - summaryUpdatedAt ≥ 6 hours`

Both conditions of the refresh rule are combined with AND — a chatty thread that posts 9 comments in 30 minutes triggers at most one regen during that window.

Thresholds live as named constants near the top of `summary.service.ts` so they are easy to tune without hunting through query code:

```ts
const MIN_COMMENTS_FOR_INITIAL_SUMMARY = 2
const MIN_NEW_COMMENTS_FOR_REFRESH = 3
const MIN_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6h
```

### Where the gate lives

Gating moves into `summary.service.ts`. The event hook (`apps/web/src/lib/server/events/handlers/summary.ts`) keeps calling `generateAndSavePostSummary(postId)` unconditionally — it is no longer the hook's job to decide eligibility. This keeps a single source of truth for the rules: the event hook, the cron sweeper, and any future backfill scripts all funnel through the same gate.

`generateAndSavePostSummary` is restructured:

1. Fetch post (existing behavior, plus `summaryUpdatedAt`)
2. Fetch comments (existing behavior, but track non-team count separately)
3. Apply gate — if ineligible, log at debug and return early
4. Otherwise proceed with the existing LLM call + write path

A small helper expresses the gate so it can be unit-tested in isolation:

```ts
function reasonToSkipSummary(input: {
  hasExistingSummary: boolean
  liveNonTeamCommentCount: number
  summaryCommentCount: number | null
  summaryUpdatedAt: Date | null
}): string | null
```

Returns `null` when generation should proceed, or a short reason string (`"below-initial-threshold"`, `"below-refresh-comment-threshold"`, `"refresh-cooldown"`) for logging.

### Comment counting

Today, `summaryCommentCount` stores the total count of live comments at the time of the last summary. We switch it to store **non-team** live comment count. The signal we care about is "how much new user discussion has accumulated since the last summary"; team replies should not push toward a refresh.

This is a semantic shift, not a schema migration. Existing values will be slightly off until each post is next refreshed, at which point the value heals automatically. No backfill needed.

The persisted `summaryCommentCount` continues to drive sweep eligibility queries.

### Sweeper rewrite

`refreshStaleSummaries` currently uses `summaryCommentCount != liveCount`. This becomes a two-branch eligibility predicate matching the gate rules:

```sql
WHERE deletedAt IS NULL
  AND (
    -- Initial generation candidates
    (summary_json IS NULL AND non_team_comment_count >= 2)
    OR
    -- Refresh candidates
    (summary_json IS NOT NULL
     AND (non_team_comment_count - summary_comment_count) >= 3
     AND summary_updated_at < now() - interval '6 hours')
  )
```

The `liveCommentCountSq` subquery is rewritten to count non-team, non-deleted comments. Batch size, ordering, and the inter-batch sleep stay the same.

### UI

`ai-summary-card.tsx`: remove the `if (!summaryJson)` placeholder branch and return `null` instead. The card no longer announces its own absence.

The brief in-flight window after a post crosses the comment threshold — between the event firing and the LLM call returning — means an admin watching the post in real-time may see no card for ~1–3 seconds and then the card appears. This is acceptable; tracking an explicit "generating" status would require a new column or in-memory state and adds scope.

The current `aria-live`-style "Summary is being generated…" copy is removed. Any callers that conditionally rendered around `summaryJson` continue to work.

### Schema

No migration. The columns `summaryJson`, `summaryModel`, `summaryUpdatedAt`, and `summaryCommentCount` retain their shapes. Only the semantic meaning of `summaryCommentCount` changes from "total live comments" to "non-team live comments."

## Data flow

```
post.created event
  → summaryHook.run()
    → generateAndSavePostSummary(postId)
      → fetch post + comments
      → reasonToSkipSummary({ hasExistingSummary: false, liveNonTeamCommentCount: 0, ... })
        → returns "below-initial-threshold"
      → log debug + return  (no LLM call)

comment.created event (new post is now at 2 non-team comments)
  → summaryHook.run()
    → generateAndSavePostSummary(postId)
      → reasonToSkipSummary({ hasExistingSummary: false, liveNonTeamCommentCount: 2, ... })
        → returns null (eligible)
      → LLM call + write summary, summaryCommentCount=2, summaryUpdatedAt=now

comment.created event (3rd comment, 30 min later)
  → generateAndSavePostSummary(postId)
    → reasonToSkipSummary({ hasExistingSummary: true, live=3, stored=2, updatedAt=30min ago })
      → liveNonTeamCommentCount - summaryCommentCount = 1 < 3
      → returns "below-refresh-comment-threshold"
    → no LLM call

comment.created event (5th comment, 7 hours later)
  → generateAndSavePostSummary(postId)
    → reasonToSkipSummary({ live=5, stored=2, updatedAt=7h ago })
      → live - stored = 3 ≥ 3, time since refresh ≥ 6h, both conditions met
      → returns null (eligible)
    → LLM call + write
```

## Error handling

Existing behavior is preserved: any failure in the LLM call or DB write is logged but does not throw out of the hook (the hook already wraps `generateAndSavePostSummary` in a try/catch). The new gate logic is pure — it cannot fail at runtime in a meaningful way; an unexpected null is treated as "skip."

## Testing

Unit tests in `apps/web/src/lib/server/domains/summary/__tests__/summary.service.test.ts`. Following the project's TDD preference: write failing tests first, then update the service to make them pass.

Cases for `reasonToSkipSummary` (pure helper, easiest):

- Returns `"below-initial-threshold"` when 0 non-team comments and no existing summary
- Returns `"below-initial-threshold"` when 1 non-team comment and no existing summary
- Returns `null` when 2 non-team comments and no existing summary
- Returns `"below-refresh-comment-threshold"` when summary exists, only 2 new non-team comments
- Returns `"refresh-cooldown"` when summary exists, 5 new non-team comments, but only 1h since last refresh
- Returns `null` when summary exists, 3 new non-team comments, and >6h elapsed
- Team-only comments do not push counts toward eligibility (count of non-team comments is what feeds the helper)

Cases for `generateAndSavePostSummary` (integration, hits DB + mocked OpenAI):

- Below-threshold post: no LLM call, no DB write, `summaryJson` remains null
- Cross-threshold call: LLM call happens, row updated with new summary + `summaryCommentCount` reflects non-team count
- Refresh under cooldown: prior summary unchanged
- Refresh after cooldown + comment threshold: LLM called with previous summary in prompt, row updated

Cases for `refreshStaleSummaries`:

- Surfaces a post with 2 non-team comments and no summary
- Does not surface a post with 1 non-team comment
- Does not surface a post whose summary is current per refresh rules
- Surfaces a post with sufficient drift and elapsed time

UI: no new tests. Visual confirmation that the card is absent on a fresh thin post and appears after the 2nd non-team comment.

## Open risks

- **Hot-thread cooldown surprise**: A burst of 6 substantive comments in 4 hours produces zero refresh because the time gate has not opened. PMs viewing during that window see a slightly stale summary. Acceptable for v1; tunable via the constants if it becomes a complaint.
- **Existing thin-post summaries**: Posts that already have a summary but are below the new threshold are left as-is. They will not regenerate (since cooldown / drift gates fail) but the existing data stays visible. Aligns with the "don't destroy existing data" stance.
