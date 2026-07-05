/**
 * Read-only fetch for a live pending-action row, by id.
 *
 * The inbox approval card renders from an internal note's metadata pointer
 * (pendingActionId + toolName + summary), which is only a point-in-time
 * snapshot taken when Quinn proposed the action. This fn is how the card
 * learns the CURRENT status (approved/rejected/executed/failed/expired)
 * instead of trusting that stale snapshot. Same base gate as approve/reject
 * (any inbox teammate may view the queue) — this is a read, so no further
 * per-proposal authority check is needed.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { AssistantPendingActionId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { NotFoundError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import {
  getPendingActionById,
  type AssistantPendingAction,
} from '@/lib/server/domains/assistant/pending-actions.service'
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
      await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
      const row = await getPendingActionById(data.pendingActionId as AssistantPendingActionId)
      if (!row) throw new NotFoundError('PENDING_ACTION_NOT_FOUND', 'Pending action not found')
      return toDTO(row)
    } catch (error) {
      log.error({ err: error }, 'fetch assistant pending action failed')
      throw error
    }
  })
