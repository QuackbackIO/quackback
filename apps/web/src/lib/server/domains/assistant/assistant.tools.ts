import { toolPermissions } from './tool-permissions'
/**
 * Quinn's tool-execution pipeline: assembles the tool catalogue
 * (assistant.toolspec.ts) into TanStack AI server tools bound to a runtime
 * context, with each write tool's execution branch resolved from the turn's
 * role policy.
 *
 * Assembly runs once per turn — assistant.runtime.ts calls it before the
 * retry loop, since the role-derived write policy is turn-scoped config, not
 * per-attempt state; re-reading it on a retry could flip gating mid-turn.
 *
 * Per registered tool the wrapped execute runs: mode resolution (at assembly)
 * -> propose short-circuits to a pending action -> permission check ->
 * idempotency claim -> execute -> audit finalize. A tool error never escapes
 * into the model loop; it settles the audit row and returns a graceful note
 * instead.
 */
import { can } from '@/lib/server/policy/authorize'
import { logger } from '@/lib/server/logger'
import type { ConversationId, TicketId } from '@quackback/ids'
import type { AssistantToolReplayStrategy } from '@/lib/server/db'
import type { AssistantToolContext, AssistantToolSpec } from './assistant.toolspec'
import { resolveToolSpecs, isNoParentResult, NO_CONVERSATION_NOTE } from './assistant.toolspec'
import {
  claimToolCall,
  findToolReceipt,
  markToolCallDispatched,
  settleToolCall,
  recordDeniedToolCall,
  type AssistantToolCall,
} from './tool-audit'
import {
  boundedResult,
  digestOf,
  logicalActionKey,
  outcomeForInterruptedDispatch,
  pendingActionKey,
  replayOutcomeFor,
  OUTCOME_NOTES,
  type ToolOutcome,
} from './tool-receipts'
import { proposePendingAction, type AssistantPendingAction } from './pending-actions.service'
import { describeEnabledKnowledgeSources } from './retrieval-sources'

const log = logger.child({ component: 'assistant-tools' })

/**
 * Fold the turn's enabled-source enumeration into `search`'s
 * promptGuidance so the model learns which sources it may search this turn and
 * that it can target a subset. This makes the model-facing description dynamic
 * without touching the static tool definition — the spec/definition contract
 * stays fixed (the `sources` enum and output shape are the same every turn);
 * only the prompt line the "Your tools" section composes varies. Returns fresh
 * spec objects, never mutating the shared registry entries; `tools[i]` is
 * unaffected (it binds `spec.definition`, which is identical here).
 */
function withDynamicPromptGuidance(
  specs: AssistantToolSpec[],
  ctx: AssistantToolContext
): AssistantToolSpec[] {
  const enumeration = describeEnabledKnowledgeSources(ctx.knowledge.sources)
  if (!enumeration) return specs
  return specs.map((spec) =>
    spec.name === 'search'
      ? { ...spec, promptGuidance: `${spec.promptGuidance} ${enumeration}` }
      : spec
  )
}

const PENDING_APPROVAL_NOTE =
  'A teammate must approve this action; tell the customer it has been requested.'
const DENIED_NOTE = 'This action is not permitted for the assistant.'
const FAILED_NOTE = 'This action could not be completed.'

/**
 * A tool's resolved execution branch for this turn (see
 * `resolveEffectiveToolMode`), decoupled from any saved per-tool config.
 */
export type ToolExecutionMode = 'autonomous' | 'propose' | 'simulate'

/**
 * Resolve a spec's execution branch for this turn from its risk class and the
 * turn's write policy (`ctx.writeToolPolicy`, selected from the role policy).
 * Built-in write tools also honor the per-agent dial this harvest adds
 * (`allow` / `ask` / `deny` on `config.agents.*.toolRules`). An absent key
 * leaves the turn's role policy deciding, which is the pre-dial behavior.
 *
 * - Control tools are agent-protocol primitives: always autonomous, on every
 *   deployment (the model must express handoff/inability as tool calls).
 * - Read tools only observe: always autonomous, never simulated or proposed.
 * - Write tools branch on `ctx.writeToolPolicy`:
 *   - 'propose' (the copilot Q&A surface): resolves to a pending-action
 *     proposal; the approval card IS the confirmation UX, so nothing fires
 *     without a human decision, regardless of `ctx.simulate`.
 *   - `ctx.simulate` true with policy unset/'simulate' (the admin sandbox):
 *     previews instead of running — there is no conversation to attach a
 *     claim, approval, or denial to.
 *   - otherwise ('execute', a real customer-support turn): autonomous, after
 *     the permission check `runWithPipeline` runs.
 */
export function resolveEffectiveToolMode(
  spec: AssistantToolSpec,
  ctx: AssistantToolContext
): ToolExecutionMode {
  if (spec.risk === 'control') return 'autonomous'
  if (spec.approvalPolicy === 'always') return 'autonomous'
  if (spec.approvalPolicy === 'approval') return 'propose'
  if (spec.risk !== 'write') return 'autonomous'
  // Workspace writes without an explicit dial still propose (connectors,
  // destructive MCP). Feedback create/assign stamp approvalPolicy: 'always'
  // so they execute as the asking teammate, like Linear Agent.
  if (ctx.role === 'workspace_assistant') return 'propose'
  if (ctx.writeToolPolicy === 'propose') return 'propose'
  if (ctx.simulate && (ctx.writeToolPolicy ?? 'simulate') === 'simulate') return 'simulate'
  return 'autonomous'
}

/**
 * The turn's actual parent kind (unified inbox §2.9/§3.3), for filtering the
 * catalogue against each spec's `parents`. `conversationId` wins when both
 * happen to be set (never true today — a turn grounds on exactly one item),
 * mirroring `runWithPipeline`'s own approval-parent choice below; the null-null
 * sandbox falls back to 'conversation', matching every pre-ticket spec's
 * existing (conversation-only) behavior there unchanged.
 */
function turnParentKind(ctx: AssistantToolContext): 'conversation' | 'ticket' {
  if (ctx.conversationId != null) return 'conversation'
  if (ctx.ticketId != null) return 'ticket'
  return 'conversation'
}

function previewArgs(args: unknown): Record<string, string> | undefined {
  if (!args || typeof args !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (value == null) continue
    out[key] = typeof value === 'string' ? value : JSON.stringify(value)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function hashArgs(args: unknown): string {
  return digestOf(args)
}

/**
 * The item a logical action belongs to, and the engagement inside it.
 *
 * The involvement is the engagement when there is one: it spans an approval
 * wait and every continuation after it, which is exactly the window in which
 * repeating the same action would be a duplicate effect rather than a new
 * request. Without one, the customer message is the next best boundary.
 */
function actionScope(ctx: AssistantToolContext): { parentKey: string; engagement: string } {
  return {
    parentKey: String(ctx.conversationId ?? ctx.ticketId ?? ctx.workspaceThreadKey ?? 'none'),
    engagement: ctx.involvementId
      ? `inv:${ctx.involvementId}`
      : `msg:${ctx.latestCustomerMessageId ?? 'none'}`,
  }
}

/**
 * The stable logical identity of the action this call would perform.
 *
 * Only write-risk tools have one: a read has no effect to deduplicate, and
 * giving it a key would make a second, legitimate search of the same query
 * read as a replay.
 */
function resolveActionKey(
  spec: AssistantToolSpec,
  args: unknown,
  ctx: AssistantToolContext
): string | undefined {
  if (spec.risk !== 'write') return undefined
  const scope = actionScope(ctx)
  return logicalActionKey({ ...scope, toolName: spec.name, argsDigest: hashArgs(args) })
}

/**
 * How an interrupted or duplicated call of this tool may be recovered.
 *
 * A spec may say so itself. Otherwise: a read has nothing to recover, anything
 * that reaches a remote or an MCP session is uncertain because neither offers
 * an idempotency or status-query contract this code could rely on, and the
 * remaining built-in writes mutate this database through the same domain
 * services the receipt is written by.
 */
export function replayStrategyFor(spec: AssistantToolSpec): AssistantToolReplayStrategy {
  if (spec.replayStrategy) return spec.replayStrategy
  if (spec.risk !== 'write') return 'local_transactional'
  if (spec.connector) return 'external_uncertain'
  return 'local_transactional'
}

/**
 * The write-tool idempotency key: stable across retries of the same customer
 * turn, distinct per tool and args. An explicit `spec.idempotencyKey` wins;
 * read-risk tools never need one (they never claim). `ctx.conversationId ??
 * ctx.ticketId` keys on whichever item this turn is grounded on (unified
 * inbox §2.9) — without this fallback a ticket-scoped turn's key would
 * collapse to a bare `null` item segment, colliding across every ticket
 * proposing the same tool with the same args instead of scoping per ticket
 * the way a conversation-scoped key already scopes per conversation.
 */
function resolveIdempotencyKey(
  spec: AssistantToolSpec,
  args: unknown,
  ctx: AssistantToolContext
): string | undefined {
  if (spec.idempotencyKey) return spec.idempotencyKey(args, ctx)
  if (spec.risk !== 'write') return undefined
  return `${ctx.conversationId ?? ctx.ticketId ?? ctx.workspaceThreadKey}:${ctx.latestCustomerMessageId}:${spec.name}:${hashArgs(args)}`
}

/**
 * Run one tool call through the execution pipeline. `mode` arrives already
 * fully resolved (see `resolveEffectiveToolMode`); this function does no
 * further gating of its own, it only carries out what the mode says.
 * Simulate previews instead of running. Propose short-circuits to a pending
 * action (no permission check: the approving human authorizes it).
 * Autonomous checks every declared permission, then (write-risk only) claims
 * an idempotency slot, executes, and finalizes the audit row. Never throws:
 * an execution failure settles the audit row and returns a graceful note so
 * a tool error can't crash the turn.
 */
async function runWithPipeline(
  spec: AssistantToolSpec,
  mode: ToolExecutionMode,
  args: unknown,
  ctx: AssistantToolContext
): Promise<unknown> {
  ctx.ledger.toolCalls.push(spec.name)
  if (mode === 'simulate') {
    // A write tool's outcome resolved to a preview instead of a real run.
    // Two distinct reasons land here (see `AssistantToolContext.writeToolPolicy`
    // and `resolveEffectiveToolMode` for how the choice is made): the sandbox
    // has no real conversation to attach a claim, approval, or denial to
    // (nowhere to attach), while copilot has a real conversation but previews
    // anyway because a teammate asking Quinn a question about the
    // conversation must never let Quinn act in it (policy says preview).
    ctx.ledger.toolOutcomes.push({ name: spec.name, outcome: 'simulated' })
    return { simulated: true, summary: spec.summarize(args, ctx) }
  }

  if (mode === 'propose') {
    const summary = spec.summarize(args, ctx)
    const scope = actionScope(ctx)
    // Polymorphic parent (unified inbox §3.3): whichever item this turn is
    // grounded on. `ctx.conversationId` wins when both happen to be set (never
    // true today — a turn grounds on exactly one item), matching every
    // pre-ticket caller's behavior unchanged.
    const parent = ctx.workspaceThreadKey
      ? { workspaceThreadKey: ctx.workspaceThreadKey }
      : ctx.conversationId
        ? { conversationId: ctx.conversationId }
        : { ticketId: ctx.ticketId as TicketId }
    const pending = await proposePendingAction({
      ...parent,
      involvementId: ctx.involvementId ?? undefined,
      toolName: spec.name,
      args: args as Record<string, unknown>,
      summary,
      originRole: ctx.role,
      // The use this call was authorized under, and the policy version that
      // said so. Approval re-resolves THIS use, never the approver's own, and
      // a version that has moved since is a policy change the executor has to
      // look at rather than assume away.
      originProfile: spec.connectorPolicy?.profile,
      policyVersion: spec.connectorPolicy?.policyVersion,
      // Same-shaped key as the autonomous branch's claim below: a synthesis
      // retry that re-runs this exact write-tool call for the same turn
      // dedupes onto the first proposal row instead of inserting a duplicate
      // and re-announcing the note (see proposePendingAction). Always
      // defined here — approval mode is only ever reached for a write-risk
      // spec (reads never support it), and resolveIdempotencyKey always
      // returns a key for a write-risk spec.
      idempotencyKey: resolveIdempotencyKey(spec, args, ctx),
      // The exact operation a reviewer will be shown, digested now. Execution
      // compares both against the live tool before it dispatches, so a
      // rediscovered contract or a rewritten argument needs a new decision
      // rather than riding this one.
      actionKey: resolveActionKey(spec, args, ctx),
      argsDigest: hashArgs(args),
      contractDigest: spec.contractDigest,
      runId: ctx.runId ?? undefined,
      runStepKey: `tool:${spec.name}:${scope.engagement}`,
      requestedById: ctx.requestedByPrincipalId ?? undefined,
    })
    // Mirrors how search records onto ctx.ledger.sources: the caller (the
    // copilot route, today) reads this ledger off the tool context after the
    // turn to surface what got proposed, alongside the customer-facing note
    // proposePendingAction already dropped in the thread. `pending` is the
    // EXISTING row on a deduped retry, so this still references the one real
    // proposal rather than a phantom second one.
    ctx.ledger.proposedActions.push({
      id: pending.id,
      toolName: spec.name,
      summary,
      label: spec.label,
      ...(spec.connector
        ? {
            connector: spec.connector,
            ...(previewArgs(args) ? { argsPreview: previewArgs(args) } : {}),
          }
        : {}),
    })
    ctx.ledger.toolOutcomes.push({ name: spec.name, outcome: 'proposed' })
    return { status: 'pending_approval', note: PENDING_APPROVAL_NOTE, actionId: pending.id }
  }

  // mode === 'autonomous' from here: simulate and propose both returned above.
  for (const permission of toolPermissions(spec, !!ctx.workspaceThreadKey)) {
    if (can(ctx.actor, permission)) continue
    await recordDeniedToolCall({
      conversationId: ctx.conversationId ?? undefined,
      involvementId: ctx.involvementId ?? undefined,
      toolName: spec.name,
      args: args as Record<string, unknown>,
      reason: `insufficient_permission:${permission}`,
      principalId: ctx.assistantPrincipalId,
    })
    ctx.ledger.toolOutcomes.push({ name: spec.name, outcome: 'failed' })
    return { status: 'denied', note: DENIED_NOTE }
  }

  // Read-risk tools never claim an idempotency slot or write an audit row —
  // ai_usage_log already covers reads. Writes with no conversation (should
  // not happen outside simulate, but stay defensive) skip the claim too.
  const shouldClaim = spec.risk === 'write' && ctx.conversationId != null
  const idempotencyKey = resolveIdempotencyKey(spec, args, ctx)
  const actionKey = resolveActionKey(spec, args, ctx)
  let claimed: AssistantToolCall | null = null
  if (shouldClaim) {
    const scope = actionScope(ctx)
    claimed = await claimToolCall({
      conversationId: ctx.conversationId as ConversationId,
      involvementId: ctx.involvementId ?? undefined,
      toolName: spec.name,
      args: args as Record<string, unknown>,
      idempotencyKey,
      actionKey,
      argsDigest: hashArgs(args),
      schemaDigest: spec.contractDigest,
      replayStrategy: replayStrategyFor(spec),
      runId: ctx.runId ?? undefined,
      runStepKey: `tool:${spec.name}:${scope.engagement}`,
      principalId: ctx.assistantPrincipalId,
    })
    if (!claimed) {
      // Somebody already owns this action, on either key. The receipt decides
      // what happens next; nothing here executes a second time.
      const previous = await findToolReceipt({ actionKey, idempotencyKey })
      const replay: ToolOutcome = previous
        ? replayOutcomeFor(previous)
        : { status: 'in_progress', receiptId: '' }
      ctx.ledger.toolOutcomes.push({
        name: spec.name,
        outcome: replay.status === 'succeeded' ? 'executed' : 'failed',
      })
      return duplicateEnvelope(replay, previous)
    }
  }

  const outcome = await executeAndSettle(spec, args, claimed, ctx)
  ctx.ledger.toolOutcomes.push({
    name: spec.name,
    outcome:
      outcome.status === 'succeeded' ? (spec.risk === 'read' ? 'read' : 'executed') : 'failed',
  })
  return outcomeEnvelope(spec, outcome)
}

/**
 * What the model is told about a completed call.
 *
 * A success hands back the tool's own result, unchanged, because every caller
 * and every output schema in the tree is written against it. Everything else
 * becomes a gate envelope whose `status` is the normalized outcome, so an
 * unconfirmed effect can never be read as a completed one.
 */
function outcomeEnvelope(spec: AssistantToolSpec, outcome: ToolOutcome): unknown {
  if (outcome.status === 'succeeded') return outcome.value
  if (outcome.status === 'denied') return { status: 'denied', note: DENIED_NOTE }
  if (outcome.status === 'unknown') {
    return {
      status: 'unknown',
      note: OUTCOME_NOTES.unknown,
      receiptId: outcome.receiptId,
      reconciliationRequired: true,
    }
  }
  if (outcome.status === 'in_progress') {
    return { status: 'in_progress', note: OUTCOME_NOTES.in_progress, receiptId: outcome.receiptId }
  }
  if (outcome.status === 'pending_approval') {
    return { status: 'pending_approval', note: PENDING_APPROVAL_NOTE, actionId: outcome.actionId }
  }
  return { status: 'failed', note: FAILED_NOTE }
}

/**
 * What the model is told when it asked for an action somebody already owns.
 *
 * The shape stays `skipped_duplicate`, which is what the prompt and the
 * existing surfaces are written against; the truthful part is what rides with
 * it. A stored success carries the recorded result, so the model can report
 * the real outcome instead of guessing. An unconfirmed one says so and says
 * not to repeat it.
 */
function duplicateEnvelope(replay: ToolOutcome, previous: AssistantToolCall | null): unknown {
  const note =
    replay.status === 'succeeded'
      ? 'This action previously succeeded. It was not executed again.'
      : replay.status === 'failed'
        ? 'The previous attempt failed. It was not executed again; do not claim completion.'
        : replay.status === 'denied'
          ? 'The previous attempt was denied. It was not executed again.'
          : replay.status === 'unknown'
            ? OUTCOME_NOTES.unknown
            : 'An earlier attempt exists, but completion is unconfirmed. Do not claim completion or retry the action.'
  return {
    status: 'skipped_duplicate',
    previousStatus: previous?.status ?? 'unknown',
    outcomeStatus: replay.status,
    note,
    ...(replay.status === 'succeeded' ? { result: boundedResult(replay.value) } : {}),
    ...(replay.status === 'unknown' ? { reconciliationRequired: true } : {}),
  }
}

/** Interpret known result contracts, not promise fulfillment, as business success.
 * Do not recursively inspect arbitrary business data (e.g. a service status).
 */
function toolResultFailure(spec: AssistantToolSpec, result: unknown): string | null {
  if (isNoParentResult(result)) return NO_CONVERSATION_NOTE
  if (!result || typeof result !== 'object') return null
  const value = result as Record<string, unknown>
  const successField: Record<string, string> = {
    end_conversation: 'closed',
    create_ticket: 'created',
    capture_feedback: 'created',
    share_post: 'shared',
    capture_contact_details: 'captured',
    set_attribute: 'applied',
  }
  const field = successField[spec.name]
  // capture_feedback can link an existing post without creating another one.
  const linkedPost = spec.name === 'capture_feedback' && typeof value.postId === 'string'
  if (
    value.ok === false ||
    value.isError === true ||
    value.simulated === true ||
    ['failed', 'denied', 'pending_approval', 'in_progress', 'unknown'].includes(
      String(value.status)
    ) ||
    (field && value[field] === false && !linkedPost)
  ) {
    return typeof value.note === 'string' ? value.note : FAILED_NOTE
  }
  return null
}

/**
 * The shared execute step: commit the dispatch intent, run the tool, settle the
 * receipt with a normalized outcome, and never throw.
 *
 * The order is the point. For anything whose effect leaves this database the
 * dispatch stamp is written BEFORE the call, so a process death in the window
 * leaves a receipt that says "attempted, never confirmed" rather than a receipt
 * that says nothing; `replayOutcomeFor` reads exactly that shape as `unknown`.
 * A local mutation needs no stamp: it and its receipt are written by the same
 * process against the same database, so an interruption leaves neither.
 */
async function executeAndSettle(
  spec: AssistantToolSpec,
  args: unknown,
  claimed: AssistantToolCall | null,
  ctx: AssistantToolContext
): Promise<ToolOutcome> {
  const startedAt = Date.now()
  // With no receipt there is nothing to reconcile and nobody to tell, so an
  // interruption can only be reported as a plain failure. This is the read
  // path and the no-parent write path, neither of which dispatches an effect.
  const strategy = claimed ? replayStrategyFor(spec) : 'local_transactional'
  const receiptId = claimed?.id ?? ''
  if (claimed && strategy !== 'local_transactional') {
    await markToolCallDispatched(claimed.id)
  }
  try {
    const result = await spec.execute(args, ctx)
    // Defense in depth alongside the `parents` catalogue gate (assembleAssistantToolset):
    // a tool that reports it found no parent to act on (see `NO_CONVERSATION_NOTE`)
    // is never a successful execution, even if it somehow ran — most notably
    // `executeApprovedPendingAction`, which runs a spec looked up straight off
    // a stored pending-action row rather than this turn's filtered catalogue.
    const failure = toolResultFailure(spec, result)
    const outcome: ToolOutcome = failure
      ? // A declared failure envelope IS the provider's answer, so the effect
        // is known not to have happened and this is a definite failure, not an
        // uncertainty. It is never retried automatically all the same.
        { status: 'failed', reason: failure, retryable: false }
      : { status: 'succeeded', value: result, receiptId }
    if (claimed) {
      await settleToolCall(claimed.id, outcome, {
        resultSummary: failure ? undefined : spec.summarize(args, ctx),
        latencyMs: Date.now() - startedAt,
        providerReceipt: providerReceiptFrom(result),
      })
    }
    return outcome
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error({ err: error, tool: spec.name }, 'assistant tool execution failed')
    const outcome = outcomeForInterruptedDispatch(strategy, receiptId, message)
    if (claimed) {
      await settleToolCall(claimed.id, outcome, { latencyMs: Date.now() - startedAt })
    }
    return outcome
  }
}

/** What the provider itself said, kept small: a receipt, not a second copy of the payload. */
function providerReceiptFrom(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== 'object') return null
  const value = result as Record<string, unknown>
  const receipt: Record<string, unknown> = {}
  for (const key of ['ok', 'id', 'requestId', 'idempotencyKey', 'note']) {
    if (value[key] !== undefined) receipt[key] = value[key]
  }
  return Object.keys(receipt).length > 0 ? receipt : null
}

/** Outcome of running a teammate-approved pending action through the pipeline. */
export type ExecuteApprovedActionResult =
  | { status: 'executed'; result: unknown; receiptId: string }
  | { status: 'failed'; error: string; receiptId: string }
  /** Dispatched, never confirmed. A person decides; nothing resends it. */
  | { status: 'unknown'; receiptId: string }
  | { status: 'skipped_duplicate'; previous: ToolOutcome | null }

/**
 * Execute a pending action a teammate approved, via the same claim/execute/
 * settle steps autonomous mode runs in `runWithPipeline`, but keyed by the
 * pending action id rather than the customer message (the approval decision
 * is itself the idempotency boundary a resubmitted approve request must not
 * cross), and with the audit row linked back to the proposal it settles. No
 * permission check here: approval mode never checks `spec.permissions` at
 * proposal time because the approving human authorizes it, and the caller
 * (the approval executor) already re-resolved every gate before calling.
 */
export async function executeApprovedPendingAction(
  spec: AssistantToolSpec,
  pendingAction: AssistantPendingAction,
  ctx: AssistantToolContext
): Promise<ExecuteApprovedActionResult> {
  const key = pendingActionKey(pendingAction.id)
  const claimed = await claimToolCall({
    // Ticket-scoped pending actions (unified inbox §3.3) have no
    // conversationId; the tool-call audit trail doesn't thread a ticket
    // parent yet, so this stays undefined for that case rather than wired.
    conversationId: pendingAction.conversationId ?? undefined,
    involvementId: pendingAction.involvementId ?? undefined,
    pendingActionId: pendingAction.id,
    toolName: spec.name,
    args: pendingAction.args,
    idempotencyKey: key,
    actionKey: key,
    argsDigest: hashArgs(pendingAction.args),
    schemaDigest: spec.contractDigest,
    replayStrategy: replayStrategyFor(spec),
    runId: pendingAction.runId ?? undefined,
    runStepKey: pendingAction.runStepKey ?? undefined,
    principalId: ctx.assistantPrincipalId,
  })
  if (!claimed) {
    const previous = await findToolReceipt({ actionKey: key, idempotencyKey: key })
    return { status: 'skipped_duplicate', previous: previous ? replayOutcomeFor(previous) : null }
  }

  const outcome = await executeAndSettle(spec, pendingAction.args, claimed, ctx)
  if (outcome.status === 'succeeded') {
    return { status: 'executed', result: outcome.value, receiptId: claimed.id }
  }
  if (outcome.status === 'unknown') return { status: 'unknown', receiptId: claimed.id }
  return {
    status: 'failed',
    error: outcome.status === 'failed' ? outcome.reason : 'This action could not be completed.',
    receiptId: claimed.id,
  }
}

type AssembledServerTool = ReturnType<AssistantToolSpec['definition']['server']>

/**
 * Build this turn's tool set, paired with the specs that produced it
 * (`activeSpecs[i]` is the spec behind `tools[i]`). Each built-in spec's
 * execution mode is resolved from the turn's write policy (see
 * `resolveEffectiveToolMode`). The rest are wrapped in the execution
 * pipeline.
 *
 * `specs` defaults to the live catalogue; tests inject a fixed list to
 * exercise write-risk behavior the current catalogue doesn't ship yet.
 *
 * The system prompt builder needs `activeSpecs` (each carries its own
 * promptGuidance line, composed into the "Your tools" section); the agentic
 * loop needs `tools`. Kept as one function so the two can never drift apart.
 */
export async function assembleAssistantToolset(
  ctx: AssistantToolContext,
  specs?: readonly AssistantToolSpec[],
  extraSpecs: readonly AssistantToolSpec[] = []
): Promise<{ tools: AssembledServerTool[]; activeSpecs: AssistantToolSpec[] }> {
  // Unified inbox §2.9/§3.3: never even consider a spec whose `parents`
  // excludes this turn's actual parent kind: a conversation-only write tool
  // must not reach mode resolution, proposal, or the model at all on a
  // ticket-scoped turn. See `parents`'s own doc on AssistantToolSpec.
  const parentKind = turnParentKind(ctx)
  const workspaceKeepBuiltins = new Set(['get_status', 'report_inability', 'use_skill'])
  const fitsParent = (spec: AssistantToolSpec) =>
    spec.parents.includes(parentKind) && (spec.availableWhen?.(ctx) ?? true)
  const availableBuiltin = (spec: AssistantToolSpec) =>
    fitsParent(spec) && (ctx.role !== 'workspace_assistant' || workspaceKeepBuiltins.has(spec.name))

  // Extra specs (first-party MCP + remote connectors) always ride the
  // execution pipeline — audit and propose stay load-bearing. Workspace writes
  // resolve to proposals via resolveEffectiveToolMode.
  const connectorActive = extraSpecs
    .filter(fitsParent)
    .map((spec) => ({ spec, mode: resolveEffectiveToolMode(spec, ctx) }))
  const connectorTools = connectorActive.map(({ spec, mode }) =>
    spec.definition.server<AssistantToolContext>((args) => runWithPipeline(spec, mode, args, ctx))
  )
  const connectorActiveSpecs = connectorActive.map((entry) => entry.spec)

  const resolvedSpecs = (specs ?? resolveToolSpecs()).filter(availableBuiltin)
  const builtInTools = resolvedSpecs.map((spec) => {
    const mode = resolveEffectiveToolMode(spec, ctx)
    return spec.definition.server<AssistantToolContext>((args) =>
      runWithPipeline(spec, mode, args, ctx)
    )
  })
  return {
    tools: [...builtInTools, ...connectorTools] as AssembledServerTool[],
    activeSpecs: withDynamicPromptGuidance([...resolvedSpecs, ...connectorActiveSpecs], ctx),
  }
}
