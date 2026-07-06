/**
 * Quinn's tool-execution pipeline: assembles the tool catalogue
 * (assistant.toolspec.ts) into TanStack AI server tools bound to a runtime
 * context, gated by the workspace's tool controls.
 *
 * Assembly runs once per turn — assistant.runtime.ts calls it before the
 * retry loop, since the feature flag and control-mode settings are turn-scoped
 * config, not per-attempt state; re-reading them on a retry could flip gating
 * mid-turn.
 *
 * Per registered tool the wrapped execute runs: mode gate (resolved at
 * assembly) -> approval short-circuits to a pending action -> permission
 * check -> idempotency claim -> execute -> audit finalize. A tool error never
 * escapes into the model loop; it settles the audit row and returns a
 * graceful note instead.
 */
import { createHash } from 'node:crypto'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import {
  getAssistantToolControls,
  type AssistantToolControls,
} from '@/lib/server/domains/settings/settings.assistant'
import { can } from '@/lib/server/policy/authorize'
import { logger } from '@/lib/server/logger'
import type { ConversationId } from '@quackback/ids'
import type { AssistantToolContext, AssistantToolSpec, ToolControlMode } from './assistant.toolspec'
import { ASSISTANT_TOOL_SPECS, resolveToolSpecs } from './assistant.toolspec'
import {
  claimToolCall,
  finalizeToolCall,
  recordDeniedToolCall,
  type AssistantToolCall,
} from './tool-audit'
import { proposePendingAction, type AssistantPendingAction } from './pending-actions.service'

const log = logger.child({ component: 'assistant-tools' })

const PENDING_APPROVAL_NOTE =
  'A teammate must approve this action; tell the customer it has been requested.'
const DENIED_NOTE = 'This action is not permitted for the assistant.'
const DUPLICATE_NOTE = 'This action was already performed for this message.'
const FAILED_NOTE = 'This action could not be completed.'

/**
 * The single resolution the pipeline runs on: `resolveEffectiveToolMode`'s
 * result folds the saved control, the unsupported-mode fail-closed, and the
 * simulate override into ONE value. 'disabled' is only ever consumed by
 * `assembleAssistantToolset`'s filter, which drops the tool before it is
 * registered; `runWithPipeline` itself only ever receives 'approval' |
 * 'autonomous' | 'simulate'.
 */
export type EffectiveToolMode = ToolControlMode | 'simulate'

/**
 * Resolve a spec's effective mode for this turn: the saved control (or the
 * spec's default), then two folds on top, applied in order.
 *
 * 1. Unsupported mode fails closed. A saved mode the spec no longer supports
 *    (or, for a read tool, 'approval': reads never support it) disables the
 *    tool rather than silently running under some other permissiveness.
 * 2. 'disabled' always wins. A tool the workspace turned off never runs
 *    under any circumstance, `ctx.simulate` included.
 * 3. Write-risk simulate override. A write-risk tool with `ctx.simulate` true
 *    resolves to 'simulate' unless `ctx.writeToolPolicy` is explicitly
 *    'controls', in which case the configured mode (approval or autonomous)
 *    is honored instead. `ctx.writeToolPolicy` unset behaves as 'simulate',
 *    matching today's behavior for every existing caller (see its doc on
 *    `AssistantToolContext`). Read-risk tools are never affected by
 *    `ctx.simulate`: reads only observe, so there is nothing to preview.
 */
export function resolveEffectiveToolMode(
  spec: AssistantToolSpec,
  saved: ToolControlMode | undefined,
  ctx: AssistantToolContext
): EffectiveToolMode {
  const mode = saved ?? spec.defaultMode
  if (!spec.supportedModes.includes(mode)) {
    log.warn(
      { tool: spec.name, mode },
      'assistant tool control mode not supported by this tool; disabling'
    )
    return 'disabled'
  }
  if (mode === 'disabled') return 'disabled'
  if (spec.risk === 'write' && ctx.simulate && (ctx.writeToolPolicy ?? 'simulate') === 'simulate') {
    return 'simulate'
  }
  return mode
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
 * read-risk tools never need one (they never claim).
 */
function resolveIdempotencyKey(
  spec: AssistantToolSpec,
  args: unknown,
  ctx: AssistantToolContext
): string | undefined {
  if (spec.idempotencyKey) return spec.idempotencyKey(args, ctx)
  if (spec.risk !== 'write') return undefined
  return `${ctx.conversationId}:${ctx.latestCustomerMessageId}:${spec.name}:${hashArgs(args)}`
}

/**
 * Run one tool call through the control-mode pipeline. `mode` arrives already
 * fully resolved (see `resolveEffectiveToolMode`); this function does no
 * further gating of its own, it only carries out what the mode says.
 * Simulate previews instead of running. Approval short-circuits to a pending
 * action (no permission check: the approving human authorizes it).
 * Autonomous checks every declared permission, then (write-risk only) claims
 * an idempotency slot, executes, and finalizes the audit row. Never throws:
 * an execution failure settles the audit row and returns a graceful note so
 * a tool error can't crash the turn.
 */
async function runWithPipeline(
  spec: AssistantToolSpec,
  mode: Exclude<EffectiveToolMode, 'disabled'>,
  args: unknown,
  ctx: AssistantToolContext
): Promise<unknown> {
  if (mode === 'simulate') {
    // A write tool's outcome resolved to a preview instead of a real run.
    // Two distinct reasons land here (see `AssistantToolContext.writeToolPolicy`
    // and `resolveEffectiveToolMode` for how the choice is made): the sandbox
    // has no real conversation to attach a claim, approval, or denial to
    // (nowhere to attach), while copilot has a real conversation but previews
    // anyway because a teammate asking Quinn a question about the
    // conversation must never let Quinn act in it (policy says preview).
    return { simulated: true, summary: spec.summarize(args) }
  }

  if (mode === 'approval') {
    await proposePendingAction({
      conversationId: ctx.conversationId as ConversationId,
      involvementId: ctx.involvementId ?? undefined,
      toolName: spec.name,
      args: args as Record<string, unknown>,
      summary: spec.summarize(args),
    })
    return { status: 'pending_approval', note: PENDING_APPROVAL_NOTE }
  }

  // mode === 'autonomous' from here: simulate and approval both returned above.
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
    if (!claimed) return { status: 'skipped_duplicate', note: DUPLICATE_NOTE }
  }

  const settled = await executeAndFinalize(spec, args, claimed, ctx)
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
    if (claimed) {
      await finalizeToolCall(claimed.id, {
        status: 'succeeded',
        resultSummary: spec.summarize(args),
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
    conversationId: pendingAction.conversationId,
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
  return spec.definition.server<AssistantToolContext>((args) => spec.execute(args, ctx))
}

/**
 * Build this turn's tool set, paired with the specs that produced it
 * (`activeSpecs[i]` is the spec behind `tools[i]`). Assistant actions off
 * means every catalogue tool runs exactly as before the pipeline existed,
 * with no settings read beyond the flag — that legacy branch uses the static
 * registry directly and never resolves connector tools, even if
 * dataConnectors is on: every connector's defaultMode is 'disabled' and the
 * legacy branch does not consult control modes at all, so a connector must
 * never reach it unwrapped. Actions on resolves the full catalogue (static +
 * connector, via `resolveToolSpecs`) and each spec's fully resolved mode (see
 * `resolveEffectiveToolMode`, saved-or-default plus the simulate override),
 * drops disabled tools, and wraps the rest in the control-mode pipeline.
 *
 * `specs` defaults to the live catalogue; tests inject a fixed list to
 * exercise write-risk behavior the current catalogue doesn't ship yet.
 * `controls` defaults to fetching the saved tool-controls map; the runtime
 * passes the one it already read this turn (via `getAssistantConfig`) so
 * assembly never re-reads the settings row on its own.
 *
 * The system prompt builder needs `activeSpecs` (each carries its own
 * promptGuidance line, composed into the "Your tools" section); the agentic
 * loop needs `tools`. Kept as one function so the two can never drift apart.
 */
export async function assembleAssistantToolset(
  ctx: AssistantToolContext,
  specs?: readonly AssistantToolSpec[],
  controls?: AssistantToolControls
): Promise<{ tools: ReturnType<typeof toLegacyServerTool>[]; activeSpecs: AssistantToolSpec[] }> {
  const actionsEnabled = await isFeatureEnabled('assistantActions')
  if (!actionsEnabled) {
    // Flag off exposes ONLY the read tools, unwrapped. Write specs must never
    // register without the pipeline, so a growing catalogue cannot widen the
    // legacy surface on its own.
    const legacySpecs = (specs ?? Object.values(ASSISTANT_TOOL_SPECS)).filter(
      (spec) => spec.risk === 'read'
    )
    return {
      tools: legacySpecs.map((spec) => toLegacyServerTool(spec, ctx)),
      activeSpecs: legacySpecs,
    }
  }

  const resolvedSpecs = specs ?? (await resolveToolSpecs())
  const resolvedControls = controls ?? (await getAssistantToolControls())
  const active = resolvedSpecs
    .map((spec) => ({
      spec,
      mode: resolveEffectiveToolMode(spec, resolvedControls[spec.name], ctx),
    }))
    .filter(
      (entry): entry is { spec: AssistantToolSpec; mode: Exclude<EffectiveToolMode, 'disabled'> } =>
        entry.mode !== 'disabled'
    )
  return {
    tools: active.map(({ spec, mode }) =>
      spec.definition.server<AssistantToolContext>((args) => runWithPipeline(spec, mode, args, ctx))
    ),
    activeSpecs: active.map((entry) => entry.spec),
  }
}
