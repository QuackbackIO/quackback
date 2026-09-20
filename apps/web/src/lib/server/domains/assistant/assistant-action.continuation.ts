/**
 * Where an action's result goes, and who it belongs to.
 *
 * An approval is a decision about one operation. It is not a takeover, it does
 * not transfer the conversation, and it does not by itself produce anything a
 * customer reads. So when the effect settles, two questions have to be asked
 * again, in the database, under the conversation lock: does Quinn still own
 * this conversation, and is there still a durable run to continue?
 *
 * - **Quinn still owns it.** The result becomes a continuation: a new durable
 *   run, enqueued in the same transaction that settles the parked one, which
 *   generates Quinn's report of what actually happened. It travels through
 *   every publication fence Step 3 built, so a customer message that arrived
 *   during the approval wins over it in the ordinary way.
 * - **A teammate took over.** The result becomes an internal note. It is still
 *   the thing the teammate needs to know, and it is never a message from an
 *   assistant that is no longer answering this customer. A provider callback
 *   does not get to hand ownership back.
 *
 * The parked run is settled either way. It cannot be resumed in place: a run
 * in `waiting_action` is one of the statuses the single-executing-run index
 * covers, so a customer message during the wait supersedes it, which is
 * correct. The continuation is a new run precisely so that superseding the old
 * one never strands the action.
 */
import {
  db,
  and,
  desc,
  eq,
  conversations,
  conversationMessages,
  ticketConversations,
} from '@/lib/server/db'
import type { Transaction } from '@/lib/server/db'
import type { ConversationId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import type { AssistantPendingAction } from './pending-actions.service'
import {
  requestAssistantTurn,
  actionResultTriggerKey,
  type RequestAssistantTurnResult,
} from './assistant-run.service'
import { settleRun } from './assistant-run.repository'

const log = logger.child({ component: 'assistant-action-continuation' })

/** What settled, in the words the continuation or the note will carry. */
export interface ActionReport {
  kind: 'succeeded' | 'failed' | 'unknown' | 'refused'
  note: string
}

/** The one-line instruction Quinn's continuation turn answers. */
export function continuationInstruction(report: ActionReport): string {
  switch (report.kind) {
    case 'succeeded':
      return `A teammate approved the action you requested and it completed: ${report.note}. Tell the customer what was done, in one or two sentences, and ask if there is anything else.`
    case 'failed':
      return `The action you requested was approved but could not be completed: ${report.note}. Tell the customer plainly that it did not go through, do not try it again, and offer the next useful step.`
    case 'unknown':
      return `The action you requested was sent but the provider did not confirm it. Tell the customer a teammate is checking whether it went through. Do NOT say it completed and do NOT offer to try again.`
    case 'refused':
      return `The action you requested cannot be carried out: ${report.note}. Tell the customer it is not possible right now and offer the next useful step, such as speaking to a teammate.`
  }
}

/** The internal note a teammate who has taken over reads instead. */
export function privateNoteFor(action: AssistantPendingAction, report: ActionReport): string {
  const headline =
    report.kind === 'succeeded'
      ? 'completed'
      : report.kind === 'unknown'
        ? 'was sent but not confirmed'
        : report.kind === 'refused'
          ? 'was not carried out'
          : 'failed'
  return `The approved action "${action.summary}" ${headline}: ${report.note} You took this conversation over, so the customer has not been told.`
}

/**
 * Does Quinn still own this conversation?
 *
 * Four facts, all read under the lock. An assigned conversation belongs to the
 * teammate it is assigned to; a handed-off involvement has already transferred;
 * a closed or snoozed thread is not somewhere an autonomous reply belongs; and
 * a conversation backing a customer ticket is the ticket's, not Quinn's.
 */
async function quinnStillOwns(tx: Transaction, conversationId: ConversationId): Promise<boolean> {
  const [conversation] = await tx
    .select({
      status: conversations.status,
      assignedAgentPrincipalId: conversations.assignedAgentPrincipalId,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
    .for('update')
  if (!conversation) return false
  if (conversation.status !== 'open') return false
  if (conversation.assignedAgentPrincipalId) return false
  const paired = await tx
    .select({ ticketId: ticketConversations.ticketId })
    .from(ticketConversations)
    .where(
      and(
        eq(ticketConversations.conversationId, conversationId),
        eq(ticketConversations.ticketType, 'customer')
      )
    )
    .limit(1)
  if (paired.length > 0) return false
  const { getLatestInvolvement } = await import('./assistant.involvement')
  const latest = await getLatestInvolvement(conversationId, tx)
  // No involvement at all is still Quinn's: a first-touch action can settle
  // before an answer ever opened one.
  return !latest || latest.status === 'active'
}

export type ActionContinuation =
  | { kind: 'continuation'; run: RequestAssistantTurnResult }
  | { kind: 'private_note'; content: string }
  | { kind: 'none'; reason: string }

/**
 * Settle the parked run and route the result to whoever owns the customer.
 *
 * One transaction: the ownership read, the parked run's settlement, and either
 * the continuation intent (with its job) or the internal note all commit
 * together, so there is no window in which the action is settled and nobody
 * has been told.
 */
export async function ownershipForActionResult(
  action: AssistantPendingAction,
  report: ActionReport
): Promise<ActionContinuation> {
  const conversationId = action.conversationId
  if (!conversationId) return { kind: 'none', reason: 'no_conversation_parent' }

  let notifyAfterCommit: () => void = () => {}
  const outcome = await db.transaction(async (tx): Promise<ActionContinuation> => {
    const owns = await quinnStillOwns(tx, conversationId)
    if (action.runId) {
      // The parked run is finished either way: what happens next is a new run
      // or nothing, never a resumption of this one.
      await settleRun(tx, {
        runId: action.runId,
        status: owns ? 'succeeded' : 'cancelled',
        phase: 'publication',
        disposition: owns ? `action:${report.kind}` : 'fence:handed_off',
      })
    }
    if (!owns) {
      const content = privateNoteFor(action, report)
      const { appendAssistantInternalNoteTx } =
        await import('@/lib/server/domains/conversation/conversation.service')
      notifyAfterCommit = (await appendAssistantInternalNoteTx(tx, conversationId, content)).notify
      return { kind: 'private_note', content }
    }
    // A customer-origin action reports back to the customer. A teammate-origin
    // one (Copilot, workspace) has no customer turn to continue: the reviewer
    // already sees the card settle.
    if (action.originRole !== 'customer_support') {
      return { kind: 'none', reason: 'teammate_origin' }
    }
    const [parent] = await tx
      .select({ channel: conversations.channel })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
    const [trigger] = await tx
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, conversationId),
          eq(conversationMessages.senderType, 'visitor')
        )
      )
      .orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.id))
      .limit(1)
    const run = await requestAssistantTurn(tx, {
      conversationId,
      triggerKey: actionResultTriggerKey(action.id),
      triggerKind: 'action_result',
      surface: parent.channel === 'email' ? 'email' : 'widget',
      triggerMessageId: trigger?.id ?? null,
      stepInstructions: continuationInstruction(report),
    })
    return { kind: 'continuation', run }
  })

  notifyAfterCommit()
  log.info(
    { event: 'assistant_action.continuation', pending_action_id: action.id, kind: outcome.kind },
    'approved action result routed'
  )
  return outcome
}
