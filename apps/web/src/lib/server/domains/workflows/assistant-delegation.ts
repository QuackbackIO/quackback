/**
 * The correlation between a workflow's assistant wait and the Quinn run that
 * answers it (P4).
 *
 * A `let_assistant_answer` park and its durable run are written together
 * (workflow.engine.ts's parkAtAssistantWait). This module owns the other two
 * directions of that relationship:
 *
 * - **Carrying it forward.** The customer keeps talking to Quinn while the
 *   workflow waits, so the turns that follow the delegated one belong to the
 *   same engagement. Each new run inherits the live wait's identity, which is
 *   what lets a hand-off three turns later still resume the workflow.
 * - **Completing it.** A completion names the visit it answers. The wait is
 *   claimed only when its sequence still matches, so a run that finished late,
 *   after the workflow moved on or parked again, changes nothing.
 *
 * The wait deliberately does NOT end on an ordinary answer: Quinn answering is
 * not the workflow's resolution branch. It ends on a hand-off, on an execution
 * that died, and on the lifecycle's own resolution or close (those still arrive
 * as events, see event-trigger.ts).
 */
import { db, and, desc, eq, sql, workflowRuns, type AssistantRunDelegation } from '@/lib/server/db'
import type { ConversationId } from '@quackback/ids'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import { logger } from '@/lib/server/logger'
import type { AssistantOutcome } from './condition.evaluator'
import { readCursor } from './workflow-wait-queue'
import { logRunEvent } from './workflow-run-events'
import { resumeWorkflowRun } from './workflow.engine'

const log = logger.child({ component: 'assistant-delegation' })

/**
 * The delegation a conversation is currently parked on, if any.
 *
 * Read from the workflow run rather than from the previous Quinn run, because
 * the workflow run is the thing that actually holds the wait: a cursor that has
 * moved on, or a run that was interrupted, stops producing a delegation here
 * instead of handing out an identity nothing would honour. The customer-facing
 * exclusive lock means there is at most one.
 */
export async function findLiveAssistantDelegation(
  conversationId: ConversationId,
  exec: Executor = db
): Promise<AssistantRunDelegation | null> {
  const [row] = await exec
    .select({ id: workflowRuns.id, cursor: workflowRuns.cursor })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.conversationId, conversationId),
        eq(workflowRuns.state, 'waiting'),
        sql`coalesce(${workflowRuns.cursor}->>'waitKind', 'timer') = 'assistant'`
      )
    )
    .orderBy(desc(workflowRuns.startedAt))
    .limit(1)
  if (!row) return null
  const cursor = readCursor(row)
  if (!cursor.resumeNodeId || cursor.waitSeq == null) return null
  return { workflowRunId: row.id, nodeId: cursor.resumeNodeId, waitSeq: cursor.waitSeq }
}

/**
 * End the workflow wait this delegation was made for.
 *
 * `expectedWaitSeq` is the correlation: the claim matches only while the run is
 * still parked at that exact visit, so a completion that arrives after the
 * workflow moved on, was interrupted, or parked again resumes nothing. The node
 * comparison before it is defence in depth for a cursor written by an older
 * build; the sequence is what makes the claim atomic.
 *
 * Returns true when this call is the one that resumed the wait. False covers
 * every ordinary loser: a stale completion, a wait something else already
 * resumed, a workflow run that is gone.
 */
export async function completeAssistantDelegation(
  delegation: AssistantRunDelegation,
  outcome: AssistantOutcome
): Promise<boolean> {
  const [current] = await db
    .select({ id: workflowRuns.id, cursor: workflowRuns.cursor, state: workflowRuns.state })
    .from(workflowRuns)
    .where(eq(workflowRuns.id, delegation.workflowRunId as never))
    .limit(1)
  if (!current || current.state !== 'waiting') return false
  const cursor = readCursor(current)
  if (cursor.waitKind !== 'assistant') return false
  if (cursor.resumeNodeId !== delegation.nodeId || cursor.waitSeq !== delegation.waitSeq) {
    log.info(
      {
        event: 'assistant_delegation.stale',
        workflow_run_id: delegation.workflowRunId,
        expected_wait_seq: delegation.waitSeq,
        current_wait_seq: cursor.waitSeq ?? null,
      },
      'assistant completion did not match the parked wait; leaving it alone'
    )
    return false
  }

  const resumed = await resumeWorkflowRun(current.id, {
    assistantOutcome: outcome,
    expectedWaitSeq: delegation.waitSeq,
  })
  if (!resumed) return false
  // Funnel parity with the event-driven resume (event-trigger.ts): only an
  // escalation is a customer-driven engagement signal.
  if (outcome === 'escalated') {
    await logRunEvent(resumed.id, resumed.workflowId, resumed.subjectPrincipalId, 'block_engaged')
  }
  log.info(
    {
      event: 'assistant_delegation.completed',
      workflow_run_id: delegation.workflowRunId,
      wait_seq: delegation.waitSeq,
      outcome,
    },
    'workflow assistant wait resumed by its delegated run'
  )
  return true
}
