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
import {
  chat,
  parsePartialJSON,
  type AgentLoopStrategy,
  type AnyChatMiddleware,
  type AnyTool,
} from '@tanstack/ai'
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'
import { jsonrepair } from 'jsonrepair'
import type { z } from 'zod'
import { config } from '@/lib/server/config'
import { stripCodeFences, structuredOutputProviderOptions } from '@/lib/server/domains/ai/config'
import { withRetry } from '@/lib/server/domains/ai/retry'
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
  /**
   * A schema-valid final that failed the caller's semantic completion contract.
   * Kept on the attempt so usage logging can classify the real model call before
   * the retry harness turns it into a failed attempt.
   */
  validationError?: Error
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
  /**
   * Observability-only chat middleware passed straight through to chat() (e.g.
   * the assistant OTel tracing middleware). Purely additive: with none supplied
   * the call is byte-for-byte unchanged.
   */
  middleware?: AnyChatMiddleware[]
  /**
   * Transport re-dial budget for a pristine RUN_ERROR (see streamOnce's
   * boundary note). Defaults to `DEFAULT_TRANSPORT_RETRIES` (0) so a
   * latency-sensitive inline caller never inherits backoff; the main agentic
   * turn opts into 2. Only a pristine (nothing-streamed, no-tool-ran) RUN_ERROR
   * is ever re-dialed — a committed failure stops immediately regardless.
   */
  transportRetries?: number
}

/** jsonrepair throws on hopeless input; treat that as "no repair available". */
export function safeJsonRepair(text: string): string | null {
  try {
    return jsonrepair(text)
  } catch {
    return null
  }
}

/**
 * Recover a schema-shaped object from raw model text when the stream produced
 * no validated structured object: the text as-is and fence-stripped, each
 * tried raw then through a jsonrepair pass, first candidate that shape-checks
 * wins; null when nothing does. The shared salvage chain for the strict-mode
 * one-shot callers (Ask AI's synthesis.ts and the copilot transforms) —
 * assistant.runtime.ts keeps its own, deliberately looser ladder on top
 * (embedded-object extraction plus a partial text-only parse).
 */
export function salvageJsonWithSchema(
  schema: z.ZodTypeAny,
  raw: string | undefined
): unknown | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  for (const candidate of [trimmed, stripCodeFences(trimmed)]) {
    for (const text of [candidate, safeJsonRepair(candidate)]) {
      if (!text) continue
      try {
        const parsed = schema.safeParse(JSON.parse(text))
        if (parsed.success) return parsed.data
      } catch {
        // Not valid JSON even after repair: fall through to the next candidate.
      }
    }
  }
  return null
}

/**
 * Default transport re-dial budget for a pristine RUN_ERROR (see streamOnce): 0,
 * so a latency-sensitive inline caller never silently inherits backoff. Callers
 * opt in via RunSynthesisOptions.transportRetries (the main agentic turn passes
 * 2). Orthogonal to — and stacked under — the semantic-salvage retry
 * (runSynthesis' DEFAULT_RETRIES), which is unchanged.
 */
const DEFAULT_TRANSPORT_RETRIES = 0

/**
 * Marks a stream failure that must NOT be re-dialed: a chunk was already
 * consumed (text streamed to the caller / a side-effecting tool ran) or the
 * turn was aborted. withRetry classifies retryability on `.message`, so this
 * neutral, non-retryable message stops the transport-retry loop; runOneAttempt
 * unwraps `cause` to surface the original error to the semantic-salvage layer
 * and usage logging unchanged.
 */
class CommittedStreamError extends Error {
  constructor(readonly cause: Error) {
    super('assistant stream already committed; transport retry unsafe')
    this.name = 'CommittedStreamError'
  }
}

/**
 * One dial of chat(): open the stream, consume it (delta-diffing, tools,
 * salvage) and return an AttemptOutcome, or throw.
 *
 * TRANSPORT-RETRY BOUNDARY. The vendored @tanstack/ai-openai compatible adapter
 * never throws out of `for await`: every transport failure — a dial-time 429/5xx
 * and a mid-stream network drop alike — surfaces IN-STREAM as a RUN_STARTED then
 * RUN_ERROR chunk pair, not as a rejected iterator. So retryability turns on
 * whether anything MEANINGFUL was consumed before the RUN_ERROR, not on where in
 * the transport the failure happened.
 *
 * `committed` flips on the first meaningful chunk: TEXT_MESSAGE_CONTENT with a
 * non-empty delta (answer text reached the caller via onTextDelta), any
 * TOOL_CALL_* chunk (a tool is executing, with persisted side effects), or the
 * structured-output CUSTOM chunk (the decoded answer). Envelope chunks —
 * RUN_STARTED, TEXT_MESSAGE_START, STEP_* — do NOT commit: nothing has streamed
 * and no tool has run, so a re-dial is safe.
 *
 * A RUN_ERROR seen while still pristine is therefore a candidate transport
 * failure: it exits as a plain throw so withRetry can classify it via
 * isRetryableError on the RUN_ERROR message and re-dial (tool execution always
 * follows a TOOL_CALL chunk, which would already have committed). A RUN_ERROR
 * (or any throw, or an abort) after commit exits as a CommittedStreamError so
 * withRetry stops immediately — re-dialing could double-emit text or
 * double-persist a tool side effect. runOneAttempt unwraps the
 * CommittedStreamError back to its cause so the semantic-salvage layer and usage
 * logging see the original error exactly as before this transport layer existed.
 */
async function streamOnce<TContext>(
  opts: RunAttemptOptions<TContext>,
  controller: AbortController
): Promise<AttemptOutcome> {
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
        ...(opts.middleware ? { middleware: opts.middleware } : {}),
      })
    : chat({
        adapter,
        messages: opts.messages,
        systemPrompts: opts.systemPrompts,
        outputSchema: opts.outputSchema,
        stream: true,
        abortController: controller,
        modelOptions,
        ...(opts.middleware ? { middleware: opts.middleware } : {}),
      })

  let committed = false
  let raw = ''
  let emitted = ''
  let final: unknown | null = null
  let usage: AttemptOutcome['usage']
  let runError: string | null = null

  // The one classification point for every non-normal exit — a thrown error
  // mid-loop OR a post-loop RUN_ERROR that salvage couldn't recover. Pristine =>
  // plain throw, retry-eligible (withRetry reads isRetryableError on the
  // message). Committed or aborted => CommittedStreamError, non-retryable, which
  // runOneAttempt unwraps to the cause. Idempotent: an already-wrapped error
  // (the strict in-loop throw caught below) is rethrown as-is, never re-wrapped.
  const exitStreamError = (error: Error): never => {
    if (error instanceof CommittedStreamError) throw error
    if (committed || opts.signal?.aborted || controller.signal.aborted) {
      throw new CommittedStreamError(error)
    }
    throw error
  }

  try {
    for await (const chunk of stream) {
      // Any TOOL_CALL_* chunk means a tool is (about to be) executing — a
      // persisted side effect that must never be re-dialed. Commit before
      // dispatch (the TOOL_CALL_START case below only records activity).
      if (chunk.type.startsWith('TOOL_CALL')) committed = true
      switch (chunk.type) {
        case 'TEXT_MESSAGE_CONTENT': {
          // A non-empty delta is the first byte of the answer reaching the
          // caller (streamed via onTextDelta below): a meaningful commit. An
          // empty delta is an envelope tick and leaves the stream pristine.
          if (chunk.delta.length > 0) committed = true
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
          // Additive: a no-op when this call has no tools wired in. (The commit
          // above already fired for every TOOL_CALL_* chunk.)
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
            // The decoded structured answer: a meaningful commit.
            committed = true
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
            // Strict throws on a RUN_ERROR; the catch routes it through the one
            // classification point (pristine => retry, committed => stop).
            exitStreamError(new Error(message))
          }
          // forgiving: don't throw yet, the stream often carries the model's
          // raw text alongside a parse failure; record and try to salvage.
          runError = message
          break
        }
      }
    }
  } catch (err) {
    exitStreamError(err instanceof Error ? err : new Error(String(err)))
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
    // A recorded (forgiving-mode) RUN_ERROR that salvage couldn't recover.
    // Route it through the SAME classification as a thrown error: a pristine
    // RUN_ERROR is retry-eligible, a committed one is not — fixing the old
    // out-of-try `throw new Error(runError)` that re-dialed committed turns.
    exitStreamError(new Error(runError))
  }

  return { final, usage }
}

/**
 * One model call: a bounded transport re-dial (withRetry) wrapped around a
 * single stream dial (streamOnce). Only a pristine RUN_ERROR is retried (the
 * budget is `opts.transportRetries`, default 0); see streamOnce's boundary note.
 * Aborts bypass retry entirely — the shared controller's signal is threaded into
 * withRetry so an abort during backoff rejects the sleep and never re-dials.
 */
async function runOneAttempt<TContext>(opts: RunAttemptOptions<TContext>): Promise<AttemptOutcome> {
  opts.onActivity?.({ kind: 'thinking' })

  // One controller for the whole attempt: it forwards the caller's abort and is
  // reused across transport re-dials. If it has already aborted, the next dial
  // exits committed and streamOnce wraps it as CommittedStreamError, so an
  // aborted turn never re-dials.
  const controller = new AbortController()
  const forwardAbort = () => controller.abort()
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort()
    else opts.signal.addEventListener('abort', forwardAbort, { once: true })
  }

  try {
    const { result } = await withRetry(() => streamOnce(opts, controller), {
      maxRetries: opts.transportRetries ?? DEFAULT_TRANSPORT_RETRIES,
      signal: controller.signal,
    })
    return result
  } catch (err) {
    // Unwrap a committed/aborted failure back to the original error so the
    // semantic-salvage layer, usage logging, and abort propagation all see it
    // exactly as before this transport layer existed. Carry the accumulated
    // transport retryCount withRetry attached to the wrapper onto the cause so
    // the ai_usage_log error path still records the re-dials that happened.
    if (err instanceof CommittedStreamError) {
      const cause = err.cause
      const retryCount = (err as Error & { retryCount?: number }).retryCount
      if (typeof retryCount === 'number') {
        ;(cause as Error & { retryCount?: number }).retryCount = retryCount
      }
      throw cause
    }
    throw err
  } finally {
    opts.signal?.removeEventListener('abort', forwardAbort)
  }
}

export interface RunSynthesisOptions<
  TValue,
  TContext = unknown,
> extends RunAttemptOptions<TContext> {
  /** Total attempts beyond the first. Defaults to `DEFAULT_RETRIES` (one retry). */
  retries?: number
  /** Caller-owned terminal failure policy. Quinn uses 'throw' so infrastructure
   *  failure can never be published as model-authored customer text. */
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
  /** Additional caller-owned, non-sensitive attempt trace metadata. */
  deriveAttemptMetadata?: (attempt: AttemptOutcome, attemptIndex: number) => Record<string, unknown>
  /**
   * Optional semantic completion gate, run after schema decoding/salvage but
   * before an attempt may terminate the loop. Throwing rejects the final and
   * lets the ordinary retry/fallback policy handle it. Agentic callers use this
   * for objective checks against their observed tool/source ledger without
   * teaching the shared core anything about their output shape.
   */
  validateFinal?: (final: unknown, attemptIndex: number) => void | Promise<void>
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
          if (result.final !== null && options.validateFinal) {
            try {
              await options.validateFinal(result.final, attempt)
            } catch (error) {
              result.validationError = error instanceof Error ? error : new Error(String(error))
            }
          }
          return {
            result,
            retryCount: 0,
            metadata: {
              answerKind: options.deriveAnswerKind(result, attempt),
              ...options.deriveAttemptMetadata?.(result, attempt),
            },
          }
        },
        (r: AttemptOutcome) => ({
          inputTokens: r.usage?.promptTokens ?? 0,
          outputTokens: r.usage?.completionTokens ?? 0,
          totalTokens: r.usage?.totalTokens ?? 0,
        })
      )
      if (attemptOutcome.validationError) throw attemptOutcome.validationError
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
    // to the caller-provided fallback value.
    if (options.signal?.aborted) throw lastError ?? new Error('synthesis aborted')
    return { outcome: 'fallback', value: options.fallbackValue as TValue, lastError }
  }
  throw lastError ?? new Error('synthesis failed')
}
