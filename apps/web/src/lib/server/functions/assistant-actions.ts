import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { AssistantPendingActionId } from '@quackback/ids'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import type { AssistantPendingAction } from '@/lib/server/domains/assistant/pending-actions.service'
import type { JsonValue } from '@/lib/shared/json'

const PendingActionInput = z.object({ pendingActionId: z.string() })

// createServerFn constrains returns to provably serializable types; the row's
// jsonb columns are typed Record<string, unknown> (unknown isn't provably
// serializable) and its timestamps are Date. The stored jsonb is JSON at
// runtime and Dates serialize to ISO strings over the wire, so this DTO is a
// safe reshape, not a lossy one.
export interface AssistantPendingActionDTO {
  id: string
  // The stored action has one conversation, ticket or private workspace parent.
  conversationId: string | null
  ticketId: string | null
  workspaceThreadKey: string | null
  involvementId: string | null
  toolName: string
  args: JsonValue
  summary: string
  originRole: AssistantPendingAction['originRole']
  status: string
  proposedAt: string
  expiresAt: string
  decidedById: string | null
  decidedAt: string | null
  executedAt: string | null
  result: JsonValue | null
}

function toDTO(row: AssistantPendingAction): AssistantPendingActionDTO {
  return {
    id: row.id,
    conversationId: row.conversationId,
    ticketId: row.ticketId,
    workspaceThreadKey: row.workspaceThreadKey ?? null,
    involvementId: row.involvementId,
    toolName: row.toolName,
    args: row.args as JsonValue,
    summary: row.summary,
    originRole: row.originRole,
    status: row.status,
    proposedAt: row.proposedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    decidedById: row.decidedById,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    executedAt: row.executedAt?.toISOString() ?? null,
    result: (row.result as JsonValue | null) ?? null,
  }
}

export const approveAssistantActionFn = createServerFn({ method: 'POST' })
  .validator(PendingActionInput)
  .handler(async ({ data }) => {
    // Base gate: any inbox teammate may act on the queue. The real
    // authority check is per-proposal, below (every permission the
    // proposed tool declares).
    const auth = await requireAuth()
    const actor = await policyActorFromAuth(auth)
    const { decideAssistantAction } =
      await import('@/lib/server/domains/assistant/assistant-actions.service')
    const settled = await decideAssistantAction(
      data.pendingActionId as AssistantPendingActionId,
      'approved',
      auth.principal.id,
      actor
    )
    return toDTO(settled)
  })

export const rejectAssistantActionFn = createServerFn({ method: 'POST' })
  .validator(PendingActionInput)
  .handler(async ({ data }) => {
    // Same base gate as approve — see the comment there.
    const auth = await requireAuth()
    const actor = await policyActorFromAuth(auth)
    const { decideAssistantAction } =
      await import('@/lib/server/domains/assistant/assistant-actions.service')
    const settled = await decideAssistantAction(
      data.pendingActionId as AssistantPendingActionId,
      'rejected',
      auth.principal.id,
      actor
    )
    return toDTO(settled)
  })
