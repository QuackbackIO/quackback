import { getLiveBuiltInToolSpec } from './live-tool-rules'
/**
 * Executing an approved action, durably.
 *
 * Approval used to BE execution: the request that carried the reviewer's
 * decision also carried the mutation, so a process death between the two lost
 * the action, a slow provider held the reviewer's browser open, and every
 * authority check happened at the moment of the click rather than at the moment
 * of the effect. This module is the other half of that split. The decision and
 * this job commit together (`decideAndEnqueuePendingAction`); everything below
 * runs later, on a worker, and re-establishes from scratch that the operation
 * is still permitted before anything is dispatched.
 *
 * ## What is re-resolved, and why each one
 *
 * - **The approver.** A decision is authority borrowed from a person; if that
 *   person is gone or has lost the permission the tool declares, the borrowed
 *   authority is gone with it.
 * - **The parent.** Visibility is per item, and an approver who can no longer
 *   see the conversation cannot authorize an action in it.
 * - **The tool, under the proposal's own use.** A customer-origin request keeps
 *   customer scope through approval (the connection gate), so this reads the
 *   use off the row, never off the approver.
 * - **The exact operation.** The approved argument digest and the contract
 *   digest are compared against the live tool. Approval authorizes the recorded
 *   operation, never a newly generated substitute.
 *
 * ## What happens after the effect
 *
 * Three outcomes, three different stories, and none of them is "done":
 * succeeded settles the receipt and asks Quinn to report the real result;
 * failed settles and asks Quinn to explain; unknown settles nothing, marks the
 * receipt for reconciliation, and tells the customer only that a teammate is
 * checking. A result that arrives after a human took the conversation over
 * becomes an internal note instead of a customer message: the provider
 * callback does not get to hand ownership back to Quinn.
 */
import { db, eq } from '@/lib/server/db'
import type { AssistantPendingActionId, PrincipalId } from '@quackback/ids'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { logger } from '@/lib/server/logger'
import { can } from '@/lib/server/policy/authorize'
import type { Actor } from '@/lib/server/policy/types'
import { toolPermissions } from './tool-permissions'
import {
  getPendingActionById,
  markPendingActionExecuted,
  markPendingActionFailed,
  markPendingActionRunning,
  markPendingActionUnknown,
  refusePendingAction,
  type AssistantPendingAction,
} from './pending-actions.service'
import { digestOf } from './tool-receipts'
import type { ActionReport } from './assistant-action.continuation'
import { executeApprovedPendingAction } from './assistant.tools'
import { makeAssistantToolContext } from './assistant.toolspec'
import type { AssistantToolSpec } from './assistant.toolspec'
import { resolveContentAudience } from './audience'
import { resolveConnectorApprovalSpec } from './connectors/connector-tools'
import { getWorkspaceMcpSpecByName } from './mcp-workspace-tools'
import { roleToAgent } from '@/lib/shared/assistant/config'
import { ensureAssistantPrincipal } from './assistant.principal'

const log = logger.child({ component: 'assistant-action-executor' })

/** Why an approved action was refused at the last moment, in a reviewer's words. */
export type ActionRefusal =
  | 'approver_gone'
  | 'approver_permission'
  | 'parent_invisible'
  | 'tool_gone'
  | 'policy_changed'
  | 'arguments_changed'
  | 'contract_changed'

const REFUSAL_NOTES: Record<ActionRefusal, string> = {
  approver_gone: 'The teammate who approved this no longer has an account here.',
  approver_permission: 'The teammate who approved this no longer holds the permission it needs.',
  parent_invisible: 'The teammate who approved this can no longer see this conversation.',
  tool_gone: 'This action is no longer available.',
  policy_changed: 'This action is no longer permitted for the use it was requested under.',
  arguments_changed: 'The request changed after it was approved, so it needs a new decision.',
  contract_changed: 'This action changed after it was approved, so it needs a new decision.',
}

/**
 * Rebuild the approver's authority from their principal row.
 *
 * Deliberately not from anything stored on the proposal: the point is to read
 * the CURRENT answer, so a revoked role or a deleted account refuses here.
 */
async function approverActor(principalId: PrincipalId): Promise<Actor | null> {
  const { principal } = await import('@/lib/server/db')
  const [row] = await db.select().from(principal).where(eq(principal.id, principalId)).limit(1)
  if (!row) return null
  const { permissionsForPrincipal } = await import('@/lib/server/policy/permissions')
  const { segmentIdsForPrincipal } =
    await import('@/lib/server/domains/segments/segment-membership.service')
  const [permissions, segmentIds] = await Promise.all([
    permissionsForPrincipal(row.id, row.role as Parameters<typeof permissionsForPrincipal>[1]),
    segmentIdsForPrincipal(row.id),
  ])
  return {
    principalId: row.id,
    role: row.role as Actor['role'],
    principalType: 'user',
    segmentIds,
    permissions: new Set(permissions),
  }
}

/** Can the approver still see the item the action would act on? */
async function parentStillVisible(action: AssistantPendingAction, actor: Actor): Promise<boolean> {
  try {
    if (action.conversationId) {
      const { assertConversationViewable } =
        await import('@/lib/server/domains/conversation/conversation.service')
      await assertConversationViewable(action.conversationId, actor)
      return true
    }
    if (action.ticketId) {
      const { assertTicketVisible } = await import('@/lib/server/domains/tickets/ticket.service')
      await assertTicketVisible(action.ticketId, actor)
      return true
    }
  } catch {
    return false
  }
  // A workspace-thread action has no inbox parent to check; its authority is
  // the approver's own permissions, which are checked separately below.
  return true
}

export type ResolvedAction =
  | { ok: true; spec: AssistantToolSpec; args: Record<string, unknown>; actor: Actor }
  | { ok: false; refusal: ActionRefusal }

/**
 * Everything that must still be true at the moment of dispatch.
 *
 * Read as one function on purpose: these are not independent validations but
 * one question asked in the order that makes its failure legible, cheapest and
 * most decisive first.
 */
export async function resolveApprovedAction(
  action: AssistantPendingAction
): Promise<ResolvedAction> {
  if (!action.decidedById) return { ok: false, refusal: 'approver_gone' }
  const actor = await approverActor(action.decidedById)
  if (!actor) return { ok: false, refusal: 'approver_gone' }
  if (!(await parentStillVisible(action, actor))) {
    return { ok: false, refusal: 'parent_invisible' }
  }

  // The use is read off the proposal, never off the approver: approving a
  // customer's request must not quietly re-authorize it as a teammate action.
  const connector = await resolveConnectorApprovalSpec({
    toolName: action.toolName,
    profile: action.originProfile ?? roleToAgent(action.originRole),
    proposedPolicyVersion: action.policyVersion,
  })
  if (connector.status === 'denied') {
    return {
      ok: false,
      refusal: connector.reason === 'tool_unreviewed' ? 'contract_changed' : 'policy_changed',
    }
  }
  const spec =
    (await getLiveBuiltInToolSpec(action.toolName, roleToAgent(action.originRole))) ??
    (connector.status === 'ok' ? connector.spec : null) ??
    (action.originRole === 'workspace_assistant'
      ? await getWorkspaceMcpSpecByName(action.toolName, actor, 'Quinn')
      : null)
  if (!spec) return { ok: false, refusal: 'tool_gone' }

  const parentKind = action.ticketId ? 'ticket' : 'conversation'
  if (spec.risk !== 'write' || !spec.parents.includes(parentKind)) {
    return { ok: false, refusal: 'policy_changed' }
  }
  // The contract the reviewer was shown, against the one that would run now.
  // A discovered contract carries a digest because the remote schema is data
  // that can move under a stored proposal. A built-in normally does not: its
  // contract lives in this repository and the live parse below is the check.
  //
  // A built-in that DOES declare one is saying its meaning changed, not just
  // its shape, and a proposal that predates the declaration carries no digest
  // at all. Running it would execute the new meaning under the old card, so
  // an absent digest against a declared one is refused too: the reviewer
  // decides again, on a proposal that says what will actually happen.
  if (spec.contractDigest && action.contractDigest !== spec.contractDigest)
    return { ok: false, refusal: 'contract_changed' }

  const parsed = spec.definition.inputSchema.safeParse(action.args)
  if (!parsed.success) return { ok: false, refusal: 'contract_changed' }
  const args = parsed.data as Record<string, unknown>

  // The exact approved operation. A parse that coerced or defaulted something
  // is a different operation than the one on the card, and a different one is
  // a new decision.
  const approved = action.approvedArgsDigest ?? action.argsDigest
  if (approved && digestOf(args) !== approved) return { ok: false, refusal: 'arguments_changed' }

  for (const permission of toolPermissions(spec, !!action.workspaceThreadKey)) {
    if (!can(actor, permission)) return { ok: false, refusal: 'approver_permission' }
  }
  return { ok: true, spec, args, actor }
}

/** The tool context an approved action runs in: Quinn's records, the approver's authority. */
async function buildExecutionContext(action: AssistantPendingAction, actor: Actor) {
  const assistant = await ensureAssistantPrincipal()
  return makeAssistantToolContext({
    db,
    assistantPrincipalId: assistant.id,
    assistantName: assistant.displayName ?? 'Quinn',
    role: action.originRole,
    audience: resolveContentAudience(
      action.originRole === 'customer_support' ? 'widget' : 'copilot'
    ),
    conversationId: action.conversationId,
    ticketId: action.ticketId,
    involvementId: action.involvementId,
    workspaceThreadKey: action.workspaceThreadKey ?? undefined,
    runId: action.runId,
    simulate: false,
    actor,
  })
}

/**
 * Run one approved action to a durable conclusion.
 *
 * Returns a short disposition for the caller's log line. Never throws for an
 * ordinary refusal: a refusal is a recorded answer a reviewer reads, not a
 * queue failure to retry.
 */
/** How an execution's own reading maps onto the workflow approval ledger. */
const WORKFLOW_APPROVAL_REASON = {
  succeeded: 'executed',
  failed: 'failed',
  unknown: 'unconfirmed',
  refused: 'refused',
} as const satisfies Record<
  ActionReport['kind'],
  import('@/lib/server/domains/workflows/workflow-approval').WorkflowApprovalReason
>

/** Best effort, and never fatal: the receipt is already the record. */
async function resumeWorkflowApproval(
  id: AssistantPendingActionId,
  reason: import('@/lib/server/domains/workflows/workflow-approval').WorkflowApprovalReason
): Promise<void> {
  try {
    const { completeWorkflowApproval } =
      await import('@/lib/server/domains/workflows/workflow-approval')
    await completeWorkflowApproval(id, reason)
  } catch (err) {
    log.warn({ err, pending_action_id: id }, 'could not resume the workflow parked on this action')
  }
}

export async function runApprovedAssistantAction(job: ClaimedJob): Promise<string> {
  const pendingActionId = job.payload.pendingActionId as AssistantPendingActionId | undefined
  if (!pendingActionId) throw new Error('assistant-action job has no pendingActionId')
  const actionLog = log.child({ pending_action_id: pendingActionId, job_id: job.jobId })

  const action = await getPendingActionById(pendingActionId)
  if (!action) {
    actionLog.warn({ event: 'assistant_action.missing' }, 'approved action row is gone')
    return 'missing'
  }
  if (action.status !== 'approved') {
    // A replay after the settlement already committed, or a second reviewer's
    // job racing the first. Finishing quietly is correct: the decision and its
    // outcome are both already recorded.
    actionLog.info(
      { event: 'assistant_action.settled', status: action.status },
      'approved action already settled'
    )
    return `already_settled:${action.status}`
  }

  const resolved = await resolveApprovedAction(action)
  if (!resolved.ok) {
    const note = REFUSAL_NOTES[resolved.refusal]
    await refusePendingAction(pendingActionId, { reason: resolved.refusal, note })
    actionLog.info(
      { event: 'assistant_action.refused', reason: resolved.refusal },
      'approved action refused at dispatch'
    )
    await reportActionOutcome(action, { kind: 'refused', note })
    return `refused:${resolved.refusal}`
  }

  await markPendingActionRunning(pendingActionId)
  const ctx = await buildExecutionContext(action, resolved.actor)
  const outcome = await executeApprovedPendingAction(
    resolved.spec,
    { ...action, args: resolved.args },
    ctx
  )

  if (outcome.status === 'executed') {
    await markPendingActionExecuted(
      pendingActionId,
      (outcome.result as Record<string, unknown> | null) ?? null
    )
    await reportActionOutcome(action, {
      kind: 'succeeded',
      note: resolved.spec.summarize(resolved.args, ctx),
    })
    return 'executed'
  }
  if (outcome.status === 'unknown') {
    // The one case that settles nothing. The receipt already carries
    // reconciliation_state = 'required'; the proposal stays approved so a
    // reviewer sees an execution that is owed an answer rather than a decision
    // that is owed a repeat.
    await markPendingActionUnknown(
      pendingActionId,
      'This action was sent but the provider did not confirm it.'
    )
    await reportActionOutcome(action, {
      kind: 'unknown',
      note: 'This action was sent but not confirmed.',
    })
    return 'unknown'
  }
  if (outcome.status === 'skipped_duplicate') {
    // Somebody else owns this action's receipt. Whatever it says is the truth;
    // nothing here executes a second time.
    actionLog.info({ event: 'assistant_action.duplicate' }, 'approved action already claimed')
    return 'skipped_duplicate'
  }
  await markPendingActionFailed(pendingActionId, outcome.error)
  await reportActionOutcome(action, { kind: 'failed', note: outcome.error })
  return 'failed'
}

/**
 * Tell somebody what happened, and tell the RIGHT somebody.
 *
 * Quinn reports the result to the customer only while it still owns the
 * conversation. A teammate who took over owns the customer relationship, so a
 * result that lands afterwards becomes private context on the thread: it is
 * still the teammate's to act on, and it never becomes a message the customer
 * reads from an assistant that is no longer answering them.
 */
async function reportActionOutcome(
  action: AssistantPendingAction,
  report: ActionReport
): Promise<void> {
  // A workflow procedure step parked on this proposal is told first, because
  // its edges are what decide what the customer is told next (P9). Only a
  // confirmed success is the approved edge; a refusal, a failure and an
  // unconfirmed effect all take the declined one.
  await resumeWorkflowApproval(action.id, WORKFLOW_APPROVAL_REASON[report.kind])
  if (!action.conversationId) return
  const { ownershipForActionResult } = await import('./assistant-action.continuation')
  await ownershipForActionResult(action, report)
}
