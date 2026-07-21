/**
 * Copilot usage + outcome reporting (P2-D.2): questions asked, transforms run
 * (per kind), on-demand summaries generated, the propose-approve-execute
 * actions funnel, and the insert/feedback outcomes, over a date range — the
 * fifth independent bounded scan on the assistant admin page (plus a sixth,
 * see below), alongside SupportPerformanceCard, QuinnPerformanceCard,
 * QuinnToolsCard, and GuidanceRulesCard. Consolidating these into a rollup
 * table (the analytics_daily_stats pattern) is deliberately deferred until
 * admin-page latency actually hurts: every one of them is a window-bounded
 * scan riding an index, the same "low volume, no rollup" call
 * quinn-performance.ts and quinn-tools.ts already made.
 *
 * Data sources:
 *  - `ai_usage_log` rows with `pipelineStep: 'assistant'` and
 *    `metadata.surface: 'copilot'` are questions asked through the Copilot
 *    Q&A sidebar (assistant.runtime.ts's `runAssistantTurn`, called from
 *    routes/api/admin/assistant/copilot.ts). `metadata.principalId` (also
 *    added there) attributes a turn to the asking teammate for the
 *    per-teammate breakdown; older rows logged before that field existed
 *    simply carry no `principalId` key and are excluded from that breakdown
 *    (same graceful-absence handling guidance-stats.ts uses for
 *    `guidanceRuleIds`).
 *  - `ai_usage_log` rows with `pipelineStep: 'copilot_transform'` are
 *    tone/format rewrites (copilot-transform.ts's `runCopilotTransform`),
 *    with `metadata.transform` already carrying the transform kind.
 *  - `ai_usage_log` rows with `pipelineStep: 'copilot_summary'` are the
 *    retired composer "Summarize into note" action's on-demand calls —
 *    historical rows only. Its replacement (the Copilot panel's Summarize
 *    quick action) runs as a normal copilot turn, so it counts under the
 *    questions-asked bucket above; nothing writes this step anymore.
 *  - `assistant_events` rows are the outcome events the panel fires when a
 *    teammate actually USES an answer (recordCopilotEventFn,
 *    functions/copilot-events.ts): the `*_inserted` kinds (`answer_inserted`
 *    / `transform_inserted` / `summary_inserted` — derived here from
 *    COPILOT_EVENT_TYPES, never hand-listed) mark text landing in the
 *    composer, with `metadata.destination` ('reply' | 'note') saying WHERE it
 *    landed — the kind and the destination are orthogonal axes, split
 *    independently below (one insert vocabulary, one rate). `feedback` rows
 *    carry a `metadata.rating` of 'up'/'down' (an optional `metadata.reason`
 *    on a down-vote). These are fire-and-forget client events with no
 *    idempotency, so a double-click double-counts — the same trend-level
 *    precision the retry note below already accepts.
 *  - `assistant_pending_actions` rows are the act-on-approval funnel
 *    (pending-actions.service.ts): every proposal in range counts toward
 *    `actionsProposed`; `actionsApproved` counts a proposal as approved for
 *    the lifetime of that decision even after it later settles into
 *    `executed`/`failed` (only an `approved` row can reach either — see
 *    `settleApprovedAction`), since the report cares whether a human said
 *    yes, not whether the tool call that followed happened to succeed.
 *
 * Multiple attempts of the SAME logical turn (a synthesis retry) each log
 * their own `ai_usage_log` row, so a turn that needed a retry is counted more
 * than once here — the same granularity guidance-stats.ts already accepts for
 * its "used" count, rather than a new precision this report invents.
 *
 * Indexes ridden: `ai_usage_log_step_idx` (pipelineStep) and
 * `ai_usage_log_created_idx` (createdAt) for every ai_usage_log query here
 * (the metadata->>'surface'/'transform'/'principalId' filters aren't
 * indexed and run as a Filter over whichever the planner picks — the same
 * shape guidance-stats.ts's own bounded scan already accepts); the new
 * `assistant_pending_actions_proposed_at_idx` (migration 0174) for the
 * actions-funnel scan, added because that table previously had no plain
 * `proposed_at` index at all; and `assistant_events_event_type_created_at_idx`
 * (migration 0189) for the sixth scan, the outcomes bucket — its WHERE names
 * the exact event types alongside the created_at range so the composite
 * index's leading column is usable (the metadata->>'rating'/'reason' feedback
 * splits are FILTER clauses over those rows, unindexed like the other
 * metadata filters here).
 */
import {
  db,
  and,
  eq,
  gte,
  inArray,
  lt,
  sql,
  aiUsageLog,
  assistantEvents,
  assistantPendingActions,
} from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { loadAuthors } from '@/lib/server/domains/principals/principal-display'
import { COPILOT_EVENT_TYPES } from '@/lib/shared/assistant/copilot-contract'
import { ratePctOrNull } from '@/lib/shared/percent'

/** Cap on the per-teammate leaderboard — a glance-level card, not a full report. */
const TOP_TEAMMATES_LIMIT = 10

/** The `*_inserted` event kinds, derived from the shared vocabulary (never
 *  hand-listed) so a new insert kind is counted here the day the contract
 *  grows it. Derived by the same suffix rule the server fn's zod uses to
 *  require a destination, so the write path and this report can never
 *  disagree about what counts as an insert. */
const INSERT_EVENT_TYPES = COPILOT_EVENT_TYPES.filter((t) => t.endsWith('_inserted'))

export interface CopilotTransformKindCount {
  /** Raw `metadata.transform` value (a `TransformKind`, kept as a string here
   *  so a legacy/unrecognized value is still reported rather than dropped). */
  transform: string
  count: number
}

export interface CopilotTeammateQuestionCount {
  principalId: PrincipalId
  displayName: string | null
  questions: number
}

export interface CopilotUsageMetrics {
  /** Copilot Q&A turns asked in the range (ai_usage_log, surface: copilot). */
  totalQuestions: number
  /** Tone/format transforms run in the range. */
  totalTransforms: number
  /** Per-kind breakdown of totalTransforms (my_tone, more_friendly, ...). */
  transformsByKind: CopilotTransformKindCount[]
  /** On-demand "Summarize" chip calls in the range. */
  totalSummaries: number
  /** Write-tool proposals opened in the range, any current status. */
  actionsProposed: number
  /** Of those, the ones a teammate approved (including ones since executed or failed). */
  actionsApproved: number
  /** Of those, the ones a teammate rejected. */
  actionsRejected: number
  /** Of those, the ones nobody decided before the TTL swept them. */
  actionsExpired: number
  /** actionsApproved / actionsProposed, 0-100; null (never NaN) when nothing was proposed. */
  approvalRate: number | null
  /** Q&A answers inserted (`answer_inserted` events), either destination. */
  answersInserted: number
  /** Transform results inserted (`transform_inserted` events), either destination. */
  transformsInserted: number
  /** On-demand summaries inserted (`summary_inserted` events), either destination. */
  summariesInserted: number
  /** All inserted events in range — every `*_inserted` kind, counted in SQL
   *  off the same derived `INSERT_EVENT_TYPES` list, and `insertRate`'s
   *  numerator below. Exposed so the usage card can render the total without
   *  re-summing the per-kind fields (the drift this module's SQL already
   *  refuses to risk). */
  totalInserted: number
  /** Inserted events of ANY kind whose destination was the customer-facing
   *  reply composer (metadata.destination = 'reply'). */
  insertedReplies: number
  /** Inserted events of ANY kind whose destination was an internal note
   *  (metadata.destination = 'note'). */
  insertedNotes: number
  /** All inserted events (every `*_inserted` kind) / totalQuestions, 0-100;
   *  null when nothing was asked. Trend-level: the numerator includes
   *  transform and summary inserts (neither of which is itself a question
   *  asked), so a heavy transform week can push this over 100. */
  insertRate: number | null
  /** Thumbs-up feedback events on Copilot answers in the range. */
  feedbackUp: number
  /** Thumbs-down feedback events on Copilot answers in the range. */
  feedbackDown: number
  /** Of feedbackDown, how many carried a written reason worth reviewing. */
  feedbackDownWithReason: number
  /** Top teammates by question volume, most first, capped at 10. */
  perTeammate: CopilotTeammateQuestionCount[]
}

interface PendingActionBucketRow {
  total: number
  approved: number
  rejected: number
  expired: number
}

interface AssistantEventBucketRow {
  /** All `INSERT_EVENT_TYPES` rows in range — `insertRate`'s numerator,
   *  counted by the derived list in SQL so it can't drift from the per-kind
   *  breakdowns when the vocabulary grows. */
  totalInserted: number
  answersInserted: number
  transformsInserted: number
  summariesInserted: number
  insertedReplies: number
  insertedNotes: number
  feedbackUp: number
  feedbackDown: number
  feedbackDownWithReason: number
}

/**
 * Fold the independently-queried aggregates into the final report shape.
 * Pure — the date-bounded SQL lives in `getCopilotUsageMetrics` below; this is
 * what's unit-tested directly for the rate math and the transform total.
 */
export function summarizeCopilotUsage(
  totalQuestions: number,
  transformsByKind: CopilotTransformKindCount[],
  totalSummaries: number,
  actionBucket: PendingActionBucketRow,
  eventBucket: AssistantEventBucketRow,
  perTeammate: CopilotTeammateQuestionCount[]
): CopilotUsageMetrics {
  const totalTransforms = transformsByKind.reduce((sum, row) => sum + row.count, 0)
  return {
    totalQuestions,
    totalTransforms,
    transformsByKind,
    totalSummaries,
    actionsProposed: actionBucket.total,
    actionsApproved: actionBucket.approved,
    actionsRejected: actionBucket.rejected,
    actionsExpired: actionBucket.expired,
    approvalRate: ratePctOrNull(actionBucket.approved, actionBucket.total),
    answersInserted: eventBucket.answersInserted,
    transformsInserted: eventBucket.transformsInserted,
    summariesInserted: eventBucket.summariesInserted,
    totalInserted: eventBucket.totalInserted,
    insertedReplies: eventBucket.insertedReplies,
    insertedNotes: eventBucket.insertedNotes,
    insertRate: ratePctOrNull(eventBucket.totalInserted, totalQuestions),
    feedbackUp: eventBucket.feedbackUp,
    feedbackDown: eventBucket.feedbackDown,
    feedbackDownWithReason: eventBucket.feedbackDownWithReason,
    perTeammate,
  }
}

/** `metadata->>'surface' = 'copilot'` for an aiUsageLog row — the one signal
 *  that distinguishes a Copilot Q&A turn from every other assistant surface. */
const isCopilotSurface = sql`${aiUsageLog.metadata}->>'surface' = 'copilot'`

/**
 * Query + summarize Copilot usage over [from, to). Six independent scans
 * (questions count, transforms grouped by kind, summaries count, pending
 * actions grouped by outcome bucket, insert/feedback outcome events bucket,
 * per-teammate top 10) run in parallel; see this module's doc comment for the
 * indexes each rides.
 */
export async function getCopilotUsageMetrics(from: Date, to: Date): Promise<CopilotUsageMetrics> {
  // Every ai_usage_log query below bounds on this same [from, to) window;
  // computed once since the column and range never vary across them.
  const usageLogInRange = and(gte(aiUsageLog.createdAt, from), lt(aiUsageLog.createdAt, to))

  const [questionsRows, transformRows, summariesRows, actionRows, eventRows, teammateRows] =
    await Promise.all([
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(aiUsageLog)
        .where(and(eq(aiUsageLog.pipelineStep, 'assistant'), isCopilotSurface, usageLogInRange)),

      db
        .select({
          transform: sql<string>`metadata->>'transform'`,
          n: sql<number>`count(*)::int`,
        })
        .from(aiUsageLog)
        .where(
          and(
            eq(aiUsageLog.pipelineStep, 'copilot_transform'),
            sql`metadata->>'transform' IS NOT NULL`,
            usageLogInRange
          )
        )
        .groupBy(sql`metadata->>'transform'`),

      db
        .select({ n: sql<number>`count(*)::int` })
        .from(aiUsageLog)
        .where(and(eq(aiUsageLog.pipelineStep, 'copilot_summary'), usageLogInRange)),

      db
        .select({
          total: sql<number>`count(*)::int`,
          approved: sql<number>`count(*) filter (where ${assistantPendingActions.status} in ('approved','executed','failed'))::int`,
          rejected: sql<number>`count(*) filter (where ${assistantPendingActions.status} = 'rejected')::int`,
          expired: sql<number>`count(*) filter (where ${assistantPendingActions.status} = 'expired')::int`,
        })
        .from(assistantPendingActions)
        .where(
          and(
            gte(assistantPendingActions.proposedAt, from),
            lt(assistantPendingActions.proposedAt, to)
          )
        ),

      // The outcomes bucket (sixth scan): per-kind inserted counts, the
      // destination (reply vs note) split across every inserted kind, and the
      // feedback rating split — one pass over assistant_events. The WHERE
      // names the contract's event types (COPILOT_EVENT_TYPES, never a
      // hand-written list) so the (event_type, created_at) index serves the
      // range; the destination/rating/reason splits are FILTERs over those rows.
      db
        .select({
          answersInserted: sql<number>`count(*) filter (where ${assistantEvents.eventType} = 'answer_inserted')::int`,
          transformsInserted: sql<number>`count(*) filter (where ${assistantEvents.eventType} = 'transform_inserted')::int`,
          summariesInserted: sql<number>`count(*) filter (where ${assistantEvents.eventType} = 'summary_inserted')::int`,
          totalInserted: sql<number>`count(*) filter (where ${inArray(assistantEvents.eventType, [...INSERT_EVENT_TYPES])})::int`,
          insertedReplies: sql<number>`count(*) filter (where ${inArray(assistantEvents.eventType, [...INSERT_EVENT_TYPES])} and metadata->>'destination' = 'reply')::int`,
          insertedNotes: sql<number>`count(*) filter (where ${inArray(assistantEvents.eventType, [...INSERT_EVENT_TYPES])} and metadata->>'destination' = 'note')::int`,
          feedbackUp: sql<number>`count(*) filter (where ${assistantEvents.eventType} = 'feedback' and metadata->>'rating' = 'up')::int`,
          feedbackDown: sql<number>`count(*) filter (where ${assistantEvents.eventType} = 'feedback' and metadata->>'rating' = 'down')::int`,
          feedbackDownWithReason: sql<number>`count(*) filter (where ${assistantEvents.eventType} = 'feedback' and metadata->>'rating' = 'down' and coalesce(metadata->>'reason', '') <> '')::int`,
        })
        .from(assistantEvents)
        .where(
          and(
            inArray(assistantEvents.eventType, [...COPILOT_EVENT_TYPES]),
            gte(assistantEvents.createdAt, from),
            lt(assistantEvents.createdAt, to)
          )
        ),

      db
        .select({
          principalId: sql<string>`metadata->>'principalId'`,
          n: sql<number>`count(*)::int`,
        })
        .from(aiUsageLog)
        .where(
          and(
            eq(aiUsageLog.pipelineStep, 'assistant'),
            isCopilotSurface,
            sql`metadata->>'principalId' IS NOT NULL`,
            usageLogInRange
          )
        )
        .groupBy(sql`metadata->>'principalId'`)
        .orderBy(sql`count(*) DESC`, sql`metadata->>'principalId' ASC`)
        .limit(TOP_TEAMMATES_LIMIT),
    ])

  const authors = await loadAuthors(teammateRows.map((row) => row.principalId as PrincipalId))
  const perTeammate: CopilotTeammateQuestionCount[] = teammateRows.map((row) => {
    const principalId = row.principalId as PrincipalId
    return {
      principalId,
      displayName: authors.get(principalId)?.displayName ?? null,
      questions: row.n,
    }
  })

  const actionBucket: PendingActionBucketRow = actionRows[0] ?? {
    total: 0,
    approved: 0,
    rejected: 0,
    expired: 0,
  }

  const eventBucket: AssistantEventBucketRow = eventRows[0] ?? {
    totalInserted: 0,
    answersInserted: 0,
    transformsInserted: 0,
    summariesInserted: 0,
    insertedReplies: 0,
    insertedNotes: 0,
    feedbackUp: 0,
    feedbackDown: 0,
    feedbackDownWithReason: 0,
  }

  return summarizeCopilotUsage(
    questionsRows[0]?.n ?? 0,
    transformRows.map((row) => ({ transform: row.transform, count: row.n })),
    summariesRows[0]?.n ?? 0,
    actionBucket,
    eventBucket,
    perTeammate
  )
}
