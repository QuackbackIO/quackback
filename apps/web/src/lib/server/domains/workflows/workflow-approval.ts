/**
 * Correlating a teammate's decision back to the `approval` step that asked
 * for it (QUINN-PRODUCT P9).
 *
 * The same correlation Step 6 established for the delegation wait, for the
 * same reason: an answer is only allowed to resume the visit that asked the
 * question. A run that moved on, parked again, or was interrupted while the
 * reviewer was deciding resumes nothing, and the decision stays recorded on
 * the proposal where a person can still read it.
 *
 * One outcome reaches the graph, `approved` or `declined`, and only a decision
 * whose execution reported success is `approved`. A rejection, an expiry, a
 * refusal at dispatch, a failure and an effect nobody could confirm are all
 * `declined`: none of them is the procedure's happy path, and continuing as if
 * the effect had happened is the one answer that would be wrong. Which of them
 * it was is recorded on the run's own ledger.
 */
import { db, eq, and, sql, workflowRuns } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { readCursor } from './workflow-wait-queue'
import { resumeWorkflowRun } from './workflow.engine'
import { logRunEvent } from './workflow-run-events'
import type { ApprovalOutcome } from './condition.evaluator'

const log = logger.child({ component: 'workflow-approval' })

/** Why an approval step ended, for the run ledger. Never reaches the graph. */
export type WorkflowApprovalReason =
  'executed' | 'rejected' | 'expired' | 'failed' | 'unconfirmed' | 'refused'

const APPROVED_REASONS: ReadonlySet<WorkflowApprovalReason> = new Set(['executed'])

/**
 * Resume the run parked on this proposal, if one is still parked on it.
 *
 * Cheap when nothing is: one indexed-by-nothing scan over the waiting runs of
 * this workspace, filtered in SQL on the cursor's own field, which is a small
 * set by construction (a waiting run holds the customer-facing exclusive slot).
 * Returns whether a run was resumed.
 */
export async function completeWorkflowApproval(
  pendingActionId: string,
  reason: WorkflowApprovalReason
): Promise<boolean> {
  const [current] = await db
    .select({
      id: workflowRuns.id,
      cursor: workflowRuns.cursor,
      workflowId: workflowRuns.workflowId,
      subjectPrincipalId: workflowRuns.subjectPrincipalId,
    })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.state, 'waiting'),
        sql`${workflowRuns.cursor}->>'pendingActionId' = ${pendingActionId}`
      )
    )
    .limit(1)
  if (!current) return false

  const cursor = readCursor(current)
  if (cursor.waitKind !== 'approval') return false
  const outcome: ApprovalOutcome = APPROVED_REASONS.has(reason) ? 'approved' : 'declined'
  const resumed = await resumeWorkflowRun(current.id, {
    approvalOutcome: outcome,
    expectedWaitSeq: cursor.waitSeq,
  })
  if (!resumed) return false
  await logRunEvent(
    resumed.id,
    resumed.workflowId,
    resumed.subjectPrincipalId,
    `approval_${outcome}:${reason}`
  )
  log.info(
    {
      event: 'workflow_approval.completed',
      workflow_run_id: current.id,
      pending_action_id: pendingActionId,
      outcome,
      reason,
    },
    'approval step resumed its workflow'
  )
  return true
}
