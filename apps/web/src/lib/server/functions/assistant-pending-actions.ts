import { PERMISSIONS } from '@/lib/shared/permissions'
/**
 * Read-only fetch for a live pending-action row, by id.
 *
 * The inbox approval card renders from an internal note's metadata pointer
 * (pendingActionId + toolName + summary), which is only a point-in-time
 * snapshot taken when Quinn proposed the action. This fn is how the card
 * learns the CURRENT status (approved/rejected/executed/failed/expired)
 * instead of trusting that stale snapshot. Base gate is conversation.view
 * (any inbox teammate may open the approval queue); same as approve/reject
 * (assistant-actions.ts), the actual authority is per-row: the caller must be
 * able to VIEW the row's actual parent (`assertConversationViewable` /
 * `assertTicketVisible`), not just hold the base permission somewhere.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { AssistantPendingActionId, AssistantToolCallId } from '@quackback/ids'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import { ConflictError, NotFoundError } from '@/lib/shared/errors'
import {
  getPendingActionById,
  listDecidablePendingActions,
  listUnconfirmedPendingActions,
  settleReconciledPendingAction,
  type AssistantPendingAction,
} from '@/lib/server/domains/assistant/pending-actions.service'
import {
  findReceiptForPendingAction,
  getToolCallById,
  listUnreconciledToolCalls,
  reconcileToolCall,
} from '@/lib/server/domains/assistant/tool-audit'
import { assertConversationViewable } from '@/lib/server/domains/conversation/conversation.service'
import { assertTicketVisible } from '@/lib/server/domains/tickets/ticket.service'
import type { AssistantPendingActionDTO } from './assistant-actions'

const PendingActionInput = z.object({ pendingActionId: z.string() })

// Mirrors assistant-actions.ts's toDTO. Not imported from there (that file is
// owned by another approval-flow change and shouldn't gain new exports for
// this) , the reshape is a few fields, so a local copy is cheaper than
// coupling the two files.
function toDTO(row: AssistantPendingAction): AssistantPendingActionDTO {
  return {
    id: row.id,
    conversationId: row.conversationId,
    ticketId: row.ticketId,
    involvementId: row.involvementId,
    toolName: row.toolName,
    args: row.args as AssistantPendingActionDTO['args'],
    summary: row.summary,
    originRole: row.originRole,
    originProfile: row.originProfile,
    status: row.status,
    proposedAt: row.proposedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    decidedById: row.decidedById,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    executedAt: row.executedAt?.toISOString() ?? null,
    result: (row.result as AssistantPendingActionDTO['result']) ?? null,
    executionState: row.executionState,
    executionError: row.executionError,
    disposition: row.disposition,
    requestedById: row.requestedById,
  }
}

export const getAssistantPendingActionFn = createServerFn({ method: 'GET' })
  .validator(PendingActionInput)
  .handler(async ({ data }) => {
    // Base gate: any inbox teammate may open the approval queue.
    const auth = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
    const row = await getPendingActionById(data.pendingActionId as AssistantPendingActionId)
    if (!row) throw new NotFoundError('PENDING_ACTION_NOT_FOUND', 'Pending action not found')
    // Row-level authz (unified inbox §3.3): see this file's doc comment ,
    // the base gate above only confirms conversation.view SOMEWHERE.
    const actor = await policyActorFromAuth(auth)
    if (row.conversationId) {
      await assertConversationViewable(row.conversationId, actor)
    } else if (row.ticketId) {
      await assertTicketVisible(row.ticketId, actor)
    } else {
      throw new NotFoundError('PENDING_ACTION_NOT_FOUND', 'Pending action not found')
    }
    return toDTO(row)
  })

/**
 * One row of the Needs approval queue.
 *
 * Three dimensions, kept apart on purpose (the approval chapter's own table):
 * `status` is the review DECISION, `executionState` is what the durable
 * executor actually did, and neither is the customer outcome, which lives on
 * the conversation. A surface that collapsed them would render approved as
 * completed, which is the claim this whole path exists to stop making.
 */
export interface AssistantReviewRowDTO {
  id: string
  conversationId: string | null
  ticketId: string | null
  toolName: string
  summary: string
  originRole: AssistantPendingAction['originRole']
  status: string
  executionState: AssistantPendingAction['executionState']
  executionError: string | null
  proposedAt: string
  expiresAt: string
  /** The receipt a person reconciles, when the execution is unconfirmed. */
  receiptId: string | null
  /** What the provider was asked to do, for the unconfirmed case. */
  dispatchedAt: string | null
}

/** Keep only the rows this viewer may actually act on, by their real parent. */
async function visibleToViewer(
  rows: readonly AssistantPendingAction[],
  actor: Awaited<ReturnType<typeof policyActorFromAuth>>,
  limit: number
): Promise<AssistantPendingAction[]> {
  const out: AssistantPendingAction[] = []
  for (const row of rows) {
    if (out.length >= limit) break
    try {
      if (row.conversationId) await assertConversationViewable(row.conversationId, actor)
      else if (row.ticketId) await assertTicketVisible(row.ticketId, actor)
      else continue
      out.push(row)
    } catch {
      // Not visible to this teammate. Skipped rather than reported, exactly as
      // the single-row read does: an invisible proposal reads as one that does
      // not exist.
    }
  }
  return out
}

/**
 * The Needs approval queue: proposals this viewer may decide, plus the
 * approved actions whose outcome nobody has confirmed.
 *
 * Both halves are permission-scoped the same way every other read of these
 * rows is: the base gate says the caller is an inbox teammate, and each row is
 * kept only if they can see the item it belongs to.
 */
export const listAssistantReviewQueueFn = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
  const actor = await policyActorFromAuth(auth)
  const [proposed, unconfirmed, receipts] = await Promise.all([
    listDecidablePendingActions(100),
    listUnconfirmedPendingActions(50),
    listUnreconciledToolCalls(100),
  ])
  const receiptByAction = new Map(
    receipts.filter((r) => r.pendingActionId).map((r) => [r.pendingActionId as string, r])
  )
  const [visibleProposed, visibleUnconfirmed] = await Promise.all([
    visibleToViewer(proposed, actor, 50),
    visibleToViewer(unconfirmed, actor, 25),
  ])
  const toRow = (row: AssistantPendingAction): AssistantReviewRowDTO => {
    const receipt = receiptByAction.get(row.id)
    return {
      id: row.id,
      conversationId: row.conversationId,
      ticketId: row.ticketId,
      toolName: row.toolName,
      summary: row.summary,
      originRole: row.originRole,
      status: row.status,
      executionState: row.executionState,
      executionError: row.executionError,
      proposedAt: row.proposedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      receiptId: receipt?.id ?? null,
      dispatchedAt: receipt?.dispatchedAt?.toISOString() ?? null,
    }
  }
  return {
    proposed: visibleProposed.map(toRow),
    unconfirmed: visibleUnconfirmed.map(toRow),
  }
})

const ReconcileInput = z
  .object({
    /** The receipt itself, for an autonomous effect with no proposal behind it. */
    receiptId: z.string().optional(),
    /** The proposal, for the inline card, which only ever knows the action. */
    pendingActionId: z.string().optional(),
    verdict: z.enum(['resolved', 'failed']),
    note: z.string().min(1).max(500),
  })
  .refine((v) => !!v.receiptId || !!v.pendingActionId, {
    message: 'A receipt or a pending action is required',
  })

/**
 * Record a person's verdict on an effect nobody could confirm.
 *
 * Two verdicts, and neither repeats the write. A button that re-sent an
 * unconfirmed mutation is precisely the thing the unknown state exists to
 * prevent; an operator who decides the action should happen after all issues a
 * new request, which is a new proposal and a new decision.
 */
export const reconcileAssistantActionFn = createServerFn({ method: 'POST' })
  .validator(ReconcileInput)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
    const actor = await policyActorFromAuth(auth)
    const receipt = data.receiptId
      ? await getToolCallById(data.receiptId as AssistantToolCallId)
      : await findReceiptForPendingAction(data.pendingActionId as AssistantPendingActionId)
    if (!receipt) throw new NotFoundError('TOOL_CALL_NOT_FOUND', 'Action record not found')
    // Row-level authz, the same shape as approve/reject: seeing the item is
    // what authorizes a judgement about an action taken inside it.
    // Receipts have no ticket column. A proposal supplies its actual parent;
    // autonomous receipts can only resolve through their conversation.
    const parent = receipt.pendingActionId
      ? await getPendingActionById(receipt.pendingActionId)
      : receipt.conversationId
        ? { conversationId: receipt.conversationId, ticketId: null }
        : null
    if (parent?.conversationId) await assertConversationViewable(parent.conversationId, actor)
    else if (parent?.ticketId) await assertTicketVisible(parent.ticketId, actor)
    else throw new NotFoundError('TOOL_CALL_NOT_FOUND', 'Action record not found')
    const settled = await reconcileToolCall(receipt.id, {
      verdict: data.verdict,
      note: data.note,
      principalId: auth.principal.id,
    })
    if (!settled) {
      throw new ConflictError('TOOL_CALL_NOT_RECONCILABLE', 'This action no longer needs a verdict')
    }
    // The proposal follows its receipt: a verdict on the effect is a verdict
    // on the action, and leaving the row on `unknown` would keep it in the
    // review queue forever.
    if (settled.pendingActionId) {
      await settleReconciledPendingAction(settled.pendingActionId, data.verdict, data.note)
    }
    return { id: settled.id, reconciliationState: settled.reconciliationState }
  })
