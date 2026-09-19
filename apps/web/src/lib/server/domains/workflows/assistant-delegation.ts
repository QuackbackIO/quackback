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
import {
  db,
  and,
  desc,
  eq,
  sql,
  workflowRuns,
  type AssistantRunDelegation,
  type Transaction,
} from '@/lib/server/db'
import type { ConversationId } from '@quackback/ids'
import type { AssistantEngagementState } from '@/lib/server/domains/assistant/assistant-run.repository'

/** The same local executor alias workflow-run-events.ts uses, so this module
 *  needs no import from another domain just to name a transaction. */
type Executor = typeof db | Transaction
import { logger } from '@/lib/server/logger'
import type { AssistantOutcome } from './condition.evaluator'
import { readCursor } from './workflow-wait-queue'
import { logRunEvent } from './workflow-run-events'
import { resumeWorkflowRun } from './workflow.engine'

const log = logger.child({ component: 'assistant-delegation' })

/**
 * What an expired assistant wait should do about it.
 *
 * The distinction the specification asks for is between an execution that died
 * and a customer who has not resolved anything, and they are not the same
 * ending:
 *
 * - **defer** — the engagement is alive. A turn is generating, a turn owes the
 *   result of an approved action, or Quinn answered and the customer simply has
 *   not come back yet. None of those is a failure, and none of them holds a
 *   worker: the wait is simply asked again later, up to its ceiling.
 * - **escalate** — nothing was ever delivered and nothing is coming. This is
 *   the wait's existing default fallback, the escalated edge, and it takes
 *   Quinn's authority with it.
 * - **release** — a human owns the customer, the conversation is no longer
 *   open, or the ceiling passed on a conversation Quinn did answer. Neither
 *   branch is true: the workflow stops waiting and takes neither the resolved
 *   nor the escalated edge, rather than claiming an escalation nobody asked
 *   for or a resolution nobody confirmed.
 */
export type AssistantWaitExpiry = 'defer' | 'escalate' | 'release'

export function classifyAssistantWaitExpiry(
  state: AssistantEngagementState,
  opts: { pastCeiling: boolean }
): AssistantWaitExpiry {
  // A closed or snoozed conversation is nobody's to escalate into. The close
  // itself normally resumes the wait down its own edge long before this
  // (event-trigger.ts); reaching here means that never happened.
  if (state.takenOver || !state.open) return 'release'
  if (opts.pastCeiling) return state.answered ? 'release' : 'escalate'
  if (state.executing || state.awaitingAction || state.answered) return 'defer'
  return 'escalate'
}

/**
 * End a wait without taking either edge.
 *
 * Guarded on the exact visit, so a resume or an interrupt that landed between
 * the sweep's read and this update wins. Quinn is deliberately NOT fenced: a
 * release does not remove its authority, it only stops the workflow waiting,
 * and an approval still owed a result stays owed.
 */
export async function releaseAssistantWait(
  runId: string,
  waitSeq: number | null | undefined,
  now: Date
): Promise<boolean> {
  const filters = [eq(workflowRuns.id, runId as never), eq(workflowRuns.state, 'waiting')]
  if (waitSeq != null) {
    filters.push(sql`(${workflowRuns.cursor}->>'waitSeq')::int = ${waitSeq}`)
  }
  const [row] = await db
    .update(workflowRuns)
    .set({ state: 'interrupted', endedAt: now })
    .where(and(...filters))
    .returning({ id: workflowRuns.id })
  return !!row
}

/**
 * Push an expired wait's deadline out by one grace window.
 *
 * Guarded on the visit for the same reason as the release above. Nothing else
 * on the cursor is rewritten, so the ceiling stamped at park time keeps
 * counting from the park rather than from the last deferral.
 */
export async function deferAssistantWait(
  runId: string,
  waitSeq: number | null | undefined,
  until: Date
): Promise<boolean> {
  const filters = [eq(workflowRuns.id, runId as never), eq(workflowRuns.state, 'waiting')]
  if (waitSeq != null) {
    filters.push(sql`(${workflowRuns.cursor}->>'waitSeq')::int = ${waitSeq}`)
  }
  const [row] = await db
    .update(workflowRuns)
    .set({
      cursor: sql`coalesce(${workflowRuns.cursor}, '{}'::jsonb) || jsonb_build_object('expiresAt', ${until.toISOString()}::text)`,
    })
    .where(and(...filters))
    .returning({ id: workflowRuns.id })
  return !!row
}

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
