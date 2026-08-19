/**
 * Workflow run retention (support platform §4.6 run retention): compacts a
 * terminal (done/interrupted) run's `graph` snapshot to `{}` once it's old
 * enough that nobody will ever read it again. Compaction, never deletion —
 * this NEVER removes a `workflow_runs` row or its `workflow_run_events`:
 *
 *  - `workflow_run_events` is the frequency-cap ledger: dispatcher.guards.ts's
 *    frequencyCapAllows counts 'started' events by (workflowId,
 *    subjectPrincipalId) to enforce a workflow's 'once'/'once_per_days'/
 *    'n_total' frequency cap, and 'once'/'n_total' are ALL-TIME counts (see
 *    that function's own doc). `workflow_runs_id_fkey` cascades onto
 *    `workflow_run_events` (schema/workflows.ts), so deleting a run would
 *    delete its 'started' event too — silently letting a capped workflow
 *    re-fire past its lifetime limit for that person the moment the run
 *    aged out. Rows and events are therefore permanent history; only the
 *    bulky `graph` snapshot column (a full copy of the workflow's graph at
 *    run-start, a few KB) is ever blanked, and only on a TERMINAL run.
 *
 *  - Blanking `graph` on a terminal run is safe because nothing reads it once
 *    the run has settled — verified against the actual call sites, not
 *    assumed:
 *      - workflow.engine.ts's resumeWorkflowRun only ever claims a run via an
 *        atomic UPDATE guarded on `state = 'waiting'`; a 'done'/'interrupted'
 *        run can never be claimed, so its pinned graph snapshot is never
 *        re-walked (see resumeWorkflowRun's own doc: "Any throw after the
 *        claim reverts it... without the revert, the retry's claim would
 *        match zero rows" — the claim itself is the only path that ever
 *        reads a run's graph post-insert).
 *      - workflow-sweep.ts's two reconciliation passes filter to
 *        `state = 'running'` (sweepStaleRunningRuns) and `state = 'waiting'`
 *        (sweepOrphanedWaitingRuns) respectively; a terminal run is never a
 *        candidate row either pass selects, so a blanked graph never
 *        surprises the sweeper.
 *      - The runs-sheet timeline UI (workflow-runs-sheet.tsx) reads its
 *        per-run timeline through workflow-reporting.ts's run-events query
 *        (`SELECT kind, at FROM workflow_run_events WHERE run_id = ...`),
 *        never the run's own `graph` column — a blanked graph is invisible
 *        to that UI, not broken by it.
 *    The only thing a blanked graph makes unreadable is a human trying to
 *    inspect an old run's exact node/edge shape after the fact — an
 *    accepted, documented storage/inspectability trade-off, not a
 *    functional gap.
 */
import { sql } from 'drizzle-orm'
import { db } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'workflow-retention' })

export interface WorkflowRunCompactionResult {
  /** Total rows whose `graph` was blanked across every batch this call ran. */
  compacted: number
}

/**
 * Blank the `graph` snapshot on every terminal (done/interrupted) workflow
 * run older than `olderThanDays`, in batches of `batchSize`, until no
 * qualifying row remains. Batched the same way anon-sweep.service.ts's
 * sweepAnonymousPrincipals is: a single unbounded UPDATE against a
 * potentially large backlog would hold its lock/WAL cost for one long
 * statement, where a looping id-batch subquery (`LIMIT batchSize`, re-run
 * until a pass returns fewer than a full batch) works the backlog down over
 * several small, cheap statements instead.
 */
export async function compactTerminalWorkflowRuns(opts?: {
  olderThanDays?: number
  batchSize?: number
}): Promise<WorkflowRunCompactionResult> {
  const olderThanDays = opts?.olderThanDays ?? 90
  const batchSize = opts?.batchSize ?? 500
  const cutoffIso = new Date(Date.now() - olderThanDays * 86_400_000).toISOString()

  let compacted = 0
  for (;;) {
    const result = await db.execute(sql`
      UPDATE workflow_runs
      SET graph = '{}'::jsonb
      WHERE id IN (
        SELECT id FROM workflow_runs
        WHERE state IN ('done', 'interrupted')
          AND started_at < ${cutoffIso}::timestamptz
          AND graph != '{}'::jsonb
        LIMIT ${batchSize}
      )
      RETURNING id
    `)
    const rows = getExecuteRows<{ id: string }>(result)
    if (rows.length === 0) break
    compacted += rows.length
    if (rows.length < batchSize) break // last (partial) batch — nothing qualifying left
  }

  if (compacted > 0) {
    log.info({ compacted, olderThanDays }, 'workflow-run retention compaction complete')
  }
  return { compacted }
}
