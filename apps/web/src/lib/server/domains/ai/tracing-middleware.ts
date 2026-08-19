/**
 * OpenTelemetry tracing for the agentic assistant turn, hung off TanStack AI's
 * `ChatMiddleware` lifecycle hooks. One span per `chat()` invocation (the turn),
 * with a child span per tool execution.
 *
 * PRIVACY CONTRACT (mirrors the ai_usage_log metadata discipline in
 * assistant.runtime.ts): span attributes carry only non-sensitive, structural
 * signal — tool NAMES and counts, role, surface, prompt/config version, finish
 * reason, and token usage. Tool arguments, tool results, retrieved content,
 * system prompts, and any customer text NEVER land on a span. Adding an
 * attribute here is a review surface: keep it to the vocabulary below.
 *
 * INSTRUMENTATION ONLY. This uses the OTel API's global tracer, which is a
 * no-op unless an SDK/exporter has been registered at process start. We do NOT
 * register a provider or exporter here — export wiring rides the open
 * observability issue (gh #313). With no provider registered every span is a
 * non-recording no-op and behavior is byte-for-byte unchanged.
 */
import {
  trace,
  context as otelContext,
  SpanKind,
  SpanStatusCode,
  type Span,
  type Tracer,
} from '@opentelemetry/api'
import type {
  AfterToolCallInfo,
  ChatMiddleware,
  ChatMiddlewareContext,
  ErrorInfo,
  FinishInfo,
  ToolCallHookContext,
  UsageInfo,
} from '@tanstack/ai'

const TRACER_NAME = 'quackback.assistant'

/**
 * The non-identifying, non-textual turn attributes the caller resolves once and
 * the middleware stamps onto the root span. Deliberately excludes ids
 * (conversation/ticket/principal) and any free text — this is the same floor
 * the usage-log metadata holds to.
 */
export interface AssistantTraceAttributes {
  role: string
  surface: string
  promptVersion: string
  configRevision: number
}

/** Per-chat()-invocation span bookkeeping, keyed by the stable requestId. */
interface TurnSpanState {
  root: Span
  /** Child span per in-flight tool call, keyed by toolCallId. */
  toolSpans: Map<string, Span>
  toolCallCount: number
  /**
   * Running token totals summed across every onUsage the turn fires — one per
   * agent-loop iteration. The attributes carry the accumulated sum, not just
   * the last iteration's slice (which used to overwrite and undercount a
   * multi-iteration turn).
   */
  usage: { input: number; output: number; total: number }
}

/**
 * Build a ChatMiddleware that emits OTel spans for one assistant turn.
 *
 * @param attributes non-sensitive turn attributes stamped on the root span
 * @param tracer     override for tests; defaults to the global (no-op) tracer
 */
export function createAssistantTracingMiddleware(
  attributes: AssistantTraceAttributes,
  tracer: Tracer = trace.getTracer(TRACER_NAME)
): ChatMiddleware {
  // Keyed by ctx.requestId so a single middleware instance stays correct across
  // the sequential chat() calls one turn can make (semantic-salvage retry,
  // transport re-dial): each invocation is its own span, never a leaked one.
  const turns = new Map<string, TurnSpanState>()

  const endTurn = (ctx: ChatMiddlewareContext, finalize: (state: TurnSpanState) => void): void => {
    const state = turns.get(ctx.requestId)
    if (!state) return
    turns.delete(ctx.requestId)
    // Close any tool span still open (e.g. an abort mid-execution) so a failure
    // path can never orphan a child span.
    for (const span of state.toolSpans.values()) span.end()
    state.toolSpans.clear()
    finalize(state)
    state.root.end()
  }

  return {
    name: 'assistant-otel-tracing',

    onStart(ctx: ChatMiddlewareContext) {
      const root = tracer.startSpan('assistant.turn', {
        kind: SpanKind.CLIENT,
        attributes: {
          'gen_ai.operation.name': 'chat',
          'gen_ai.request.model': ctx.model,
          'gen_ai.provider.name': ctx.provider,
          'quackback.assistant.role': attributes.role,
          'quackback.assistant.surface': attributes.surface,
          'quackback.assistant.prompt_version': attributes.promptVersion,
          'quackback.assistant.config_revision': attributes.configRevision,
        },
      })
      turns.set(ctx.requestId, {
        root,
        toolSpans: new Map(),
        toolCallCount: 0,
        usage: { input: 0, output: 0, total: 0 },
      })
    },

    onBeforeToolCall(ctx: ChatMiddlewareContext, hookCtx: ToolCallHookContext) {
      const state = turns.get(ctx.requestId)
      if (!state) return
      // Child span parented under the turn's root span. Only the tool NAME is
      // recorded — never hookCtx.args.
      const span = otelContext.with(trace.setSpan(otelContext.active(), state.root), () =>
        tracer.startSpan('assistant.tool', {
          kind: SpanKind.INTERNAL,
          attributes: { 'gen_ai.tool.name': hookCtx.toolName },
        })
      )
      state.toolSpans.set(hookCtx.toolCallId, span)
      state.toolCallCount += 1
    },

    onAfterToolCall(ctx: ChatMiddlewareContext, info: AfterToolCallInfo) {
      const state = turns.get(ctx.requestId)
      const span = state?.toolSpans.get(info.toolCallId)
      if (!state || !span) return
      state.toolSpans.delete(info.toolCallId)
      // Outcome shape only: ok flag and duration. Never info.result / info.error
      // bodies (they can carry tool output or customer text).
      span.setAttribute('quackback.assistant.tool.ok', info.ok)
      span.setAttribute('quackback.assistant.tool.duration_ms', info.duration)
      span.setStatus({
        code: info.ok ? SpanStatusCode.OK : SpanStatusCode.ERROR,
      })
      span.end()
    },

    onUsage(ctx: ChatMiddlewareContext, usage: UsageInfo) {
      const state = turns.get(ctx.requestId)
      // Cheap short-circuit: with no exporter registered the span is a non-
      // recording no-op, so skip the bookkeeping entirely.
      if (!state || !state.root.isRecording()) return
      // onUsage fires once per agent-loop iteration; accumulate so the final
      // attributes reflect the whole turn, not just the last iteration's slice.
      // OTel gen_ai names input/output; TanStack's TokenUsage names
      // prompt/completion. Map, guarding each in case a provider omits it.
      if (typeof usage.promptTokens === 'number') state.usage.input += usage.promptTokens
      if (typeof usage.completionTokens === 'number') state.usage.output += usage.completionTokens
      if (typeof usage.totalTokens === 'number') state.usage.total += usage.totalTokens
      state.root.setAttribute('gen_ai.usage.input_tokens', state.usage.input)
      state.root.setAttribute('gen_ai.usage.output_tokens', state.usage.output)
      state.root.setAttribute('gen_ai.usage.total_tokens', state.usage.total)
    },

    onFinish(ctx: ChatMiddlewareContext, info: FinishInfo) {
      endTurn(ctx, (state) => {
        if (info.finishReason)
          state.root.setAttribute('gen_ai.response.finish_reason', info.finishReason)
        state.root.setAttribute('quackback.assistant.tool_call_count', state.toolCallCount)
        state.root.setStatus({ code: SpanStatusCode.OK })
      })
    },

    onError(ctx: ChatMiddlewareContext, info: ErrorInfo) {
      endTurn(ctx, (state) => {
        state.root.setAttribute('quackback.assistant.tool_call_count', state.toolCallCount)
        // Record the infra error (message/stack only — an infra failure, not
        // customer text). Deliberately does not attach any run content.
        if (info.error instanceof Error) state.root.recordException(info.error)
        state.root.setStatus({
          code: SpanStatusCode.ERROR,
          message: info.error instanceof Error ? info.error.message : 'assistant turn failed',
        })
      })
    },

    onAbort(ctx: ChatMiddlewareContext) {
      endTurn(ctx, (state) => {
        state.root.setAttribute('quackback.assistant.tool_call_count', state.toolCallCount)
        state.root.setStatus({ code: SpanStatusCode.ERROR, message: 'aborted' })
      })
    },
  }
}
