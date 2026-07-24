/**
 * Quinn's tool-execution pipeline: assembles the tool catalogue
 * (assistant.toolspec.ts) into TanStack AI server tools bound to a runtime
 * context, with each write tool's execution branch resolved from the turn's
 * role policy.
 *
 * Assembly runs once per turn — assistant.runtime.ts calls it before the
 * retry loop, since the feature flag and role-derived write policy are
 * turn-scoped config, not per-attempt state; re-reading them on a retry could
 * flip gating mid-turn.
 *
 * Per registered tool the wrapped execute runs: mode resolution (at assembly)
 * -> propose short-circuits to a pending action -> permission check ->
 * idempotency claim -> execute -> audit finalize. A tool error never escapes
 * into the model loop; it settles the audit row and returns a graceful note
 * instead.
 */
import { createHash } from 'node:crypto'
import { can } from '@/lib/server/policy/authorize'
import { logger } from '@/lib/server/logger'
import type { ConversationId, TicketId } from '@quackback/ids'
import type { AssistantToolContext, AssistantToolSpec } from './assistant.toolspec'
import {
  ASSISTANT_TOOL_SPECS,
  resolveToolSpecs,
  isNoParentResult,
  NO_CONVERSATION_NOTE,
} from './assistant.toolspec'
import {
  claimToolCall,
  finalizeToolCall,
  recordDeniedToolCall,
  type AssistantToolCall,
} from './tool-audit'
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
const DUPLICATE_NOTE = 'This action was already performed for this message.'
const FAILED_NOTE = 'This action could not be completed.'

/**
 * A tool's resolved execution branch for this turn (see
 * `resolveEffectiveToolMode`), decoupled from any saved per-tool config.
 * 'disabled' is only ever consumed by `assembleAssistantToolset`'s filter,
 * which drops the tool before it is registered; `runWithPipeline` itself only
 * ever receives 'propose' | 'autonomous' | 'simulate'.
 */
export type ToolExecutionMode = 'autonomous' | 'propose' | 'simulate' | 'disabled'

/**
 * Resolve a spec's execution branch for this turn from its risk class and the
 * turn's write policy (`ctx.writeToolPolicy`, selected from the role policy).
 * There is no saved per-tool configuration: end-user-triggered write tools
 * execute autonomously, matching Featurebase.
 *
 * - Control tools are agent-protocol primitives: always autonomous, on every
 *   deployment (the model must express handoff/inability as tool calls).
 * - Read tools only observe: always autonomous, never simulated or proposed.
 * - Write tools branch on `ctx.writeToolPolicy`:
 *   - 'disabled' (the proactive-suggestions turn): dropped entirely — no
 *     preview, no proposal, not even a pending-approval row.
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
  if (spec.risk !== 'write') return 'autonomous'
  // Write-risk from here.
  if (ctx.writeToolPolicy === 'disabled') return 'disabled'
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

/** JSON.stringify with object keys sorted, so equivalent args always hash the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function hashArgs(args: unknown): string {
  return createHash('sha256').update(canonicalJson(args)).digest('hex')
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
  return `${ctx.conversationId ?? ctx.ticketId}:${ctx.latestCustomerMessageId}:${spec.name}:${hashArgs(args)}`
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
  mode: Exclude<ToolExecutionMode, 'disabled'>,
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
    // Polymorphic parent (unified inbox §3.3): whichever item this turn is
    // grounded on. `ctx.conversationId` wins when both happen to be set (never
    // true today — a turn grounds on exactly one item), matching every
    // pre-ticket caller's behavior unchanged.
    const parent = ctx.conversationId
      ? { conversationId: ctx.conversationId }
      : { ticketId: ctx.ticketId as TicketId }
    const pending = await proposePendingAction({
      ...parent,
      involvementId: ctx.involvementId ?? undefined,
      toolName: spec.name,
      args: args as Record<string, unknown>,
      summary,
      originRole: ctx.role,
      // Same-shaped key as the autonomous branch's claim below: a synthesis
      // retry that re-runs this exact write-tool call for the same turn
      // dedupes onto the first proposal row instead of inserting a duplicate
      // and re-announcing the note (see proposePendingAction). Always
      // defined here — approval mode is only ever reached for a write-risk
      // spec (reads never support it), and resolveIdempotencyKey always
      // returns a key for a write-risk spec.
      idempotencyKey: resolveIdempotencyKey(spec, args, ctx),
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
    })
    ctx.ledger.toolOutcomes.push({ name: spec.name, outcome: 'proposed' })
    return { status: 'pending_approval', note: PENDING_APPROVAL_NOTE }
  }

  // mode === 'autonomous' from here: simulate and propose both returned above.
  for (const permission of spec.permissions) {
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
  let claimed: AssistantToolCall | null = null
  if (shouldClaim) {
    claimed = await claimToolCall({
      conversationId: ctx.conversationId as ConversationId,
      involvementId: ctx.involvementId ?? undefined,
      toolName: spec.name,
      args: args as Record<string, unknown>,
      idempotencyKey: resolveIdempotencyKey(spec, args, ctx),
      principalId: ctx.assistantPrincipalId,
    })
    if (!claimed) {
      ctx.ledger.toolOutcomes.push({ name: spec.name, outcome: 'failed' })
      return { status: 'skipped_duplicate', note: DUPLICATE_NOTE }
    }
  }

  const settled = await executeAndFinalize(spec, args, claimed, ctx)
  ctx.ledger.toolOutcomes.push({
    name: spec.name,
    outcome: settled.ok ? (spec.risk === 'read' ? 'read' : 'executed') : 'failed',
  })
  return settled.ok ? settled.result : { status: 'failed', note: FAILED_NOTE }
}

/**
 * The shared execute step: run the tool, settle any claimed audit row with the
 * outcome and latency, and never throw. Both the autonomous pipeline and the
 * teammate-approved path end here, so finalize semantics live once.
 */
async function executeAndFinalize(
  spec: AssistantToolSpec,
  args: unknown,
  claimed: AssistantToolCall | null,
  ctx: AssistantToolContext
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const startedAt = Date.now()
  try {
    const result = await spec.execute(args, ctx)
    // Defense in depth alongside the `parents` catalogue gate (assembleAssistantToolset):
    // a tool that reports it found no parent to act on (see `NO_CONVERSATION_NOTE`)
    // is never a successful execution, even if it somehow ran — most notably
    // `executeApprovedPendingAction`, which runs a spec looked up straight off
    // a stored pending-action row rather than this turn's filtered catalogue.
    if (isNoParentResult(result)) {
      if (claimed) {
        await finalizeToolCall(claimed.id, {
          status: 'failed',
          error: NO_CONVERSATION_NOTE,
          latencyMs: Date.now() - startedAt,
        })
      }
      return { ok: false, error: NO_CONVERSATION_NOTE }
    }
    if (claimed) {
      await finalizeToolCall(claimed.id, {
        status: 'succeeded',
        resultSummary: spec.summarize(args, ctx),
        latencyMs: Date.now() - startedAt,
      })
    }
    return { ok: true, result }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error({ err: error, tool: spec.name }, 'assistant tool execution failed')
    if (claimed) {
      await finalizeToolCall(claimed.id, {
        status: 'failed',
        error: message,
        latencyMs: Date.now() - startedAt,
      })
    }
    return { ok: false, error: message }
  }
}

/** Outcome of running a teammate-approved pending action through the pipeline. */
export type ExecuteApprovedActionResult =
  | { status: 'executed'; result: unknown }
  | { status: 'failed'; error: string }
  | { status: 'skipped_duplicate' }

/**
 * Execute a pending action a teammate approved, via the same claim/execute/
 * finalize steps autonomous mode runs in `runWithPipeline` — but keyed by the
 * pending action id rather than the customer message (the approval decision
 * is itself the idempotency boundary a resubmitted approve request must not
 * cross), and with the audit row linked back to the proposal it settles. No
 * permission check here: approval mode never checks `spec.permissions` at
 * proposal time because the approving human authorizes it, and the caller
 * (the approve server fn) already asserted the approver holds every declared
 * permission before calling this.
 */
export async function executeApprovedPendingAction(
  spec: AssistantToolSpec,
  pendingAction: AssistantPendingAction,
  ctx: AssistantToolContext
): Promise<ExecuteApprovedActionResult> {
  const claimed = await claimToolCall({
    // Ticket-scoped pending actions (unified inbox §3.3) have no
    // conversationId; the tool-call audit trail doesn't thread a ticket
    // parent yet, so this stays undefined for that case rather than wired.
    conversationId: pendingAction.conversationId ?? undefined,
    involvementId: pendingAction.involvementId ?? undefined,
    pendingActionId: pendingAction.id,
    toolName: spec.name,
    args: pendingAction.args,
    idempotencyKey: `pending:${pendingAction.id}`,
    principalId: ctx.assistantPrincipalId,
  })
  if (!claimed) return { status: 'skipped_duplicate' }

  const settled = await executeAndFinalize(spec, pendingAction.args, claimed, ctx)
  return settled.ok
    ? { status: 'executed', result: settled.result }
    : { status: 'failed', error: settled.error }
}

/** Bind a spec straight to its own execute, no pipeline — the shape used
 *  when assistant actions are off, byte-identical to the pre-pipeline tools. */
function toLegacyServerTool(spec: AssistantToolSpec, ctx: AssistantToolContext) {
  return spec.definition.server<AssistantToolContext>(async (args) => {
    ctx.ledger.toolCalls.push(spec.name)
    try {
      const result = await spec.execute(args, ctx)
      ctx.ledger.toolOutcomes.push({ name: spec.name, outcome: 'read' })
      return result
    } catch (error) {
      ctx.ledger.toolOutcomes.push({ name: spec.name, outcome: 'failed' })
      throw error
    }
  })
}

/**
 * Build this turn's tool set, paired with the specs that produced it
 * (`activeSpecs[i]` is the spec behind `tools[i]`). Assistant actions off
 * means every catalogue tool runs exactly as before the pipeline existed,
 * with no settings read beyond the flag. Actions on resolves each built-in
 * spec's execution mode from the turn's write policy (see
 * `resolveEffectiveToolMode`), drops disabled tools, and wraps the rest in
 * the execution pipeline.
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
  actionsEnabled = false,
  customActionSpecs: readonly AssistantToolSpec[] = []
): Promise<{ tools: ReturnType<typeof toLegacyServerTool>[]; activeSpecs: AssistantToolSpec[] }> {
  // Unified inbox §2.9/§3.3: never even consider a spec whose `parents`
  // excludes this turn's actual parent kind: a conversation-only write tool
  // must not reach mode resolution, proposal, or the model at all on a
  // ticket-scoped turn. See `parents`'s own doc on AssistantToolSpec.
  const parentKind = turnParentKind(ctx)
  const availableForTurn = (spec: AssistantToolSpec) =>
    spec.parents.includes(parentKind) && (spec.availableWhen?.(ctx) ?? true)

  // Custom actions (Phase 5, QUINN-TWO-AGENT-SPEC D6) are write-risk and ALWAYS
  // run through the execution pipeline — their audit ledger and the copilot
  // propose path are load-bearing — regardless of the built-in `assistantTools`
  // flag. The caller only ever passes them when the separate
  // `assistantCustomActions` flag is on and after resolving them for the turn's
  // agent, so the two rollout gates stay independent.
  const customActive = customActionSpecs
    .filter(availableForTurn)
    .map((spec) => ({ spec, mode: resolveEffectiveToolMode(spec, ctx) }))
    .filter(
      (entry): entry is { spec: AssistantToolSpec; mode: Exclude<ToolExecutionMode, 'disabled'> } =>
        entry.mode !== 'disabled'
    )
  const customTools = customActive.map(({ spec, mode }) =>
    spec.definition.server<AssistantToolContext>((args) => runWithPipeline(spec, mode, args, ctx))
  )
  const customActiveSpecs = customActive.map((entry) => entry.spec)

  if (!actionsEnabled) {
    // Flag off exposes read tools plus core control tools, unwrapped. Write
    // specs must never register without the pipeline, while handoff/inability
    // remain part of Quinn's agent protocol regardless of this feature flag.
    // Custom actions (when their own flag brought them here) still ride the
    // pipeline — they are never registered unwrapped.
    const legacySpecs = (specs ?? Object.values(ASSISTANT_TOOL_SPECS)).filter(
      (spec) => spec.risk !== 'write' && availableForTurn(spec)
    )
    return {
      tools: [...legacySpecs.map((spec) => toLegacyServerTool(spec, ctx)), ...customTools],
      activeSpecs: withDynamicPromptGuidance([...legacySpecs, ...customActiveSpecs], ctx),
    }
  }

  const resolvedSpecs = (specs ?? resolveToolSpecs()).filter(availableForTurn)
  const active = resolvedSpecs
    .map((spec) => ({
      spec,
      mode: resolveEffectiveToolMode(spec, ctx),
    }))
    .filter(
      (entry): entry is { spec: AssistantToolSpec; mode: Exclude<ToolExecutionMode, 'disabled'> } =>
        entry.mode !== 'disabled'
    )
  return {
    tools: [
      ...active.map(({ spec, mode }) =>
        spec.definition.server<AssistantToolContext>((args) =>
          runWithPipeline(spec, mode, args, ctx)
        )
      ),
      ...customTools,
    ],
    activeSpecs: withDynamicPromptGuidance(
      [...active.map((entry) => entry.spec), ...customActiveSpecs],
      ctx
    ),
  }
}
