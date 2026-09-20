import { PERMISSIONS } from '@/lib/shared/permissions'
import { toolPermissions } from '@/lib/server/domains/assistant/tool-permissions'
/**
 * Approve/reject server fns for Quinn's pending write-tool proposals.
 *
 * Base gate is conversation.view (any inbox teammate may open the approval
 * queue); the actual authority is per-proposal, in two parts: (1) the
 * approver must be able to VIEW the proposal's actual parent , a real
 * conversation or ticket visibility check (`assertConversationViewable` /
 * `assertTicketVisible`), not just the base permission , and (2) the approver
 * must hold every permission the proposed tool declares, so approval can
 * never grant more than the approver already has themself.
 *
 * Approve no longer executes inside the request. The decision and an execution
 * job commit in one transaction (`decideAndEnqueuePendingAction`) and a worker
 * carries the effect out, re-resolving every gate at the moment of dispatch.
 * What comes back here is approved-and-queued, which is what happened; the card
 * updates through its own refetch when the execution settles.
 */
import { z } from 'zod'
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import type { AssistantPendingActionId, PrincipalId } from '@quackback/ids'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import type { Actor } from '@/lib/server/policy/types'
import { can } from '@/lib/server/policy/authorize'
import { NotFoundError, ForbiddenError, ConflictError, DomainException } from '@/lib/shared/errors'
import type { JsonValue } from '@/lib/shared/json'
import { assertConversationViewable } from '@/lib/server/domains/conversation/conversation.service'
import { assertTicketVisible } from '@/lib/server/domains/tickets/ticket.service'
import {
  getPendingActionById,
  decidePendingAction,
  decideAndEnqueuePendingAction,
  type AssistantPendingAction,
} from '@/lib/server/domains/assistant/pending-actions.service'
import { getToolSpecByName } from '@/lib/server/domains/assistant/assistant.toolspec'
import { resolveConnectorApprovalSpec } from '@/lib/server/domains/assistant/connectors/connector-tools'
import { getWorkspaceMcpSpecByName } from '@/lib/server/domains/assistant/mcp-workspace-tools'
import { roleToAgent } from '@/lib/shared/assistant/config'
import { digestOf } from '@/lib/server/domains/assistant/tool-receipts'

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
  originProfile: AssistantPendingAction['originProfile']
  status: string
  proposedAt: string
  expiresAt: string
  decidedById: string | null
  decidedAt: string | null
  executedAt: string | null
  result: JsonValue | null
  /**
   * Execution, as its own dimension. The card renders decision, execution and
   * customer outcome separately, so approved-and-queued is never drawn as
   * completed; `null` means nothing has been dispatched.
   */
  executionState: AssistantPendingAction['executionState']
  /** The recorded reason a pre-dispatch recheck refused, for the reviewer. */
  executionError: string | null
  /** Why a proposal stopped being decidable without a decision (superseded, refused). */
  disposition: string | null
  /** Who the action is being taken for. Never the approver. */
  requestedById: string | null
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
    originProfile: row.originProfile,
    status: row.status,
    proposedAt: row.proposedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    decidedById: row.decidedById,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    executedAt: row.executedAt?.toISOString() ?? null,
    result: (row.result as JsonValue | null) ?? null,
    executionState: row.executionState,
    executionError: row.executionError,
    disposition: row.disposition,
    requestedById: row.requestedById,
  }
}

/** The proposed tool no longer exists in the catalogue (renamed/removed since the proposal). */
class ToolSpecGoneError extends DomainException {
  readonly statusCode = 410
  constructor(toolName: string) {
    super('ASSISTANT_TOOL_GONE', `The "${toolName}" action is no longer available.`)
  }
}

/**
 * Decide a proposal and, on approval, schedule its execution.
 *
 * Shared by approve/reject so the load -> authorize -> decide sequencing (and
 * its error mapping) lives in exactly one place. `actor` is the approver's own
 * resolved policy actor, and the checks below can never authorize more than
 * they already hold.
 *
 * Approving no longer executes here. The decision and the execution job commit
 * in one transaction and the worker does the rest, so this returns as soon as
 * the row moves: the reviewer is told approved-and-queued, which is what
 * actually happened, rather than waiting on a provider inside their request and
 * being told "completed" by a promise that resolved.
 *
 * The checks that remain here are the ones a reviewer must not get past
 * without an answer: a tool that is gone, a use whose policy has moved, an
 * input the current contract rejects, a permission they do not hold. The worker
 * re-resolves every one of them again at dispatch, because minutes may pass.
 */
export const decideAssistantAction = createServerOnlyFn(async function decideAssistantAction(
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

  // Built-in specs resolve from the static registry; a custom action
  // (Phase 5) persists an `action_<slug>` toolName that lives only in the DB,
  // so fall back to the dynamic resolver keyed by the proposal's origin agent
  // (the deterministic name set is recomputed there , see
  // getActionSpecByToolName). A definition since disabled, unassigned,
  // renamed, or removed resolves to null and reads as "no longer available",
  // exactly like a gone built-in.
  // A connector proposal is re-resolved under the use it was PROPOSED for,
  // taken from the row rather than from the approver: approving a customer's
  // request must not quietly re-authorize it as a teammate action. A tool the
  // current policy now refuses, or whose contract changed and has not been
  // reviewed since, is a conflict rather than a silent execution.
  const connector = await resolveConnectorApprovalSpec({
    toolName: pending.toolName,
    profile: pending.originProfile ?? roleToAgent(pending.originRole),
    proposedPolicyVersion: pending.policyVersion,
  })
  if (connector.status === 'denied') {
    throw new ConflictError(
      'ASSISTANT_ACTION_POLICY_CHANGED',
      connector.reason === 'tool_unreviewed'
        ? 'This action changed since it was requested and needs review before it can run'
        : 'This action is no longer permitted for the use it was requested under'
    )
  }
  const spec =
    (await getToolSpecByName(pending.toolName)) ??
    (connector.status === 'ok' ? connector.spec : null) ??
    (pending.originRole === 'workspace_assistant'
      ? await getWorkspaceMcpSpecByName(pending.toolName, actor, 'Quinn')
      : null)
  if (!spec) throw new ToolSpecGoneError(pending.toolName)
  const parentKind = pending.ticketId ? 'ticket' : 'conversation'
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
  // The contract the card was rendered from, against the one that would run.
  // Only a discovered contract carries a digest; a built-in's lives in this
  // repository, where the parse above is the stronger check.
  if (
    pending.contractDigest &&
    spec.contractDigest &&
    pending.contractDigest !== spec.contractDigest
  ) {
    throw new ConflictError(
      'ASSISTANT_ACTION_INPUT_CHANGED',
      'This action changed since it was requested and needs a new decision'
    )
  }

  for (const permission of toolPermissions(spec, !!pending.workspaceThreadKey)) {
    if (!can(actor, permission)) {
      throw new ForbiddenError(
        'ASSISTANT_ACTION_PERMISSION_DENIED',
        `Approving this action requires the '${permission}' permission`
      )
    }
  }

  // The decision and the execution job commit together. A crash after this
  // returns leaves work that is still claimable, which is the property the
  // previous execute-inside-the-request version could not have.
  const settled = await decideAndEnqueuePendingAction({
    id: pendingActionId,
    decision,
    decidedById: approverPrincipalId,
    // The exact operation the reviewer approved, taken from the parsed args
    // rather than the raw row, so what is compared at dispatch is what would
    // actually run.
    approvedArgsDigest: digestOf(parsedArgs.data as Record<string, unknown>),
  })
  if (!settled) {
    throw new ConflictError(
      'PENDING_ACTION_NOT_DECIDABLE',
      'This request was already decided or has expired'
    )
  }
  return settled.action
})

export const approveAssistantActionFn = createServerFn({ method: 'POST' })
  .validator(PendingActionInput)
  .handler(async ({ data }) => {
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
  })

export const rejectAssistantActionFn = createServerFn({ method: 'POST' })
  .validator(PendingActionInput)
  .handler(async ({ data }) => {
    // Same base gate as approve , see the comment there.
    const auth = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
    const actor = await policyActorFromAuth(auth)
    const settled = await decideAssistantAction(
      data.pendingActionId as AssistantPendingActionId,
      'rejected',
      auth.principal.id,
      actor
    )
    return toDTO(settled)
  })
