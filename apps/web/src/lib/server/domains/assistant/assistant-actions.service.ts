import { assertPendingWorkspaceParent } from './pending-action-parent'
import { agentKindForTurn, isConnectorTool, isHomeThreadKey } from './workspace-safety'
import { toolPermissions } from './tool-permissions'
import { db } from '@/lib/server/db'
import type { AssistantPendingActionId, PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { can } from '@/lib/server/policy/authorize'
import { NotFoundError, ForbiddenError, ConflictError, DomainException } from '@/lib/shared/errors'
import { assertConversationViewable } from '@/lib/server/domains/conversation/conversation.service'
import { assertTicketVisible } from '@/lib/server/domains/tickets/ticket.service'
import {
  getPendingActionById,
  decidePendingAction,
  markPendingActionExecuted,
  markPendingActionFailed,
  type AssistantPendingAction,
} from './pending-actions.service'
import {
  getToolSpecByName,
  makeAssistantToolContext,
  type AssistantToolContext,
} from './assistant.toolspec'
import { resolveContentAudience } from './audience'
import { getConnectorSpecByToolName } from './connectors/connector-tools'
import { getWorkspaceMcpSpecByName } from './mcp-workspace-tools'
import { executeApprovedPendingAction } from './assistant.tools'
import { ASSISTANT_DEFAULT_NAME, ensureAssistantPrincipal } from './assistant.principal'

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
    assistantName: assistant.displayName ?? ASSISTANT_DEFAULT_NAME,
    role: pending.originRole,
    audience: resolveContentAudience(
      pending.originRole === 'customer_support' ? 'widget' : 'copilot'
    ),
    conversationId: pending.conversationId,
    ticketId: pending.ticketId,
    involvementId: pending.involvementId,
    workspaceThreadKey: pending.workspaceThreadKey ?? undefined,
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
export async function decideAssistantAction(
  pendingActionId: AssistantPendingActionId,
  decision: 'approved' | 'rejected',
  approverPrincipalId: PrincipalId,
  actor: Actor,
  verifiedThreadKey?: string
): Promise<AssistantPendingAction> {
  const pending = await getPendingActionById(pendingActionId)
  if (!pending) throw new NotFoundError('PENDING_ACTION_NOT_FOUND', 'Pending action not found')
  await assertPendingWorkspaceParent(pending, actor, verifiedThreadKey)

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

  const agentKind = agentKindForTurn(pending.originRole, pending.workspaceThreadKey)
  if (isHomeThreadKey(pending.workspaceThreadKey)) {
    if (pending.toolName === 'propose_settings_change') {
      const { settingsProposalSchema } = await import('@/lib/shared/assistant/settings-proposals')
      const { applyWorkspaceSettingsProposal } =
        await import('@/lib/server/domains/assistant/workspace-settings-actions.service')
      const proposal = settingsProposalSchema.parse(pending.args)
      return applyWorkspaceSettingsProposal(
        actor,
        pending.id,
        proposal.changes.map((change) => change.id)
      )
    }
    // Home allows exactly one other decision: a connector read the teammate
    // lets run. A connector write is never executed from Home.
    if (!isConnectorTool(pending.toolName))
      throw new ConflictError(
        'ASSISTANT_ACTION_POLICY_CHANGED',
        'Open the settings page to make this change'
      )
    return allowHomeConnectorRead(pending, approverPrincipalId, actor, agentKind)
  }

  // Built-in specs resolve from the static registry; a custom action
  // (Phase 5) persists an `action_<slug>` toolName that lives only in the DB,
  // so fall back to the dynamic resolver keyed by the proposal's origin agent
  // (the deterministic name set is recomputed there — see
  // getActionSpecByToolName). A definition since disabled, unassigned,
  // renamed, or removed resolves to null and reads as "no longer available",
  // exactly like a gone built-in.
  const spec =
    (await getToolSpecByName(pending.toolName)) ??
    (await getConnectorSpecByToolName(pending.toolName, agentKind)) ??
    (pending.originRole === 'workspace_assistant'
      ? await getWorkspaceMcpSpecByName(pending.toolName, actor, ASSISTANT_DEFAULT_NAME)
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

  for (const permission of toolPermissions(spec, !!pending.workspaceThreadKey)) {
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

/**
 * Run a connector read the teammate allowed from Home. The spec is resolved
 * again so a tool the connector now marks as a write, or one since removed,
 * never runs.
 */
async function allowHomeConnectorRead(
  pending: AssistantPendingAction,
  approverPrincipalId: PrincipalId,
  actor: Actor,
  agentKind: ReturnType<typeof agentKindForTurn>
): Promise<AssistantPendingAction> {
  const spec = await getConnectorSpecByToolName(pending.toolName, agentKind)
  if (!spec) throw new ToolSpecGoneError(pending.toolName)
  if (spec.risk !== 'read')
    throw new ConflictError(
      'ASSISTANT_ACTION_POLICY_CHANGED',
      'Connector changes are never made from Home'
    )
  const parsedArgs = spec.definition.inputSchema.safeParse(pending.args)
  if (!parsedArgs.success)
    throw new ConflictError(
      'ASSISTANT_ACTION_INPUT_CHANGED',
      'This action no longer matches the current input contract'
    )
  const decided = await decidePendingAction(pending.id, 'approved', approverPrincipalId)
  if (!decided)
    throw new ConflictError(
      'PENDING_ACTION_NOT_DECIDABLE',
      'This request was already decided or has expired'
    )
  const validated = { ...decided, args: parsedArgs.data as Record<string, unknown> }
  const ctx = await buildExecutionContext(validated, actor)
  const outcome = await executeApprovedPendingAction(spec, validated, ctx)
  if (outcome.status === 'executed')
    return (
      (await markPendingActionExecuted(
        pending.id,
        (outcome.result as Record<string, unknown> | null) ?? null
      )) ?? decided
    )
  if (outcome.status === 'failed')
    return (await markPendingActionFailed(pending.id, outcome.error)) ?? decided
  return decided
}
