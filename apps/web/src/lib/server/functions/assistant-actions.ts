/**
 * Approve/reject server fns for Quinn's pending write-tool proposals.
 *
 * Base gate is conversation.view (any inbox teammate may open the approval
 * queue); the actual authority check is per-proposal: the approver must hold
 * every permission the proposed tool declares, so approval can never grant
 * more than the approver already has themself. Approve executes immediately
 * via the same claim/execute/finalize pipeline autonomous mode uses.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { db } from '@/lib/server/db'
import type { AssistantPendingActionId, PrincipalId } from '@quackback/ids'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import type { Actor } from '@/lib/server/policy/types'
import { can } from '@/lib/server/policy/authorize'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { NotFoundError, ForbiddenError, ConflictError, DomainException } from '@/lib/shared/errors'
import type { JsonValue } from '@/lib/shared/json'
import { logger } from '@/lib/server/logger'
import {
  getPendingActionById,
  decidePendingAction,
  markPendingActionExecuted,
  markPendingActionFailed,
  type AssistantPendingAction,
} from '@/lib/server/domains/assistant/pending-actions.service'
import {
  getToolSpecByName,
  makeAssistantToolContext,
  type AssistantToolContext,
} from '@/lib/server/domains/assistant/assistant.toolspec'
import { resolveContentAudience } from '@/lib/server/domains/assistant/audience'
import { executeApprovedPendingAction } from '@/lib/server/domains/assistant/assistant.tools'
import { ensureAssistantPrincipal } from '@/lib/server/domains/assistant/assistant.principal'

const log = logger.child({ component: 'assistant-actions' })

const PendingActionInput = z.object({ pendingActionId: z.string() })

// createServerFn constrains returns to provably serializable types; the row's
// jsonb columns are typed Record<string, unknown> (unknown isn't provably
// serializable) and its timestamps are Date. The stored jsonb is JSON at
// runtime and Dates serialize to ISO strings over the wire, so this DTO is a
// safe reshape, not a lossy one.
export interface AssistantPendingActionDTO {
  id: string
  // Polymorphic parent (unified inbox §3.3): null for a ticket-scoped pending
  // action. The approval queue UI doesn't surface ticket-scoped actions yet,
  // but the read shape must match the row so a nullable column here doesn't
  // silently coerce to a bogus non-null string on the wire.
  conversationId: string | null
  involvementId: string | null
  toolName: string
  args: JsonValue
  summary: string
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
    involvementId: row.involvementId,
    toolName: row.toolName,
    args: row.args as JsonValue,
    summary: row.summary,
    status: row.status,
    proposedAt: row.proposedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    decidedById: row.decidedById,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    executedAt: row.executedAt?.toISOString() ?? null,
    result: (row.result as JsonValue | null) ?? null,
  }
}

/** The proposed tool no longer exists in the catalogue (renamed/removed since the proposal). */
class ToolSpecGoneError extends DomainException {
  readonly statusCode = 410
  constructor(toolName: string) {
    super('ASSISTANT_TOOL_GONE', `The "${toolName}" action is no longer available.`)
  }
}

/** Build the tool-execution context an approved action runs under — Quinn's
 *  own identity, never the approver's, since the approver only authorizes it. */
async function buildExecutionContext(
  pending: AssistantPendingAction
): Promise<AssistantToolContext> {
  const assistant = await ensureAssistantPrincipal()
  // simulate is explicit: the conversation id is always set here, but this
  // path executes for real regardless of how the default would derive.
  return makeAssistantToolContext({
    db,
    assistantPrincipalId: assistant.id,
    // A teammate approved this proposal from the inbox approval queue — the
    // same teammate-facing surface as copilot — so it resolves through the
    // same allow-list as any other context construction, rather than writing
    // the 'team' literal directly. This executor never runs for a
    // customer-facing surface's proposals, so 'copilot' is the correct fixed
    // choice, not a per-call parameter.
    audience: resolveContentAudience('copilot'),
    conversationId: pending.conversationId,
    involvementId: pending.involvementId,
    simulate: false,
  })
}

/**
 * Decide a proposal and, on approval, execute it. Shared by approve/reject so
 * the load -> authorize -> decide sequencing (and its error mapping) lives in
 * exactly one place. `actor` is the approver's own resolved policy actor —
 * the permission check below can never authorize more than they already hold.
 */
async function decideAssistantAction(
  pendingActionId: AssistantPendingActionId,
  decision: 'approved' | 'rejected',
  approverPrincipalId: PrincipalId,
  actor: Actor
): Promise<AssistantPendingAction> {
  const pending = await getPendingActionById(pendingActionId)
  if (!pending) throw new NotFoundError('PENDING_ACTION_NOT_FOUND', 'Pending action not found')

  const spec = await getToolSpecByName(pending.toolName)
  if (!spec) throw new ToolSpecGoneError(pending.toolName)

  for (const permission of spec.permissions) {
    if (!can(actor, permission)) {
      throw new ForbiddenError(
        'ASSISTANT_ACTION_PERMISSION_DENIED',
        `Approving this action requires the '${permission}' permission`
      )
    }
  }

  const decided = await decidePendingAction(pendingActionId, decision, approverPrincipalId)
  if (!decided) {
    throw new ConflictError(
      'PENDING_ACTION_NOT_DECIDABLE',
      'This request was already decided or has expired'
    )
  }
  if (decision === 'rejected') return decided

  const ctx = await buildExecutionContext(decided)
  const outcome = await executeApprovedPendingAction(spec, decided, ctx)
  if (outcome.status === 'executed') {
    return (
      (await markPendingActionExecuted(
        pendingActionId,
        (outcome.result as Record<string, unknown> | null) ?? null
      )) ?? decided
    )
  }
  if (outcome.status === 'failed') {
    return (await markPendingActionFailed(pendingActionId, outcome.error)) ?? decided
  }
  // skipped_duplicate: a racing call already executed this proposal.
  return decided
}

export const approveAssistantActionFn = createServerFn({ method: 'POST' })
  .validator(PendingActionInput)
  .handler(async ({ data }) => {
    try {
      // Base gate: any inbox teammate may act on the queue. The real
      // authority check is per-proposal, below (every permission the
      // proposed tool declares).
      const auth = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
      const actor = await policyActorFromAuth(auth)
      const settled = await decideAssistantAction(
        data.pendingActionId as AssistantPendingActionId,
        'approved',
        auth.principal.id,
        actor
      )
      return toDTO(settled)
    } catch (error) {
      log.error({ err: error }, 'approve assistant action failed')
      throw error
    }
  })

export const rejectAssistantActionFn = createServerFn({ method: 'POST' })
  .validator(PendingActionInput)
  .handler(async ({ data }) => {
    try {
      // Same base gate as approve — see the comment there.
      const auth = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
      const actor = await policyActorFromAuth(auth)
      const settled = await decideAssistantAction(
        data.pendingActionId as AssistantPendingActionId,
        'rejected',
        auth.principal.id,
        actor
      )
      return toDTO(settled)
    } catch (error) {
      log.error({ err: error }, 'reject assistant action failed')
      throw error
    }
  })
