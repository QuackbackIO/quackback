/**
 * The two procedure steps a workflow can take through Quinn's own action
 * machinery (QUINN-PRODUCT P9).
 *
 * ## What a procedure step may do
 *
 * Built-in write tools, and only those. A connector tool resolves its policy
 * per use (customer, teammate, the linked workspace surface) and a workflow is
 * none of the three, so there is no record that could say yes to one; rather
 * than invent a fourth use with no editor behind it, a connector tool is
 * simply not offered here. Read tools are not offered either: there is no
 * model in a procedure step to read the answer.
 *
 * ## The workspace dial governs both kinds
 *
 * `applyBuiltInToolRules` is the same projection the customer and teammate
 * turns run, so a tool the workspace set to Never is unavailable to a
 * procedure too, and one set to Needs approval cannot be a `call_tool` step at
 * all: it has to be an `approval` step, which is what the dial was asking for.
 * The step then reports `needs_approval` rather than running anyway.
 *
 * ## Identity
 *
 * `workflow:<run>:<node>:<visit>`, the same shape Step 6's delegation trigger
 * key uses and for the same reason: a re-walked visit, a retried wait job or a
 * replayed resume must resolve to the effect that already happened. For
 * `call_tool` that is the receipt's action key, so the second attempt loses
 * the claim and reads the first attempt's verdict. For `approval` it is the
 * proposal's action key and idempotency key, so a replayed park finds the open
 * proposal instead of asking a second reviewer.
 */
import { db } from '@/lib/server/db'
import type { ConversationId, PrincipalId, AssistantPendingActionId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import type { ToolStepOutcome } from './condition.evaluator'
import type { WorkflowToolStepArgs } from './graph'
import { interpolate } from '@/lib/shared/workflows/interpolate'
import type { WorkflowVariables } from './workflow-variables'

const log = logger.child({ component: 'workflow-tool-step' })

/**
 * The stable identity of one procedure step's effect.
 *
 * Keyed by the workflow run, the graph node and the logical visit, never by
 * the node alone: a graph that revisits a node must be able to act twice, and
 * a replay of one visit must not.
 */
export function workflowToolStepKey(runId: string, nodeId: string, visit: number): string {
  return `workflow:${runId}:${nodeId}:${visit}`
}

/** Why a procedure step could not run at all, before any effect was attempted. */
export type WorkflowToolStepRefusal =
  | 'unknown_tool'
  | 'not_a_write_tool'
  | 'tool_disabled'
  | 'needs_approval'
  | 'invalid_arguments'
  | 'no_conversation'

/** A resolved, dialled-and-validated procedure step, ready to run or propose. */
export type ResolvedWorkflowToolStep =
  | {
      ok: true
      spec: import('@/lib/server/domains/assistant/assistant.toolspec').AssistantToolSpec
      args: Record<string, unknown>
    }
  | { ok: false; refusal: WorkflowToolStepRefusal; detail?: string }

/**
 * Resolve a step's tool and arguments against the live catalogue and dial.
 *
 * `requireAutonomous` is what separates the two node kinds: a `call_tool` step
 * refuses a tool the dial says needs approval, an `approval` step is the way
 * to run exactly that tool.
 */
export async function resolveWorkflowToolStep(input: {
  tool: string
  args: WorkflowToolStepArgs
  variables?: WorkflowVariables
  requireAutonomous: boolean
}): Promise<ResolvedWorkflowToolStep> {
  const { getToolSpecByName, applyBuiltInToolRules } =
    await import('@/lib/server/domains/assistant/assistant.toolspec')
  const base = getToolSpecByName(input.tool)
  if (!base) return { ok: false, refusal: 'unknown_tool' }
  if (base.risk !== 'write') return { ok: false, refusal: 'not_a_write_tool' }
  if (!base.parents.includes('conversation')) return { ok: false, refusal: 'not_a_write_tool' }

  // The dial the workspace actually edits for its customer agent. A procedure
  // step runs inside a customer conversation, so "may Quinn do this without
  // asking" is the same question, answered by the same record.
  const { getAssistantRuntimeConfig } =
    await import('@/lib/server/domains/settings/settings.assistant')
  const runtime = await getAssistantRuntimeConfig().catch(() => null)
  const dialled = applyBuiltInToolRules([base], runtime?.config.agents.agent.toolRules)
  const spec = dialled[0]
  // `deny` removes the spec entirely, which is the workspace saying never.
  if (!spec) return { ok: false, refusal: 'tool_disabled' }
  if (input.requireAutonomous && spec.approvalPolicy === 'approval') {
    return { ok: false, refusal: 'needs_approval' }
  }

  const interpolated = interpolateStepArgs(input.args, input.variables)
  const parsed = spec.definition.inputSchema.safeParse(interpolated)
  if (!parsed.success) {
    return {
      ok: false,
      refusal: 'invalid_arguments',
      detail: parsed.error.issues[0]?.message ?? 'The arguments do not match this action.',
    }
  }
  return { ok: true, spec, args: parsed.data as Record<string, unknown> }
}

/** Fill workflow variables into every string argument, leaving the rest alone. */
function interpolateStepArgs(
  args: WorkflowToolStepArgs,
  variables: WorkflowVariables | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    out[key] = typeof value === 'string' && variables ? interpolate(value, variables) : value
  }
  return out
}

/**
 * Run a `call_tool` step and return the edge the walk should take.
 *
 * Every reading other than a confirmed success takes the `failed` edge. That
 * includes an effect nobody could confirm, which also leaves its receipt in
 * the reconciliation queue for a person: a procedure must not continue as if
 * something happened when the only honest answer is that nobody knows.
 */
export async function runWorkflowToolStep(input: {
  runId: string
  nodeId: string
  visit: number
  tool: string
  args: WorkflowToolStepArgs
  conversationId: ConversationId
  variables?: WorkflowVariables
}): Promise<{ outcome: ToolStepOutcome; detail: string }> {
  const resolved = await resolveWorkflowToolStep({
    tool: input.tool,
    args: input.args,
    variables: input.variables,
    requireAutonomous: true,
  })
  if (!resolved.ok) return { outcome: 'failed', detail: resolved.refusal }

  const ctx = await procedureToolContext(input.conversationId)
  const { executeReceiptedToolAction } =
    await import('@/lib/server/domains/assistant/assistant.tools')
  const actionKey = workflowToolStepKey(input.runId, input.nodeId, input.visit)
  const result = await executeReceiptedToolAction({
    spec: resolved.spec,
    args: resolved.args,
    actionKey,
    ctx,
    conversationId: input.conversationId,
    runStepKey: input.nodeId,
  })
  if (result.status === 'replayed') {
    // The first attempt owns this effect. Its verdict is the step's verdict,
    // and an unconfirmed one stays unconfirmed rather than being retried.
    const previous = result.previous
    log.info(
      { event: 'workflow_tool_step.replayed', action_key: actionKey, previous: previous?.status },
      'procedure step read an existing receipt instead of dispatching'
    )
    return {
      outcome: previous?.status === 'succeeded' ? 'done' : 'failed',
      detail: `replayed:${previous?.status ?? 'unknown'}`,
    }
  }
  if (result.status === 'executed') return { outcome: 'done', detail: 'succeeded' }
  if (result.status === 'unknown') return { outcome: 'failed', detail: 'unconfirmed' }
  return { outcome: 'failed', detail: result.error }
}

/**
 * Open the proposal an `approval` step parks on.
 *
 * Returns null when there is nothing to decide, which the engine reads as
 * declined without ever parking: a step whose tool the workspace disabled, or
 * whose arguments do not match the contract, has no question to put to a
 * reviewer. The proposal's own idempotency key is the step identity, so a
 * replayed walk finds the open proposal instead of opening a second one.
 */
export async function proposeWorkflowApproval(input: {
  runId: string
  nodeId: string
  visit: number
  tool: string
  args: WorkflowToolStepArgs
  summary: string
  conversationId: ConversationId
  variables?: WorkflowVariables
}): Promise<{ pendingActionId: AssistantPendingActionId } | null> {
  const resolved = await resolveWorkflowToolStep({
    tool: input.tool,
    args: input.args,
    variables: input.variables,
    requireAutonomous: false,
  })
  if (!resolved.ok) {
    log.info(
      { event: 'workflow_approval.refused', node_id: input.nodeId, refusal: resolved.refusal },
      'approval step could not open a proposal'
    )
    return null
  }
  const { proposePendingAction } =
    await import('@/lib/server/domains/assistant/pending-actions.service')
  const { digestOf } = await import('@/lib/server/domains/assistant/tool-receipts')
  const actionKey = workflowToolStepKey(input.runId, input.nodeId, input.visit)
  const proposal = await proposePendingAction({
    conversationId: input.conversationId,
    toolName: resolved.spec.name,
    args: resolved.args,
    summary: input.summary,
    // A procedure step is the workspace acting, not the customer's own turn.
    // The role is what stops the approved result being reported back to the
    // customer as if Quinn had promised it: the workflow decides what the
    // customer is told, on its own edges.
    originRole: 'workspace_assistant',
    idempotencyKey: actionKey,
    actionKey,
    argsDigest: digestOf(resolved.args),
    contractDigest: resolved.spec.contractDigest,
    runStepKey: input.nodeId,
  })
  return { pendingActionId: proposal.id }
}

/** The execution context a procedure step's tool runs in. */
async function procedureToolContext(conversationId: ConversationId) {
  const { ensureAssistantPrincipal } =
    await import('@/lib/server/domains/assistant/assistant.principal')
  const { makeAssistantToolContext } =
    await import('@/lib/server/domains/assistant/assistant.toolspec')
  const { resolveContentAudience } = await import('@/lib/server/domains/assistant/audience')
  const assistant = await ensureAssistantPrincipal()
  return makeAssistantToolContext({
    db,
    assistantPrincipalId: assistant.id as PrincipalId,
    assistantName: assistant.displayName ?? 'Quinn',
    role: 'workspace_assistant',
    audience: resolveContentAudience('copilot'),
    conversationId,
    simulate: false,
  })
}
