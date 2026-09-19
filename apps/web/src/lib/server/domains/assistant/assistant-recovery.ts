/**
 * Recovery for Quinn work nothing else will finish (QUINN-PRODUCT Step 11, P8).
 *
 * Two sweeps and three operator controls, and the line between them is who
 * decides. A sweep only ever completes bookkeeping the runtime already owed:
 * it never invents an outcome, never re-dispatches an effect, and never
 * answers a customer. A control is a person deciding, and each one states the
 * precondition it enforces so an operator cannot replay arbitrary work by
 * pressing it twice.
 *
 * ## What actually strands
 *
 * The queue's own reaper covers a dead worker while the job row exists: an
 * `assistant-turn` job runs at one attempt, so a reaped lease goes terminal.
 * What it cannot cover is the row being GONE. Job rows are pruned on their own
 * retention schedule (a day for succeeded, a fortnight for failed), and the run
 * and the proposal outlive them by design. Past that horizon:
 *
 *  - a run still `running` or `queued` is a computation nobody will finish, and
 *    the conversation shows a turn in flight for ever, because the reconnect
 *    fallback reads exactly that row;
 *  - an approved action still `queued` is a decision a person made that nothing
 *    will carry out.
 *
 * Neither is safe to fix by simply trying again. An approved action is
 * re-enqueued only when its receipt says nothing was attempted; a receipt that
 * was dispatched and never settled becomes `unknown` and waits for a person,
 * and a receipt that already succeeded settles the row from the receipt. That
 * is the same duplicate-call table Step 5 established, read by a sweep instead
 * of by a worker.
 *
 * A run parked in `waiting_action` is deliberately out of scope here: it is
 * owed an approval result, and `sweepAndNotifyExpiredPendingActions` releases
 * it when the proposal expires. Two passes releasing the same park would race.
 */
import { and, db, eq, inArray, isNotNull, isNull, lt, or, sql } from '@/lib/server/db'
import {
  assistantPendingActions,
  assistantRuns,
  assistantToolCalls,
  conversations,
} from '@/lib/server/db'
import type { AssistantRunId, PrincipalId } from '@quackback/ids'
import { ConflictError, NotFoundError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import { enqueueJob } from '@/lib/server/jobs'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import {
  bumpAssistantRevision,
  lockConversationForRun,
  lockRun,
  releaseParkedRun,
  settleRun,
  type AssistantRunRow,
} from './assistant-run.repository'
import {
  ASSISTANT_TURN_QUEUE,
  requestAssistantTurn,
  type RequestAssistantTurnResult,
} from './assistant-run.service'
import {
  ASSISTANT_ACTION_QUEUE,
  assistantActionDedupeKey,
  markPendingActionExecuted,
  markPendingActionFailed,
  markPendingActionUnknown,
  markPendingActionRequeued,
} from './pending-actions.service'
import { findReceiptForPendingAction } from './tool-audit'
import { getToolSpecByName } from './assistant.toolspec'

const log = logger.child({ component: 'assistant-recovery' })

/**
 * How long a run or an approved action may look abandoned before a sweep acts.
 *
 * Fifteen minutes is far outside every live window: the queue reaps a lost
 * lease within seconds, the turn lease is three minutes and the action lease
 * two, and both heartbeat. Anything still open this long after its last write
 * has no worker behind it.
 */
export const STRANDED_GRACE_MS = 15 * 60_000

/** How many rows one pass will touch. A backlog is worked down over passes. */
const SWEEP_BATCH = 50

export interface StrandedRunSweepResult {
  recovered: number
}

/**
 * A run whose work nobody is doing: open past the grace, with no claimable job
 * row behind it.
 *
 * `queued` and `running` are matched by different keys because they are
 * different moments. A queued run has no `job_id` yet (the claim writes it), so
 * its job is found by the dedupe key the intent enqueued under; a running run
 * names its job directly.
 */
async function listStrandedRuns(cutoff: Date, exec: Executor): Promise<AssistantRunRow[]> {
  return exec
    .select()
    .from(assistantRuns)
    .where(
      and(
        inArray(assistantRuns.status, ['queued', 'running']),
        lt(assistantRuns.updatedAt, cutoff),
        isNotNull(assistantRuns.conversationId),
        sql`NOT EXISTS (
          SELECT 1 FROM job_queue j
          WHERE j.queue = ${ASSISTANT_TURN_QUEUE}
            AND j.status IN ('pending', 'running')
            AND (
              j.job_id = ${assistantRuns.jobId}
              OR j.dedupe_key = ${ASSISTANT_TURN_QUEUE} || ':' || ${assistantRuns.id}::text
            )
        )`
      )
    )
    .orderBy(assistantRuns.updatedAt)
    .limit(SWEEP_BATCH)
}

/**
 * Fail every run a dead worker left open, and hand each conversation to a human.
 *
 * The run is marked `failed` with `stranded:no_worker` rather than cancelled:
 * the turn was owed and never produced, which is a failure, and the reporting
 * counts it as one. The failure floor is the same one a live failure runs, and
 * it re-reads ownership itself, so a conversation a teammate has since taken
 * over is left alone by the floor rather than by this pass guessing.
 *
 * A stranded run that a workflow delegated is resumed down the escalated edge
 * by `sweepStrandedAssistantDelegations`, which looks for exactly this shape: a
 * terminal run that never answered.
 */
export async function sweepStrandedAssistantRuns(
  now = new Date(),
  exec: Executor = db
): Promise<StrandedRunSweepResult> {
  const cutoff = new Date(now.getTime() - STRANDED_GRACE_MS)
  const stranded = await listStrandedRuns(cutoff, exec)
  if (stranded.length === 0) return { recovered: 0 }

  let recovered = 0
  for (const run of stranded) {
    const settled = await settleRun(exec, {
      runId: run.id,
      status: 'failed',
      disposition: 'stranded:no_worker',
      errorReason: 'the worker running this turn stopped before it finished',
      expectedStateVersion: run.stateVersion,
    })
    if (!settled) continue
    recovered += 1
    try {
      const [{ getAssistantPrincipal }, { runAssistantFailureFloor }] = await Promise.all([
        import('./assistant.principal'),
        import('./assistant.orchestrator'),
      ])
      const quinn = await getAssistantPrincipal()
      if (quinn) await runAssistantFailureFloor(run.conversationId!, quinn.id)
    } catch (err) {
      // Bookkeeping already landed; the hand-off is best effort, exactly as it
      // is on the live failure path.
      log.warn({ err, run_id: run.id }, 'stranded run recovered but the failure floor did not run')
    }
  }
  if (recovered > 0) log.info({ recovered }, 'recovered runs left open by a dead worker')
  return { recovered }
}

export interface StrandedActionSweepResult {
  /** Approved actions given a fresh job because nothing was ever attempted. */
  requeued: number
  /** Approved actions settled from a receipt that had already answered. */
  settled: number
  /** Approved actions whose effect was attempted and cannot be confirmed. */
  unconfirmed: number
}

/**
 * Approved actions whose execution is owed and whose job row is not there.
 *
 * `execution_job_id` may be NULL (decided before the job id was recorded) or
 * point at a row that has been pruned; both are "no job", and the NOT EXISTS
 * spells that once.
 */
async function listStrandedActions(cutoff: Date, exec: Executor) {
  return exec
    .select()
    .from(assistantPendingActions)
    .where(
      and(
        eq(assistantPendingActions.status, 'approved'),
        eq(assistantPendingActions.executionState, 'queued'),
        or(
          lt(assistantPendingActions.decidedAt, cutoff),
          and(
            isNull(assistantPendingActions.decidedAt),
            lt(assistantPendingActions.proposedAt, cutoff)
          )
        ),
        sql`NOT EXISTS (
          SELECT 1 FROM job_queue j
          WHERE j.queue = ${ASSISTANT_ACTION_QUEUE}
            AND j.status IN ('pending', 'running')
            AND j.job_id = ${assistantPendingActions.executionJobId}
        )`
      )
    )
    .orderBy(assistantPendingActions.proposedAt)
    .limit(SWEEP_BATCH)
}

/**
 * Give an approved action back its execution, or record why it cannot have one.
 *
 * The receipt decides, not the sweep. Three readings, and only the first
 * enqueues anything:
 *
 *  - no receipt, or a receipt that never left the intent stage: nothing was
 *    attempted, so a fresh job is safe. The dedupe key stops a second job row
 *    and the receipt's own action key stops a second dispatch even if one
 *    somehow got through, so this cannot execute twice;
 *  - a receipt dispatched and never settled: the effect may have happened. That
 *    is `unknown`, which is a person's job, and is exactly what the worker
 *    would have concluded;
 *  - a receipt that already settled: the work was done and only the bookkeeping
 *    was lost, so the row is settled from the receipt.
 */
export async function sweepStrandedApprovedActions(
  now = new Date(),
  exec: Executor = db
): Promise<StrandedActionSweepResult> {
  const cutoff = new Date(now.getTime() - STRANDED_GRACE_MS)
  const stranded = await listStrandedActions(cutoff, exec)
  const result: StrandedActionSweepResult = { requeued: 0, settled: 0, unconfirmed: 0 }
  if (stranded.length === 0) return result

  for (const action of stranded) {
    const receipt = await findReceiptForPendingAction(action.id, exec)
    if (receipt?.outcomeStatus === 'succeeded') {
      await markPendingActionExecuted(action.id, receipt.result ?? null, exec)
      result.settled += 1
      continue
    }
    if (receipt?.outcomeStatus === 'failed') {
      await markPendingActionFailed(action.id, receipt.error ?? 'the action failed', exec)
      result.settled += 1
      continue
    }
    if (receipt?.dispatchedAt && !receipt.settledAt) {
      await markPendingActionUnknown(
        action.id,
        'the worker stopped after this action was sent and never confirmed the result',
        exec
      )
      result.unconfirmed += 1
      continue
    }
    const job = await enqueueJob({
      queue: ASSISTANT_ACTION_QUEUE,
      payload: { pendingActionId: action.id },
      dedupeKey: assistantActionDedupeKey(action.id),
      maxAttempts: 3,
      executor: exec,
    })
    if (!job.inserted) continue
    await markPendingActionRequeued(action.id, job.jobId, exec)
    result.requeued += 1
  }
  if (result.requeued + result.settled + result.unconfirmed > 0) {
    log.info(result, 'recovered approved actions whose execution job was gone')
  }
  return result
}

// ---------------------------------------------------------------------------
// Operator controls. Each one states its precondition; none replays work.
// ---------------------------------------------------------------------------

const CANCELLABLE = ['queued', 'running', 'waiting_action'] as const

/**
 * Stop a run that has not finished.
 *
 * Two things happen together and both matter. The run is settled `cancelled`,
 * which is what the surfaces read, and the conversation's invalidation counter
 * moves, which is what stops a worker that is still generating from publishing
 * afterwards. Cancellation of the compute itself is best effort by design (the
 * provider call may already be in flight); the fence is not.
 *
 * A parked run goes through `releaseParkedRun`, which is guarded on
 * `waiting_action`, so cancelling one cannot race the approval result into a
 * half-settled state.
 */
export async function cancelAssistantRun(runId: AssistantRunId): Promise<AssistantRunRow> {
  return db.transaction(async (tx) => {
    const run = await lockRun(tx, runId)
    if (!run) throw new NotFoundError('ASSISTANT_RUN_NOT_FOUND', 'Run not found')
    if (!(CANCELLABLE as readonly string[]).includes(run.status)) {
      throw new ConflictError('ASSISTANT_RUN_NOT_CANCELLABLE', 'This run has already finished')
    }
    if (run.status === 'waiting_action') {
      const released = await releaseParkedRun(tx, runId, 'cancelled:operator')
      if (!released) {
        throw new ConflictError('ASSISTANT_RUN_NOT_CANCELLABLE', 'This run has already finished')
      }
      return released
    }
    if (run.conversationId) await bumpAssistantRevision(tx, run.conversationId)
    const settled = await settleRun(tx, {
      runId,
      status: 'cancelled',
      phase: 'publication',
      disposition: 'cancelled:operator',
      expectedStateVersion: run.stateVersion,
    })
    if (!settled) {
      throw new ConflictError('ASSISTANT_RUN_NOT_CANCELLABLE', 'This run has already finished')
    }
    return settled
  })
}

/**
 * Did this run change anything outside its own records?
 *
 * Fail closed. A receipt is treated as an effect unless the tool it names is a
 * known read: a connector tool this process cannot resolve, or a built-in that
 * has since been removed, is counted as a write rather than assumed harmless.
 */
async function runTookAnAction(runId: AssistantRunId, exec: Executor): Promise<boolean> {
  const receipts = await exec
    .select({
      toolName: assistantToolCalls.toolName,
      dispatchedAt: assistantToolCalls.dispatchedAt,
      pendingActionId: assistantToolCalls.pendingActionId,
    })
    .from(assistantToolCalls)
    .where(eq(assistantToolCalls.runId, runId))
  return receipts.some((receipt) => {
    if (receipt.dispatchedAt || receipt.pendingActionId) return true
    const spec = getToolSpecByName(receipt.toolName)
    return spec?.risk !== 'read'
  })
}

/**
 * Run one failed turn again, for a conversation that is still Quinn's.
 *
 * This is deliberately narrow. It is a NEW run under the trigger key
 * `retry:<runId>`, which the unique index makes spendable exactly once, so the
 * control cannot be leaned on. It is refused for a run that is not failed, for
 * a run that took an action of any kind (re-generating would propose or perform
 * it again), and for a conversation that has closed or been taken over, because
 * a retry there would publish into somebody else's thread.
 */
export async function retryFailedAssistantRun(
  runId: AssistantRunId,
  opts: { requestedByPrincipalId?: PrincipalId | null } = {}
): Promise<AssistantRunRow> {
  const run = await db
    .select()
    .from(assistantRuns)
    .where(eq(assistantRuns.id, runId))
    .then((rows) => rows[0] ?? null)
  if (!run) throw new NotFoundError('ASSISTANT_RUN_NOT_FOUND', 'Run not found')
  if (run.status !== 'failed' || !run.conversationId) {
    throw new ConflictError(
      'ASSISTANT_RUN_NOT_RETRYABLE',
      'Only a failed conversation turn can be run again'
    )
  }
  if (await runTookAnAction(runId, db)) {
    throw new ConflictError(
      'ASSISTANT_RUN_NOT_RETRYABLE',
      'This turn took an action, so it cannot be run again'
    )
  }
  const [parent] = await db
    .select({
      status: conversations.status,
      assignedAgentPrincipalId: conversations.assignedAgentPrincipalId,
    })
    .from(conversations)
    .where(eq(conversations.id, run.conversationId))
  if (!parent || parent.status !== 'open' || parent.assignedAgentPrincipalId) {
    throw new ConflictError(
      'ASSISTANT_RUN_NOT_RETRYABLE',
      'This conversation is no longer waiting on Quinn'
    )
  }

  let requested: RequestAssistantTurnResult | null = null
  await db.transaction(async (tx) => {
    await lockConversationForRun(tx, run.conversationId!)
    requested = await requestAssistantTurn(tx, {
      conversationId: run.conversationId!,
      triggerKey: `retry:${runId}`,
      triggerKind: 'agent_handback',
      surface: 'widget',
      triggerMessageId: run.triggerMessageId,
      requestedByPrincipalId: opts.requestedByPrincipalId ?? null,
    })
  })
  const result = requested as RequestAssistantTurnResult | null
  if (!result || !result.created) {
    throw new ConflictError('ASSISTANT_RUN_NOT_RETRYABLE', 'This turn has already been run again')
  }
  log.info({ run_id: runId, retry_run_id: result.run.id }, 'operator re-ran a failed turn')
  return result.run
}

/** Exported for the operations deadline provider: is anything owed recovery? */
export async function nextStrandedRecoveryAt(exec: Executor = db): Promise<Date | null> {
  const result = await exec.execute(sql`
    SELECT LEAST(
      (SELECT min(r.updated_at) FROM assistant_runs r
        WHERE r.status IN ('queued', 'running')
          AND r.conversation_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM job_queue j
            WHERE j.queue = ${ASSISTANT_TURN_QUEUE} AND j.status IN ('pending', 'running')
              AND (j.job_id = r.job_id OR j.dedupe_key = ${ASSISTANT_TURN_QUEUE} || ':' || r.id::text)
          )),
      (SELECT min(coalesce(a.decided_at, a.proposed_at)) FROM assistant_pending_actions a
        WHERE a.status = 'approved' AND a.execution_state = 'queued'
          AND NOT EXISTS (
            SELECT 1 FROM job_queue j
            WHERE j.queue = ${ASSISTANT_ACTION_QUEUE} AND j.status IN ('pending', 'running')
              AND j.job_id = a.execution_job_id
          ))
    ) AS due_at
  `)
  const value = getExecuteRows<{ due_at: Date | string | null }>(result)[0]?.due_at
  if (!value) return null
  return new Date(new Date(value).getTime() + STRANDED_GRACE_MS)
}
