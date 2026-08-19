/**
 * Server-side AG-UI wire helpers for the assistant surfaces: canonical
 * lifecycle chunk factories, Quackback CUSTOM event factories, and the
 * forwarding filter that keeps engine-internal lifecycle chunks off the wire.
 *
 * WHY THE FILTER EXISTS (verified against @tanstack/ai 0.40 + ai-client 0.20):
 * in native-combined mode the chat() engine passes the adapter's
 * per-agent-loop-iteration RUN_STARTED / RUN_FINISHED(finishReason:
 * 'tool_calls') chunks through to its output stream, and the ChatClient
 * settles the active run on ANY RUN_FINISHED — no finishReason check — which
 * resolves sendMessage() and flips isLoading mid-turn. Every wire route must
 * therefore emit exactly ONE canonical RUN_STARTED ... RUN_FINISHED pair and
 * drop the engine's inner lifecycle chunks; runtime outcomes (errors, retry,
 * salvage) are synthesis-core's job, not the client's.
 */
import type { StreamChunk } from '@tanstack/ai'
import type { AssistantActivityStatus } from '@/lib/shared/conversation/types'

/** Chunk types that never reach the wire: lifecycle is re-emitted canonically
 *  by the route-level generator, and RUN_ERROR is surfaced only for
 *  post-commit failures (pre-commit failures re-dial invisibly). */
const ENGINE_LIFECYCLE_TYPES = new Set(['RUN_STARTED', 'RUN_FINISHED', 'RUN_ERROR'])

export function isWireForwardable(chunk: StreamChunk): boolean {
  return !ENGINE_LIFECYCLE_TYPES.has(chunk.type)
}

export interface WireRunIds {
  threadId: string
  runId: string
}

export function runStartedChunk({ threadId, runId }: WireRunIds): StreamChunk {
  return { type: 'RUN_STARTED', threadId, runId, timestamp: Date.now() } as StreamChunk
}

/**
 * The canonical terminal frame. `result` is AG-UI's standard slot for the
 * run's outcome (RunFinishedEvent.result, optional any): it carries the
 * turn's POST-PROCESSED surface payload (CopilotFinalPayload etc.) — the
 * enriched server result, not the raw model object (which streams separately
 * as the structured-output part). Its presence is what "finalized" means on
 * every Quackback client.
 */
export function runFinishedChunk({ threadId, runId }: WireRunIds, result?: unknown): StreamChunk {
  return {
    type: 'RUN_FINISHED',
    threadId,
    runId,
    finishReason: 'stop',
    ...(result !== undefined ? { result } : {}),
    timestamp: Date.now(),
  } as StreamChunk
}

/**
 * A terminal wire error. `code` lands beside `message` so clients keep the
 * machine-readable half the old `*.v1.error` payloads carried.
 */
export function runErrorChunk(
  { threadId, runId }: WireRunIds,
  code: string,
  message: string
): StreamChunk {
  return {
    type: 'RUN_ERROR',
    threadId,
    runId,
    code,
    message,
    timestamp: Date.now(),
  } as StreamChunk
}

/**
 * Live agent activity rides AG-UI's standard step lifecycle: one
 * STEP_STARTED per status change (`stepName` is the shared
 * AssistantActivityStatus vocabulary), STEP_FINISHED closing the previous
 * step — the standard pairing the spec asks for, in place of a bespoke
 * activity event.
 */
export function stepStartedChunk(stepName: AssistantActivityStatus): StreamChunk {
  return { type: 'STEP_STARTED', stepName, timestamp: Date.now() } as StreamChunk
}

/**
 * A snapshot of surface-owned state on AG-UI's standard STATE_SNAPSHOT event
 * (in both the AG-UI spec and TanStack's StreamChunk union). Ask AI uses it to
 * ship its PRE-SYNTHESIS source metadata (the retrieved-article display join
 * the citation dots resolve against) before the answer streams, in place of a
 * bespoke early sources event.
 */
export function stateSnapshotChunk(snapshot: unknown): StreamChunk {
  return { type: 'STATE_SNAPSHOT', snapshot, timestamp: Date.now() } as StreamChunk
}

export function stepFinishedChunk(stepName: AssistantActivityStatus): StreamChunk {
  return { type: 'STEP_FINISHED', stepName, timestamp: Date.now() } as StreamChunk
}

export function textMessageEndChunk(messageId: string): StreamChunk {
  return { type: 'TEXT_MESSAGE_END', messageId, timestamp: Date.now() } as StreamChunk
}

export function toolCallEndChunk(toolCallId: string): StreamChunk {
  return { type: 'TOOL_CALL_END', toolCallId, timestamp: Date.now() } as StreamChunk
}

/**
 * AG-UI pairing compliance (docs.ag-ui.com, Events): TEXT_MESSAGE_CONTENT must
 * be bracketed by START/END with a matching messageId, and TOOL_CALL_ARGS by
 * START/END with a matching toolCallId. The engine honors this on the happy
 * path, but a COMMITTED attempt that fails mid-message (semantic retry,
 * truncation, post-commit transport error) leaves an open triad on the wire.
 * This tracker watches forwarded chunks and synthesizes the missing END —
 * both when a terminal frame is about to close the run (`closeOpen`) and when
 * a retry attempt opens a new message over an unterminated one (`observe`).
 */
export function createPairingTracker(push: (chunk: StreamChunk) => void): {
  observe: (chunk: StreamChunk) => void
  closeOpen: () => void
} {
  let openMessageId: string | null = null
  let openToolCallId: string | null = null

  const closeOpen = (): void => {
    if (openToolCallId !== null) {
      push(toolCallEndChunk(openToolCallId))
      openToolCallId = null
    }
    if (openMessageId !== null) {
      push(textMessageEndChunk(openMessageId))
      openMessageId = null
    }
  }

  return {
    observe(chunk) {
      const c = chunk as { type: string; messageId?: string; toolCallId?: string }
      switch (c.type) {
        case 'TEXT_MESSAGE_START':
          // A new message over an unterminated one: a committed attempt was
          // superseded by a retry. Close the orphan before the new triad opens.
          closeOpen()
          openMessageId = c.messageId ?? null
          break
        case 'TEXT_MESSAGE_END':
          openMessageId = null
          break
        case 'TOOL_CALL_START':
          if (openToolCallId !== null) push(toolCallEndChunk(openToolCallId))
          openToolCallId = c.toolCallId ?? null
          break
        case 'TOOL_CALL_END':
          openToolCallId = null
          break
      }
    },
    closeOpen,
  }
}

/**
 * One thread turn extracted from an AG-UI request body, structurally the
 * runtime's AssistantThreadMessage (declared here to keep this module below
 * assistant.runtime.ts in the import graph).
 */
export interface AguiThreadMessage {
  sender: 'customer' | 'assistant'
  content: string
}

/**
 * Map an AG-UI request's message history onto the runtime's thread
 * vocabulary: the asking human's turns read as 'customer', the assistant's
 * own prior answers as 'assistant'; system/tool messages are dropped.
 *
 * An assistant answer from a structured-output surface round-trips as its RAW
 * JSON: the client's `uiMessagesToWire` flattens the structured-output part
 * into `content` as the raw JSON string, and the AG-UI request schema keeps
 * only `content` (parts are stripped server-side). Recover the prose from the
 * parsed object's `textField` so history reaches the model as the same clean
 * text the old `history[]` field carried, not a JSON envelope.
 *
 * `maxChars` truncates each turn (the old contracts REJECTED oversized
 * fields; on a wire where history is machine-accumulated, truncation of a
 * long tail is the safer failure mode — the QUESTION length is still the
 * route's own check). `maxTurns` keeps the most recent turns.
 */
export function aguiThreadMessages(
  messages: ReadonlyArray<unknown>,
  options: { maxTurns: number; maxChars: number; textField?: string }
): AguiThreadMessage[] {
  const textField = options.textField ?? 'text'
  const thread: AguiThreadMessage[] = []
  for (const raw of messages) {
    const message = raw as { role?: string; content?: unknown }
    if (message.role !== 'user' && message.role !== 'assistant') continue
    let content = typeof message.content === 'string' ? message.content : ''
    if (message.role === 'assistant' && content.startsWith('{')) {
      try {
        const parsed = JSON.parse(content) as Record<string, unknown>
        if (typeof parsed?.[textField] === 'string') content = parsed[textField] as string
      } catch {
        // Not a structured envelope after all: keep the content as-is.
      }
    }
    content = content.trim().slice(0, options.maxChars)
    if (content.length === 0) continue
    thread.push({
      sender: message.role === 'user' ? 'customer' : 'assistant',
      content,
    })
  }
  return thread.slice(-options.maxTurns)
}

/**
 * A push-to-pull bridge between synthesis-core's callback-shaped `wireSink`
 * and the AsyncIterable a route hands to `toServerSentEventsResponse`. One
 * producer (the running turn), one consumer (the SSE serializer); unbounded
 * buffering is fine at turn scale. `end()` completes the iterator after any
 * buffered chunks drain; `fail(err)` rejects the consumer once the buffer
 * drains (chunks already pushed — e.g. a terminal RUN_ERROR — still deliver).
 */
export interface ChunkQueue {
  push(chunk: StreamChunk): void
  end(): void
  fail(error: unknown): void
  stream(): AsyncGenerator<StreamChunk>
}

/**
 * Wrap a synthesis-shaped promise — one that streams model chunks through a
 * `wireSink` and resolves to a post-processed result — in the canonical AG-UI
 * run lifecycle, the counterpart of `streamAssistantTurn` for the tool-less
 * surfaces (Copilot transform). Emits RUN_STARTED, forwards the run's committed
 * model chunks, then a terminal RUN_FINISHED carrying `buildFinalPayload(result)`
 * on AG-UI's standard `result` slot — or RUN_ERROR on failure. Any
 * TEXT_MESSAGE/TOOL_CALL triad a committed-but-failed attempt left open is
 * closed before the terminal frame (createPairingTracker). Generic over the
 * result type and free of any runtime/domain import, so it stays below
 * assistant.runtime.ts in the graph.
 */
export function streamSynthesisToWire<T>(options: {
  wire: WireRunIds
  run: (wireSink: (chunk: StreamChunk) => void) => Promise<T>
  buildFinalPayload: (result: T) => unknown
  mapError: (error: unknown) => { code: string; message: string }
}): AsyncGenerator<StreamChunk> {
  const queue = createChunkQueue()
  const pairing = createPairingTracker((chunk) => queue.push(chunk))
  const wireSink = (chunk: StreamChunk): void => {
    // observe BEFORE the push so a synthetic END lands ahead of a superseding
    // START (see createPairingTracker).
    pairing.observe(chunk)
    queue.push(chunk)
  }

  queue.push(runStartedChunk(options.wire))
  void options
    .run(wireSink)
    .then((result) => {
      pairing.closeOpen()
      queue.push(runFinishedChunk(options.wire, options.buildFinalPayload(result)))
      queue.end()
    })
    .catch((error: unknown) => {
      pairing.closeOpen()
      const { code, message } = options.mapError(error)
      queue.push(runErrorChunk(options.wire, code, message))
      queue.end()
    })

  return queue.stream()
}

export function createChunkQueue(): ChunkQueue {
  const buffered: StreamChunk[] = []
  let done = false
  let failure: unknown = null
  let wake: (() => void) | null = null

  const signal = () => {
    wake?.()
    wake = null
  }

  return {
    push(chunk) {
      if (done) return
      buffered.push(chunk)
      signal()
    },
    end() {
      done = true
      signal()
    },
    fail(error) {
      failure = error ?? new Error('assistant stream failed')
      done = true
      signal()
    },
    async *stream() {
      while (true) {
        const next = buffered.shift()
        if (next !== undefined) {
          yield next
          continue
        }
        if (done) {
          if (failure !== null) throw failure
          return
        }
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    },
  }
}
