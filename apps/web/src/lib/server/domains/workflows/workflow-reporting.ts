/**
 * Workflow effectiveness reporting (support platform §4.6, §7). Read-only
 * aggregates over workflow_runs — runs started / completed / interrupted /
 * still-waiting per workflow over a date range, the effectiveness view the
 * support dashboard shows. `started` is the total (every run row); the rest are
 * the terminal/pending states.
 *
 * `sentRuns` / `engagedRuns` extend the same rollup with the per-workflow
 * funnel (sent -> engaged -> completed, `completed` already above): distinct
 * runs with at least one `block_sent` / `block_engaged` event
 * (action.executor.ts / event-trigger.ts) among the SAME [from, to) window's
 * runs.
 *
 * listWorkflowRuns / workflowRunTimeline (below) are the per-run drill-down a
 * failing workflow needs: workflow_run_events is written on every state
 * transition (workflow.engine.ts's logRunEvent) but had no read side until
 * now — the manager list only ever showed the trailing-7d started/completed
 * counts above.
 */
import {
  db,
  and,
  eq,
  gte,
  lt,
  count,
  desc,
  asc,
  inArray,
  sql,
  workflowRuns,
  workflowRunEvents,
  type WorkflowRunState,
} from '@/lib/server/db'
import type { WorkflowId, WorkflowRunId, ConversationId } from '@quackback/ids'

export interface WorkflowEffectiveness {
  workflowId: WorkflowId
  started: number
  completed: number
  interrupted: number
  waiting: number
  /** Funnel: distinct runs (started in-window) with >= 1 `block_sent` event. */
  sentRuns: number
  /** Funnel: distinct runs (started in-window) with >= 1 `block_engaged` event. */
  engagedRuns: number
}

/** The two funnel event kinds `workflowEffectiveness` counts distinct runs
 *  over — see action.executor.ts's send_block case and event-trigger.ts's
 *  tryResumeInputWait/tryResumeAssistantWait for where each is logged. */
const FUNNEL_EVENT_KINDS = ['block_sent', 'block_engaged'] as const

/** Per-workflow run counts by state over [from, to), keyed by workflow. */
export async function workflowEffectiveness(
  from: Date,
  to: Date
): Promise<WorkflowEffectiveness[]> {
  const rows = await db
    .select({ workflowId: workflowRuns.workflowId, state: workflowRuns.state, n: count() })
    .from(workflowRuns)
    .where(and(gte(workflowRuns.startedAt, from), lt(workflowRuns.startedAt, to)))
    .groupBy(workflowRuns.workflowId, workflowRuns.state)

  // Funnel counts: a SEPARATE query, joining workflow_run_events to
  // workflow_runs on run id, rather than filtering workflow_run_events's own
  // `at` column directly. "Within the same started_at window" means the
  // RUN's start must fall in [from, to) — an engagement event can land any
  // time after that (a customer can answer a block hours into a wait), so
  // filtering on the event's own `at` would silently exclude a late
  // block_engaged from a run that started inside the window.
  //
  // Query-plan choice: workflow_runs.started_at is already indexed
  // (workflow_runs_started_at_idx, used by the query above), so the planner
  // narrows to this window's runs FIRST and joins onto workflow_run_events by
  // run id — cheaper than a plan anchored on workflow_run_events, which has
  // no index on run_id or kind at all (only the (workflow_id,
  // subject_principal_id, at) cap_idx, built for the frequency-cap accounting
  // query and of no help for a cross-workflow scan keyed on kind/at). Either
  // plan pays one scan of workflow_run_events; anchoring on workflow_runs
  // means that scan is a hash/merge join probe against an already-narrow set
  // of run ids instead of a scan that then has to look started_at up per row.
  const funnelRows = await db
    .select({
      workflowId: workflowRuns.workflowId,
      sentRuns: sql<number>`count(distinct ${workflowRunEvents.runId}) filter (where ${workflowRunEvents.kind} = 'block_sent')::int`,
      engagedRuns: sql<number>`count(distinct ${workflowRunEvents.runId}) filter (where ${workflowRunEvents.kind} = 'block_engaged')::int`,
    })
    .from(workflowRuns)
    .innerJoin(workflowRunEvents, eq(workflowRunEvents.runId, workflowRuns.id))
    .where(
      and(
        gte(workflowRuns.startedAt, from),
        lt(workflowRuns.startedAt, to),
        inArray(workflowRunEvents.kind, FUNNEL_EVENT_KINDS)
      )
    )
    .groupBy(workflowRuns.workflowId)

  const byWorkflow = new Map<WorkflowId, WorkflowEffectiveness>()
  for (const row of rows) {
    const id = row.workflowId
    const entry = byWorkflow.get(id) ?? {
      workflowId: id,
      started: 0,
      completed: 0,
      interrupted: 0,
      waiting: 0,
      sentRuns: 0,
      engagedRuns: 0,
    }
    entry.started += row.n
    if (row.state === 'done') entry.completed += row.n
    else if (row.state === 'interrupted') entry.interrupted += row.n
    else if (row.state === 'waiting') entry.waiting += row.n
    byWorkflow.set(id, entry)
  }
  for (const row of funnelRows) {
    // Always present already: funnelRows is a subset of the same
    // workflow_runs join the first query grouped over, scoped to the exact
    // same [from, to) window.
    const entry = byWorkflow.get(row.workflowId)
    if (!entry) continue
    entry.sentRuns = row.sentRuns
    entry.engagedRuns = row.engagedRuns
  }
  return [...byWorkflow.values()]
}

/** The run-list drill-down default/ceiling: recent-first, capped so an
 *  old high-volume workflow's history doesn't try to render thousands of
 *  rows — a failing workflow's most recent runs are what an admin needs. */
export const WORKFLOW_RUN_LIST_LIMIT = 50

export interface WorkflowRunSummary {
  id: WorkflowRunId
  state: WorkflowRunState
  startedAt: Date
  endedAt: Date | null
  conversationId: ConversationId | null
}

/** A workflow's most recent runs, newest first, for the manager list's
 *  per-workflow drill-down. `limit` defaults to WORKFLOW_RUN_LIST_LIMIT. */
export async function listWorkflowRuns(
  workflowId: WorkflowId,
  limit: number = WORKFLOW_RUN_LIST_LIMIT
): Promise<WorkflowRunSummary[]> {
  return db
    .select({
      id: workflowRuns.id,
      state: workflowRuns.state,
      startedAt: workflowRuns.startedAt,
      endedAt: workflowRuns.endedAt,
      conversationId: workflowRuns.conversationId,
    })
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowId, workflowId))
    .orderBy(desc(workflowRuns.startedAt))
    .limit(limit)
}

export interface WorkflowRunTimelineEntry {
  kind: string
  at: Date
}

/** One run's ordered event timeline (oldest first) — the raw `kind` strings
 *  logRunEvent wrote (started/waiting/completed/`action_failed:<type>`/
 *  swept_stale/swept_rescheduled); humanizing them into display text is a
 *  presentation concern left to the caller. */
export async function workflowRunTimeline(
  runId: WorkflowRunId
): Promise<WorkflowRunTimelineEntry[]> {
  return db
    .select({ kind: workflowRunEvents.kind, at: workflowRunEvents.at })
    .from(workflowRunEvents)
    .where(eq(workflowRunEvents.runId, runId))
    .orderBy(asc(workflowRunEvents.at))
}
