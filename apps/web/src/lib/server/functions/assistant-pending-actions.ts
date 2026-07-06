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
import type { AssistantPendingActionId } from '@quackback/ids'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { NotFoundError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import {
  getPendingActionById,
  type AssistantPendingAction,
} from '@/lib/server/domains/assistant/pending-actions.service'
import { assertConversationViewable } from '@/lib/server/domains/conversation/conversation.service'
import { assertTicketVisible } from '@/lib/server/domains/tickets/ticket.service'
import type { AssistantPendingActionDTO } from './assistant-actions'

const log = logger.child({ component: 'assistant-pending-actions-fn' })

const PendingActionInput = z.object({ pendingActionId: z.string() })

// Mirrors assistant-actions.ts's toDTO. Not imported from there (that file is
// owned by another approval-flow change and shouldn't gain new exports for
// this) — the reshape is a few fields, so a local copy is cheaper than
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
    status: row.status,
    proposedAt: row.proposedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    decidedById: row.decidedById,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    executedAt: row.executedAt?.toISOString() ?? null,
    result: (row.result as AssistantPendingActionDTO['result']) ?? null,
  }
}

export const getAssistantPendingActionFn = createServerFn({ method: 'GET' })
  .validator(PendingActionInput)
  .handler(async ({ data }) => {
    try {
      // Base gate: any inbox teammate may open the approval queue.
      const auth = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
      const row = await getPendingActionById(data.pendingActionId as AssistantPendingActionId)
      if (!row) throw new NotFoundError('PENDING_ACTION_NOT_FOUND', 'Pending action not found')
      // Row-level authz (unified inbox §3.3): see this file's doc comment —
      // the base gate above only confirms conversation.view SOMEWHERE.
      const actor = await policyActorFromAuth(auth)
      if (row.conversationId) {
        await assertConversationViewable(row.conversationId, actor)
      } else if (row.ticketId) {
        await assertTicketVisible(row.ticketId, actor)
      }
      return toDTO(row)
    } catch (error) {
      log.error({ err: error }, 'fetch assistant pending action failed')
      throw error
    }
  })
