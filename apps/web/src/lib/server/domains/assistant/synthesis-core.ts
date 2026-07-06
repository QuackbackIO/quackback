/**
 * Shared synthesis engine behind Quinn's tool-using turn (assistant.runtime.ts)
 * and Ask AI's one-shot answer (synthesis.ts). Both are thin wrappers around
 * one parameterized core: a chat()-stream delta-diffing skeleton, JSON
 * salvage plumbing, and a small retry harness.
 *
 * Everything that differs between the two today is an explicit option rather
 * than something this module decides on its own: the error contract
 * (`onFailure`), salvage strictness (`salvageMode` + a caller `salvage` fn),
 * whether tools are wired in at all (`tools: null | {...}`), and how an
 * attempt's outcome is classified for the usage log (`deriveAnswerKind`).
 * Output-schema validation and citation/guardrail post-processing
 * (assembleCitations/relinkCitations, validateAnswer) stay OUTSIDE this
 * module entirely: it only ever hands back the raw decoded-or-salvaged
 * structured object, never interprets it. A future caller (e.g. a
 * teammate-facing copilot with tools optionally on) is meant to be a new set
 * of options here, not a fork of this file.
 */
import { chat, parsePartialJSON, type AgentLoopStrategy, type AnyTool } from '@tanstack/ai'
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'
import { jsonrepair } from 'jsonrepair'
import type { z } from 'zod'
import { config } from '@/lib/server/config'
import { structuredOutputProviderOptions } from '@/lib/server/domains/ai/config'
import { withUsageLogging, type AiAnswerKind } from '@/lib/server/domains/ai/usage-log'

/** Output budget default: constrained decoding on small models needs headroom. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 1024

/** Attempts beyond the first: 2 total attempts by default (one retry). */
export const DEFAULT_RETRIES = 1

export interface SynthesisMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Tools wiring for the attempt. `null` skips TOOL_CALL_START handling and the
 * agent-loop strategy entirely, reproducing a one-shot call with no tools.
 */
export interface SynthesisTools<TContext = unknown> {
  /** Tool specs passed straight through to chat(). */
  specs: AnyTool[]
  /** Tool execution context threaded through chat(). */
  context: TContext
  /** Caps the agentic loop (e.g. maxIterations(N)). */
  agentLoopStrategy: AgentLoopStrategy
  /**
   * Names in this turn's assembled tool set. A TOOL_CALL_START chunk for a
   * name outside this set is ignored (the registry, not a hardcoded list,
   * decides what's valid).
   */
  names: ReadonlySet<string>
}

/**
 * `strict`: a RUN_ERROR chunk throws immediately, and salvage (when reached)
 * always runs, abort or not.
 * `forgiving`: a RUN_ERROR chunk is recorded, not thrown, so the stream keeps
 * draining and salvage gets a chance to recover an answer from whatever raw
 * text arrived; only if salvage still fails does the recorded error surface.
 * Salvage is skipped on an aborted signal (the caller wants the cancellation
 * to propagate, not a salvaged partial).
 */
export type SalvageMode = 'strict' | 'forgiving'

export interface AttemptOutcome {
  final: unknown | null
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
}

export type SynthesisActivity = { kind: 'thinking' } | { kind: 'tool'; tool: string }

interface RunAttemptOptions<TContext> {
  model: string
  systemPrompts: string[]
  messages: SynthesisMessage[]
  outputSchema: z.ZodTypeAny
  tools?: SynthesisTools<TContext> | null
  maxOutputTokens?: number
  /** Which top-level string field of the partial JSON to stream as clean deltas. */
  deltaField: string
  salvageMode: SalvageMode
  /** Recover a structured candidate from the raw accumulated text when strict
   *  decoding didn't produce one. Returns null when nothing usable was found. */
  salvage: (raw: string, runError: string | null) => unknown | null
  signal?: AbortSignal
  onTextDelta?: (delta: string) => void
  onActivity?: (activity: SynthesisActivity) => void
}

/** jsonrepair throws on hopeless input; treat that as "no repair available". */
export function safeJsonRepair(text: string): string | null {
  try {
    return jsonrepair(text)
  } catch {
    return null
  }
}

/** One model call: stream consumption, delta-diffing, tools (if any), and salvage. */
async function runOneAttempt<TContext>(opts: RunAttemptOptions<TContext>): Promise<AttemptOutcome> {
  opts.onActivity?.({ kind: 'thinking' })

  const controller = new AbortController()
  const forwardAbort = () => controller.abort()
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort()
    else opts.signal.addEventListener('abort', forwardAbort, { once: true })
  }

  const adapter = openaiCompatibleText(opts.model, {
    baseURL: config.openaiBaseUrl!,
    apiKey: config.openaiApiKey!,
  })

  const modelOptions = {
    max_tokens: opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    // NOTE: do not add sampling params (e.g. temperature) here. The provider
    // options gate routing on providers advertising EVERY param in the
    // request (require_parameters), so a param many providers don't
    // advertise silently shrinks the pool to none and the turn dies with no
    // output.
    ...structuredOutputProviderOptions(),
  }

  const tools = opts.tools
  const stream = tools
    ? chat({
        adapter,
        messages: opts.messages,
        systemPrompts: opts.systemPrompts,
        tools: tools.specs,
        context: tools.context,
        outputSchema: opts.outputSchema,
        agentLoopStrategy: tools.agentLoopStrategy,
        stream: true,
        abortController: controller,
        modelOptions,
      })
    : chat({
        adapter,
        messages: opts.messages,
        systemPrompts: opts.systemPrompts,
        outputSchema: opts.outputSchema,
        stream: true,
        abortController: controller,
        modelOptions,
      })

  let raw = ''
  let emitted = ''
  let final: unknown | null = null
  let usage: AttemptOutcome['usage']
  let runError: string | null = null

  try {
    for await (const chunk of stream) {
      switch (chunk.type) {
        case 'TEXT_MESSAGE_CONTENT': {
          // Deltas are raw JSON; surface only the growth of the target field
          // so consumers stream clean text, not the JSON envelope.
          raw += chunk.delta
          const partial = parsePartialJSON(raw) as Record<string, unknown> | undefined
          const text =
            typeof partial?.[opts.deltaField] === 'string'
              ? (partial[opts.deltaField] as string)
              : ''
          if (text.length > emitted.length && text.startsWith(emitted)) {
            opts.onTextDelta?.(text.slice(emitted.length))
            emitted = text
          }
          break
        }
        case 'TOOL_CALL_START': {
          // Additive: a no-op when this call has no tools wired in.
          if (!tools) break
          // `toolCallName` is the @ag-ui/core field; `toolName` is TanStack's
          // deprecated alias.
          const tool =
            (chunk as { toolCallName?: string; toolName?: string }).toolCallName ??
            (chunk as { toolName?: string }).toolName
          if (tool && tools.names.has(tool)) {
            opts.onActivity?.({ kind: 'tool', tool })
          }
          break
        }
        case 'CUSTOM': {
          if (chunk.name === 'structured-output.complete') {
            final = (chunk.value as { object: unknown }).object
          }
          break
        }
        case 'RUN_FINISHED': {
          usage = (chunk as { usage?: AttemptOutcome['usage'] }).usage
          break
        }
        case 'RUN_ERROR': {
          const message = (chunk as { message?: string }).message ?? 'model run failed'
          if (opts.salvageMode === 'strict') {
            throw new Error(message)
          }
          // forgiving: don't throw yet, the stream often carries the model's
          // raw text alongside a parse failure; record and try to salvage.
          runError = message
          break
        }
      }
    }
  } finally {
    opts.signal?.removeEventListener('abort', forwardAbort)
  }

  // Strict decoding can fail on providers that accept the schema without
  // enforcing it. When the model still emitted text, recover a schema-shaped
  // answer from it rather than dropping the attempt. Forgiving mode skips
  // this on abort (the caller wants the cancellation to propagate, not a
  // salvaged partial); strict mode always tries.
  const skipSalvage = opts.salvageMode === 'forgiving' && opts.signal?.aborted
  if (final === null && !skipSalvage && raw.trim().length > 0) {
    final = opts.salvage(raw, runError)
  }
  if (final === null && runError !== null) {
    throw new Error(runError)
  }

  return { final, usage }
}

export interface RunSynthesisOptions<
  TValue,
  TContext = unknown,
> extends RunAttemptOptions<TContext> {
  /** Total attempts beyond the first. Defaults to `DEFAULT_RETRIES` (one retry). */
  retries?: number
  /** Quinn never leaves the customer in silence: 'fallback'. Ask AI surfaces a
   *  hard failure to its route: 'throw'. */
  onFailure: 'throw' | 'fallback'
  /** Required (and only used) when `onFailure` is 'fallback'. */
  fallbackValue?: TValue
  usageLogParams: {
    pipelineStep: string
    callType: 'chat_completion'
    model: string
    metadata?: Record<string, unknown>
  }
  /** Classify an attempt for the usage-log metadata; caller policy, not the core's. */
  deriveAnswerKind: (attempt: AttemptOutcome, attemptIndex: number) => AiAnswerKind
  /** Runs before each attempt (e.g. resetting a per-attempt tool ledger). */
  onAttemptStart?: (attemptIndex: number) => void
  /** Runs after a non-final attempt fails, before the next attempt starts. */
  onRetry?: (attemptIndex: number, error: Error) => void
}

export type SynthesisOutcome<TValue> =
  | { outcome: 'success'; final: unknown; usage?: AttemptOutcome['usage'] }
  | { outcome: 'fallback'; value: TValue; lastError: Error | null }

/**
 * Run the attempt-and-retry harness. Returns `{outcome:'success', final}` with
 * the raw decoded-or-salvaged structured object on a usable attempt (schema
 * validation and any further guardrails are the caller's job); on total
 * failure either throws (`onFailure:'throw'`) or resolves to
 * `{outcome:'fallback', value: fallbackValue}` (`onFailure:'fallback'`). An
 * abort always propagates as a throw, even in fallback mode, so a cancelled
 * request never comes back looking like a normal fallback reply.
 */
export async function runSynthesis<TValue, TContext = unknown>(
  options: RunSynthesisOptions<TValue, TContext>
): Promise<SynthesisOutcome<TValue>> {
  const retries = options.retries ?? DEFAULT_RETRIES
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    options.onAttemptStart?.(attempt)
    try {
      const attemptOutcome = await withUsageLogging(
        {
          pipelineStep: options.usageLogParams.pipelineStep,
          callType: options.usageLogParams.callType,
          model: options.usageLogParams.model,
          metadata: { ...options.usageLogParams.metadata, attempt },
        },
        async () => {
          const result = await runOneAttempt(options)
          return {
            result,
            retryCount: 0,
            metadata: { answerKind: options.deriveAnswerKind(result, attempt) },
          }
        },
        (r: AttemptOutcome) => ({
          inputTokens: r.usage?.promptTokens ?? 0,
          outputTokens: r.usage?.completionTokens ?? 0,
          totalTokens: r.usage?.totalTokens ?? 0,
        })
      )
      if (attemptOutcome.final !== null) {
        return { outcome: 'success', final: attemptOutcome.final, usage: attemptOutcome.usage }
      }
      lastError = new Error('model returned no structured answer')
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (options.signal?.aborted) throw lastError
    }
    if (attempt < retries) options.onRetry?.(attempt, lastError)
  }

  if (options.onFailure === 'fallback') {
    // An abort is the caller's to handle, so propagate it; otherwise resolve
    // to the fallback value rather than leaving a silent gap.
    if (options.signal?.aborted) throw lastError ?? new Error('synthesis aborted')
    return { outcome: 'fallback', value: options.fallbackValue as TValue, lastError }
  }
  throw lastError ?? new Error('synthesis failed')
}
