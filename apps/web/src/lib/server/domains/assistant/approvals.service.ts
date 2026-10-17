/**
 * Approvals: who may decide a pending action, and what a decision binds to.
 *
 * A pending action is an approval. It records who asked (the credential or
 * agent, and the person whose authority it borrows), the risk the server set
 * for the operation, and the digest of the exact content proposed. The rules
 * every decision path enforces live here, once:
 *
 * - People decide, never the credential or agent that asked, and never
 *   another agent. Any person who holds every permission the action needs
 *   may decide, not only the requester's owner.
 * - A decision names the content it approved. A pending approval is never
 *   edited, and a decision whose digest is not the stored content's fails.
 * - High risk needs an admin who signed in again; critical is never decided
 *   through an approval.
 *
 * The status transitions themselves stay compare-and-set updates in
 * pending-actions.service.ts, which also emits the approval events.
 */
import {
  db,
  eq,
  and,
  inArray,
  isNull,
  principal,
  assistantPendingActions,
  type ApprovalDecisionChannel,
  type ApprovalRequestChannel,
  type ApprovalRisk,
  type Database,
  type Transaction,
} from '@/lib/server/db'
import type { AssistantPendingActionId, PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { permissionsForPrincipal } from '@/lib/server/policy/permissions'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/shared/errors'
import { digestOf } from '@/lib/server/utils/canonical-json'
import { settingsProposalSchema } from '@/lib/shared/assistant/settings-proposals'
import {
  SETTINGS_PROPOSAL_TOOL,
  settingsProposalPermissions,
  settingsProposalRisk,
  higherRisk,
  toolApprovalRisk,
} from './approval-policy'
import { isHomeThreadKey } from './workspace-safety'

type PendingActionRow = typeof assistantPendingActions.$inferSelect
type Executor = Database | Transaction

/** Who filed a request. Stored on the row; never used to authorize a decision. */
export interface ApprovalRequester {
  via: ApprovalRequestChannel
  /** The principal that filed it: an API key's service principal, the AI assistant, or a person. */
  requestedById?: PrincipalId | null
  /** The person whose authority the request borrows. */
  onBehalfOfPrincipalId?: PrincipalId | null
  /** The API key id or OAuth client id it arrived through. */
  credentialId?: string | null
  clientName?: string | null
}

/** The requester columns of a new pending action. */
export function requesterColumns(requester: ApprovalRequester | undefined) {
  return {
    requestedVia: requester?.via ?? null,
    requestedById: requester?.requestedById ?? null,
    onBehalfOfPrincipalId: requester?.onBehalfOfPrincipalId ?? null,
    credentialId: requester?.credentialId ?? null,
    clientName: requester?.clientName ?? null,
  }
}

/** What a person sends with a decision. */
export interface ApprovalDecisionInput {
  /** The digest of the content the person was shown. */
  contentHash: string
  via?: ApprovalDecisionChannel
  /** Why, for a rejection. */
  reason?: string | null
  /**
   * The person signed in again just before deciding. Required to approve a
   * high-risk request. Only server code that verified the sign-in may set it.
   */
  freshSignIn?: boolean
  /** The credential the decision arrived through, when it did not come from a session. */
  credentialId?: string | null
}

/** The longest rejection reason kept. */
const MAX_REASON_LENGTH = 500

/** A rejection reason as stored: trimmed, bounded, and null when blank. */
export function normalizeDecisionReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim()
  return trimmed ? trimmed.slice(0, MAX_REASON_LENGTH) : null
}

/** The digest of a request's content, the value a decision binds to. */
export function approvalContentDigest(args: Record<string, unknown>): string {
  return digestOf(args)
}

/** The risk of a request: the tier set when it was filed, else read off its content. */
export function approvalRiskOf(row: Pick<PendingActionRow, 'risk' | 'toolName' | 'args'>) {
  if (row.toolName === SETTINGS_PROPOSAL_TOOL) {
    const parsed = settingsProposalSchema.safeParse(row.args)
    if (parsed.success) return higherRisk(row.risk ?? 'low', settingsProposalRisk(parsed.data))
  }
  const operationRisk = toolApprovalRisk(row.toolName, row.args)
  return operationRisk === 'high'
    ? higherRisk(row.risk ?? 'low', operationRisk)
    : (row.risk ?? operationRisk)
}

/**
 * The digest a decision on this request must name, as shown to a person: the
 * digest of the content being shown.
 *
 * Every request filed now stores one that matches its content. Two kinds of
 * row do not: one filed before digests were kept (none stored), and one an
 * older instance edited in place while merging same-turn requests (a stored
 * digest its content no longer matches, which every decision would refuse
 * until it expired). Either is bound to the content shown now, with a
 * compare-and-set on the value that was read, so the person decides what they
 * see and a decision naming anything else is refused.
 */
export async function digestForDisplay(
  row: PendingActionRow,
  exec: Executor = db
): Promise<string> {
  const digest = approvalContentDigest(row.args)
  if (row.argsDigest === digest || row.status !== 'proposed') return digest
  await exec
    .update(assistantPendingActions)
    .set({ argsDigest: digest })
    .where(
      and(
        eq(assistantPendingActions.id, row.id),
        row.argsDigest === null
          ? isNull(assistantPendingActions.argsDigest)
          : eq(assistantPendingActions.argsDigest, row.argsDigest)
      )
    )
  // If another reader moved the digest first, the one returned here still
  // names exactly what this reader shows; a decision on it lands only if the
  // stored digest and the content agree with it.
  return digest
}

/** The approval fields a card shows beside a request: the digest to decide on, and the risk. */
export async function approvalFieldsForDisplay(
  row: PendingActionRow,
  exec: Executor = db
): Promise<{ argsDigest: string; risk: ApprovalRisk }> {
  return { argsDigest: await digestForDisplay(row, exec), risk: approvalRiskOf(row) }
}

/**
 * Throw unless a decision names the content that was shown and is still
 * stored. A request whose digest was never stored has not been shown, and a
 * stored digest that no longer matches the content means it changed.
 */
export function assertDecisionNamesContent(row: PendingActionRow, contentHash: string): void {
  if (
    !row.argsDigest ||
    contentHash !== row.argsDigest ||
    row.argsDigest !== approvalContentDigest(row.args)
  )
    throw new ConflictError('APPROVAL_CONTENT_CHANGED', 'This request changed. Review it again.')
}

/**
 * Whether a row is a request other people may decide.
 *
 * A Home thread holds one kind: a settings request. Everything else there (a
 * connector read the teammate allows or skips) is the person's own step in
 * their own chat. A thread from a linked chat platform is decided there.
 */
export function isDecidableApproval(
  row: Pick<PendingActionRow, 'workspaceThreadKey' | 'toolName'>
): boolean {
  if (!row.workspaceThreadKey) return true
  return isHomeThreadKey(row.workspaceThreadKey) && row.toolName === SETTINGS_PROPOSAL_TOOL
}

/**
 * Every permission a person needs to decide a request, or null when the
 * operation can no longer be resolved (a tool since removed).
 */
export async function requiredApprovalPermissions(
  row: Pick<PendingActionRow, 'toolName' | 'args' | 'workspaceThreadKey' | 'originRole'>
): Promise<ReadonlySet<PermissionKey> | null> {
  if (row.toolName === SETTINGS_PROPOSAL_TOOL) {
    const parsed = settingsProposalSchema.safeParse(row.args)
    return parsed.success ? settingsProposalPermissions(parsed.data.changes) : null
  }
  const { getToolSpecByName } = await import('./assistant.toolspec')
  const { toolPermissions } = await import('./tool-permissions')
  const workspace = !!row.workspaceThreadKey
  const builtIn = getToolSpecByName(row.toolName)
  if (builtIn) return new Set(toolPermissions(builtIn, workspace))
  const { getConnectorSpecByToolName } = await import('./connectors/connector-tools')
  const { agentKindForTurn } = await import('./workspace-safety')
  const connector = await getConnectorSpecByToolName(
    row.toolName,
    agentKindForTurn(row.originRole, row.workspaceThreadKey)
  )
  return connector ? new Set(toolPermissions(connector, workspace)) : null
}

/**
 * The permissions to judge a request whose operation is gone: someone who
 * manages the AI assistant can still turn it down.
 */
export const GONE_TOOL_PERMISSIONS: ReadonlySet<PermissionKey> = new Set([
  PERMISSIONS.AI_TEAMMATE_MANAGE,
])

/**
 * Throw unless this person may make this decision on this request. Reads the
 * decider's role and permissions again, so a stale session cannot decide with
 * authority it has lost; `actor.permissions` stays a ceiling on top.
 *
 * High risk is decided by admins either way. Only approving it needs a fresh
 * sign-in: that guards against a stolen session making a harmful change, and
 * turning a request down changes nothing.
 */
export async function assertMayDecide(
  row: PendingActionRow,
  actor: Actor,
  input: ApprovalDecisionInput,
  required: ReadonlySet<PermissionKey>,
  decision: 'approved' | 'rejected',
  exec: Executor = db
): Promise<void> {
  // The credential or agent that asked never decides its own request.
  if (
    (actor.principalId && actor.principalId === row.requestedById) ||
    (input.credentialId && row.credentialId && input.credentialId === row.credentialId)
  )
    throw new ForbiddenError(
      'APPROVAL_SELF_DECISION',
      'The requester cannot decide its own request.'
    )
  if (!actor.principalId || actor.principalType !== 'user') throw personRequired()
  const [person] = await exec
    .select({ role: principal.role, type: principal.type })
    .from(principal)
    .where(eq(principal.id, actor.principalId))
    .limit(1)
  if (!person || person.type !== 'user' || (person.role !== 'admin' && person.role !== 'member'))
    throw personRequired()

  // A decision names the content it approved.
  assertDecisionNamesContent(row, input.contentHash)

  const risk = approvalRiskOf(row)
  if (risk === 'critical')
    throw new ForbiddenError('APPROVAL_NOT_AVAILABLE', 'This change can only be made in the app.')
  if (risk === 'high') {
    if (person.role !== 'admin')
      throw new ForbiddenError('APPROVAL_ADMIN_REQUIRED', 'An admin must decide this request.')
    if (decision === 'approved' && !input.freshSignIn)
      throw new ForbiddenError(
        'APPROVAL_SIGN_IN_REQUIRED',
        'Sign in again to approve this request.'
      )
  }

  const held = await permissionsForPrincipal(actor.principalId, person.role, exec)
  for (const permission of required) {
    if (!held.has(permission) || (actor.permissions && !actor.permissions.has(permission)))
      throw new ForbiddenError(
        'APPROVAL_PERMISSION_REQUIRED',
        'You need permission for every change in this request.'
      )
  }
}

function personRequired() {
  return new ForbiddenError('APPROVAL_PERSON_REQUIRED', 'Only a person can decide this request.')
}

/** Whether the person a request borrows authority from is in the app with it. */
export function requesterIsPresent(row: Pick<PendingActionRow, 'requestedVia'>): boolean {
  return row.requestedVia === null || row.requestedVia === 'assistant' || row.requestedVia === 'ui'
}

/** Can this person see the item a request acts on? */
async function parentVisibleTo(row: PendingActionRow, actor: Actor): Promise<boolean> {
  try {
    if (row.conversationId) {
      const { assertConversationViewable } =
        await import('@/lib/server/domains/conversation/conversation.service')
      await assertConversationViewable(row.conversationId, actor)
    } else if (row.ticketId) {
      const { assertTicketVisible } = await import('@/lib/server/domains/tickets/ticket.service')
      await assertTicketVisible(row.ticketId, actor)
    }
    return true
  } catch (err) {
    if (err instanceof NotFoundError) return false
    throw err
  }
}

/**
 * The people a pending request should be brought to: every teammate who may
 * decide it, minus whoever asked. The person whose own assistant asked in the
 * app already has the card in front of them, so they are not told again.
 */
export async function listEligibleDeciders(row: PendingActionRow): Promise<PrincipalId[]> {
  if (row.status !== 'proposed' || row.expiresAt.getTime() <= Date.now()) return []
  if (!isDecidableApproval(row)) return []
  const risk = approvalRiskOf(row)
  if (risk === 'critical') return []
  const required = await requiredApprovalPermissions(row)
  if (!required) return []

  const people = await db
    .select({ id: principal.id, role: principal.role })
    .from(principal)
    .where(
      and(
        eq(principal.type, 'user'),
        inArray(principal.role, risk === 'high' ? ['admin'] : ['admin', 'member'])
      )
    )
  const excluded = new Set<string | null>([
    row.requestedById,
    requesterIsPresent(row) ? row.onBehalfOfPrincipalId : null,
  ])
  const { segmentIdsForPrincipal } =
    await import('@/lib/server/domains/segments/segment-membership.service')
  const eligible: PrincipalId[] = []
  for (const person of people) {
    if (excluded.has(person.id)) continue
    const role = person.role as 'admin' | 'member'
    const permissions = await permissionsForPrincipal(person.id, role)
    if (![...required].every((permission) => permissions.has(permission))) continue
    if (row.conversationId || row.ticketId) {
      const actor: Actor = {
        principalId: person.id,
        role,
        principalType: 'user',
        segmentIds: await segmentIdsForPrincipal(person.id),
        permissions,
      }
      if (!(await parentVisibleTo(row, actor))) continue
    }
    eligible.push(person.id)
  }
  return eligible
}

/**
 * Load a request for a decision, locked. A Home thread is locked before its
 * row, the order every writer of that thread takes, so locks cannot invert.
 */
export async function lockApprovalForDecision(
  id: AssistantPendingActionId,
  tx: Transaction
): Promise<PendingActionRow> {
  const [snapshot] = await tx
    .select({ threadKey: assistantPendingActions.workspaceThreadKey })
    .from(assistantPendingActions)
    .where(eq(assistantPendingActions.id, id))
    .limit(1)
  if (!snapshot) throw approvalNotFound()
  if (snapshot.threadKey) {
    const { lockWorkspaceThread } = await import('./workspace-threads.service')
    await lockWorkspaceThread(snapshot.threadKey, tx)
  }
  const [row] = await tx
    .select()
    .from(assistantPendingActions)
    .where(eq(assistantPendingActions.id, id))
    .limit(1)
    .for('update')
  if (!row) throw approvalNotFound()
  return row
}

export function approvalNotFound() {
  return new NotFoundError('APPROVAL_NOT_FOUND', 'This request was not found.')
}

/** Throw unless the request is still waiting for a decision. */
export function assertStillPending(row: PendingActionRow): void {
  if (row.status !== 'proposed' || row.expiresAt.getTime() <= Date.now())
    throw new ConflictError(
      'PENDING_ACTION_NOT_DECIDABLE',
      'This request was already decided or has expired'
    )
}

/**
 * Approve a request and carry it out with the executor its origin uses: the
 * settings apply for a settings request, the tool-action pipeline for an
 * action on a conversation or ticket. Every rule above applies before
 * anything runs, and the executor checks the content hash again as it
 * decides.
 */
export async function approveApproval(
  actor: Actor,
  id: AssistantPendingActionId,
  input: ApprovalDecisionInput
): Promise<PendingActionRow> {
  const [row] = await db
    .select()
    .from(assistantPendingActions)
    .where(eq(assistantPendingActions.id, id))
    .limit(1)
  if (!row || !isDecidableApproval(row) || !(await parentVisibleTo(row, actor)))
    throw approvalNotFound()
  assertStillPending(row)
  const decision: ApprovalDecisionInput = { ...input, via: input.via ?? 'app' }

  if (row.toolName === SETTINGS_PROPOSAL_TOOL) {
    const parsed = settingsProposalSchema.safeParse(row.args)
    if (!parsed.success) throw approvalUnavailable()
    const { applyWorkspaceSettingsProposal } = await import('./workspace-settings-actions.service')
    return applyWorkspaceSettingsProposal(
      actor,
      id,
      parsed.data.changes.map((change) => change.id),
      decision
    )
  }

  if (!row.conversationId && !row.ticketId) throw approvalUnavailable()
  const required = (await requiredApprovalPermissions(row)) ?? GONE_TOOL_PERMISSIONS
  await assertMayDecide(row, actor, decision, required, 'approved')
  const { decideAssistantAction } = await import('./assistant-actions.service')
  return decideAssistantAction(id, 'approved', actor.principalId!, actor, undefined, {
    contentHash: decision.contentHash,
    via: decision.via,
    freshSignIn: decision.freshSignIn,
  })
}

function approvalUnavailable() {
  return new ConflictError(
    'APPROVAL_NOT_AVAILABLE',
    'This request can only be decided where it was made.'
  )
}

/**
 * Reject a request with an optional reason. Any person who may decide it may
 * turn it down; the item's visibility and every rule above apply.
 */
export async function rejectApproval(
  actor: Actor,
  id: AssistantPendingActionId,
  input: ApprovalDecisionInput
): Promise<PendingActionRow> {
  const { decidePendingAction } = await import('./pending-actions.service')
  return db.transaction(async (tx) => {
    const row = await lockApprovalForDecision(id, tx)
    if (!isDecidableApproval(row)) throw approvalNotFound()
    if (!(await parentVisibleTo(row, actor))) throw approvalNotFound()
    assertStillPending(row)
    const required = (await requiredApprovalPermissions(row)) ?? GONE_TOOL_PERMISSIONS
    await assertMayDecide(row, actor, input, required, 'rejected', tx)
    const rejected = await decidePendingAction(id, 'rejected', actor.principalId!, tx, {
      via: input.via ?? 'app',
      reason: input.reason,
      contentHash: input.contentHash,
    })
    if (!rejected)
      throw new ConflictError(
        'PENDING_ACTION_NOT_DECIDABLE',
        'This request was already decided or has expired'
      )
    return rejected
  })
}
