/**
 * Approve/reject server fns for Quinn's pending write-tool proposals.
 *
 * Base gate is conversation.view (any inbox teammate may open the approval
 * queue); the actual authority is per-proposal, in two parts: (1) the
 * approver must be able to VIEW the proposal's actual parent — a real
 * conversation or ticket visibility check (`assertConversationViewable` /
 * `assertTicketVisible`), not just the base permission — and (2) the approver
 * must hold every permission the proposed tool declares, so approval can
 * never grant more than the approver already has themself. Approve executes
 * immediately via the same claim/execute/finalize pipeline autonomous mode
 * uses.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { db } from '@/lib/server/db'
import type { AssistantPendingActionId, PrincipalId } from '@quackback/ids'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import type { Actor } from '@/lib/server/policy/types'
import { can } from '@/lib/server/policy/authorize'
import { NotFoundError, ForbiddenError, ConflictError, DomainException } from '@/lib/shared/errors'
import type { JsonValue } from '@/lib/shared/json'
import { logger } from '@/lib/server/logger'
import { assertConversationViewable } from '@/lib/server/domains/conversation/conversation.service'
import { assertTicketVisible } from '@/lib/server/domains/tickets/ticket.service'
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
  // Polymorphic parent (unified inbox §3.3): exactly one of these two is set.
  // The approval queue UI doesn't surface ticket-scoped actions yet, but the
  // read shape must match the row so a nullable column here doesn't silently
  // coerce to a bogus non-null string on the wire.
  conversationId: string | null
  ticketId: string | null
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

/** The proposed tool no longer exists in the catalogue (renamed/removed since the proposal). */
class ToolSpecGoneError extends DomainException {
  readonly statusCode = 410
  constructor(toolName: string) {
    super('ASSISTANT_TOOL_GONE', `The "${toolName}" action is no longer available.`)
  }
}

/** Build the tool-execution context for an approved action. Records remain
 * attributed to Quinn, while authorization and domain writes use the approving
 * teammate's actor. */
async function buildExecutionContext(
  pending: AssistantPendingAction,
  approver: Actor
): Promise<AssistantToolContext> {
  const assistant = await ensureAssistantPrincipal()
  // simulate is explicit: the conversation id is always set here, but this
  // path executes for real regardless of how the default would derive.
  return makeAssistantToolContext({
    db,
    assistantPrincipalId: assistant.id,
    assistantName: assistant.displayName ?? 'Quinn',
    role: pending.originRole,
    audience: resolveContentAudience(
      pending.originRole === 'customer_support' ? 'widget' : 'copilot'
    ),
    conversationId: pending.conversationId,
    ticketId: pending.ticketId,
    involvementId: pending.involvementId,
    simulate: false,
    actor: approver,
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

  // Row-level authz (unified inbox §3.3): the route's base gate only confirms
  // the approver holds conversation.view SOMEWHERE, not that they may see
  // THIS proposal's actual item. Both helpers throw NotFoundError (never
  // Forbidden) when the actor can't view the row's parent, so a proposal
  // outside the approver's visibility reads exactly like one that doesn't
  // exist, matching every other conversation/ticket read in the app.
  if (pending.conversationId) {
    await assertConversationViewable(pending.conversationId, actor)
  } else if (pending.ticketId) {
    await assertTicketVisible(pending.ticketId, actor)
  }

  if (decision === 'rejected') {
    const rejected = await decidePendingAction(pendingActionId, decision, approverPrincipalId)
    if (!rejected) {
      throw new ConflictError(
        'PENDING_ACTION_NOT_DECIDABLE',
        'This request was already decided or has expired'
      )
    }
    return rejected
  }

  // Built-in specs resolve from the static registry. A tool name that no
  // longer resolves (e.g. the spec was removed) reads as "no longer available".
  const spec = await getToolSpecByName(pending.toolName)
  if (!spec) throw new ToolSpecGoneError(pending.toolName)
  const parentKind = pending.conversationId ? 'conversation' : 'ticket'
  if (spec.risk !== 'write' || !spec.parents.includes(parentKind)) {
    throw new ConflictError(
      'ASSISTANT_ACTION_POLICY_CHANGED',
      'This action no longer supports approval for this item'
    )
  }
  const parsedArgs = spec.definition.inputSchema.safeParse(pending.args)
  if (!parsedArgs.success) {
    throw new ConflictError(
      'ASSISTANT_ACTION_INPUT_CHANGED',
      'This action no longer matches the current input contract'
    )
  }

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
  const validated = { ...decided, args: parsedArgs.data as Record<string, unknown> }
  const ctx = await buildExecutionContext(validated, actor)
  const outcome = await executeApprovedPendingAction(spec, validated, ctx)
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
      const auth = await requireAuth()
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
      const auth = await requireAuth()
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
