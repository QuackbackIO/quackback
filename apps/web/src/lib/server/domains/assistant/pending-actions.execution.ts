/**
 * What the durable executor does to a proposal.
 *
 * Split from pending-actions.service.ts because these five writes belong to a
 * different moment than the ones there. Proposing, deciding and expiring are
 * about a REVIEW; these are about an EXECUTION that runs minutes later on a
 * worker, and each of them exists because that execution can end in a state
 * the review vocabulary has no word for: still running, dispatched but never
 * confirmed, refused by a live recheck, judged after the fact by a person, or
 * replaced by a request that changed.
 *
 * Every one is a conditional UPDATE guarded by the status it expects, like its
 * siblings: two racing callers can never both win a transition, and an UPDATE
 * that matches nothing returns null rather than throwing.
 */
import { db, eq, and, assistantPendingActions } from '@/lib/server/db'
import type { AssistantPendingActionId, ConversationId, TicketId } from '@quackback/ids'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { AssistantPendingAction } from './pending-actions.service'

/** Take execution ownership. Only an approved, not-yet-running action moves. */
export async function markPendingActionRunning(
  id: AssistantPendingActionId,
  exec: Executor = db
): Promise<AssistantPendingAction | null> {
  const [row] = await exec
    .update(assistantPendingActions)
    .set({ executionState: 'running' })
    .where(and(eq(assistantPendingActions.id, id), eq(assistantPendingActions.status, 'approved')))
    .returning()
  return row ?? null
}

/**
 * Record that an approved action was dispatched and never confirmed.
 *
 * Deliberately NOT `failed`: the decision stands, the effect may have
 * happened, and the only honest next step is a person looking at it. The
 * proposal therefore stays `approved` with its execution marked unknown,
 * rather than moving to a terminal status that would invite a fresh approval
 * of the same operation.
 */
export async function markPendingActionUnknown(
  id: AssistantPendingActionId,
  note: string,
  exec: Executor = db
): Promise<AssistantPendingAction | null> {
  const [row] = await exec
    .update(assistantPendingActions)
    .set({ executionState: 'unknown', executionError: note })
    .where(and(eq(assistantPendingActions.id, id), eq(assistantPendingActions.status, 'approved')))
    .returning()
  return row ?? null
}

/**
 * Record that the pre-dispatch recheck refused an approved action.
 *
 * Terminal, and deliberately distinct from an execution failure: nothing was
 * attempted, so there is nothing to reconcile, and the reason names the gate
 * rather than a provider. A reviewer who still wants it issues a new request,
 * which is a new proposal and a new decision.
 */
export async function refusePendingAction(
  id: AssistantPendingActionId,
  input: { reason: string; note: string },
  exec: Executor = db
): Promise<AssistantPendingAction | null> {
  const [row] = await exec
    .update(assistantPendingActions)
    .set({
      status: 'failed',
      executedAt: new Date(),
      executionState: 'failed',
      executionError: input.note,
      disposition: `refused:${input.reason}`,
      result: { error: input.note },
    })
    .where(and(eq(assistantPendingActions.id, id), eq(assistantPendingActions.status, 'approved')))
    .returning()
  return row ?? null
}

/**
 * Settle an approved action whose unconfirmed effect a person has now judged.
 *
 * The verdict is about the effect, so the proposal follows it rather than
 * being decided again: `resolved` means it happened after all, `failed` means
 * it did not. Either way the action leaves the review queue, and neither
 * repeats the write.
 */
export async function settleReconciledPendingAction(
  id: AssistantPendingActionId,
  verdict: 'resolved' | 'failed',
  note: string,
  exec: Executor = db
): Promise<AssistantPendingAction | null> {
  const [row] = await exec
    .update(assistantPendingActions)
    .set({
      status: verdict === 'resolved' ? 'executed' : 'failed',
      executionState: verdict === 'resolved' ? 'succeeded' : 'failed',
      executedAt: new Date(),
      executionError: note,
      disposition: `reconciled:${verdict}`,
    })
    .where(
      and(
        eq(assistantPendingActions.id, id),
        eq(assistantPendingActions.status, 'approved'),
        eq(assistantPendingActions.executionState, 'unknown')
      )
    )
    .returning()
  return row ?? null
}

/**
 * Supersede the live proposals on an item because the request itself changed.
 *
 * Only an undispatched proposal can be superseded, which is what the
 * `status = 'proposed'` guard means: once a decision has scheduled execution,
 * cancelling the intent cannot undo an effect, and the reconciliation path
 * owns that case instead. The status moves to `expired` because the column's
 * CHECK cannot carry a new word without a constraint rewrite no migration here
 * may replay; `disposition` is what the surfaces read.
 */
export async function supersedePendingActions(
  parent: { conversationId?: ConversationId; ticketId?: TicketId },
  reason: string,
  exec: Executor = db
): Promise<AssistantPendingAction[]> {
  const scope = parent.conversationId
    ? eq(assistantPendingActions.conversationId, parent.conversationId)
    : parent.ticketId
      ? eq(assistantPendingActions.ticketId, parent.ticketId)
      : null
  if (!scope) return []
  return exec
    .update(assistantPendingActions)
    .set({ status: 'expired', disposition: `superseded:${reason}` })
    .where(and(scope, eq(assistantPendingActions.status, 'proposed')))
    .returning()
}
