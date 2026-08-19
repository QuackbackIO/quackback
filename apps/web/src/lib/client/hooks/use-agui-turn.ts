/**
 * The AG-UI turn hook shared by the admin assistant surfaces (Copilot panel,
 * Test agent card): TanStack AI's `useChat` + `fetchServerSentEvents` as the
 * transport — the client accumulates the thread and re-sends it natively, so
 * the old hand-built `history[]` request field is gone — surfaced through the
 * turn-shaped callbacks those panels' per-turn state models are built around.
 * (Distinct from `use-assistant-turn.ts`, the widget's transient stream state
 * for Quinn replies arriving over the conversation pubsub relay.)
 *
 * What each callback maps FROM on the wire:
 * - `onTextDelta`: TEXT_MESSAGE_CONTENT deltas are the RAW structured JSON;
 *   the prose is diffed out of the partial parse's `textField` (the exact
 *   delta-diffing the server used to do before emitting `*.v1.delta`).
 * - `onActivity`: STEP_STARTED chunks (AG-UI's standard step lifecycle;
 *   `stepName` is the server-authoritative status vocabulary).
 * - `onFinal`: the terminal RUN_FINISHED's standard `result` slot — the
 *   turn's post-processed surface payload. Its presence is what "finalized"
 *   means on every Quackback client; a bare RUN_FINISHED never is.
 * - `onError`: a terminal RUN_ERROR frame, or a transport failure. HTTP
 *   non-2xx bodies keep their server-shaped message (tier limits, flag gates)
 *   via the fetch wrapper below, exactly as `extractHttpErrorMessage` did.
 */
import { useCallback, useMemo, useRef } from 'react'
import { useChat, fetchServerSentEvents } from '@tanstack/ai-react'
import { parsePartialJSON, type StreamChunk } from '@tanstack/ai'
import { extractHttpErrorMessage } from '@/lib/client/utils/http-error'
import type { AssistantActivityStatus } from '@/lib/shared/conversation/types'

const ACTIVITY_STATUSES: ReadonlySet<AssistantActivityStatus> = new Set([
  'thinking',
  'searching_kb',
  'reviewing_conversation',
])

export interface AguiTurnHandlers {
  /** Progressive prose: the newly-grown fragment plus the full text so far. */
  onTextDelta?: (delta: string, fullText: string) => void
  onActivity?: (status: AssistantActivityStatus) => void
  /** The turn's post-processed payload (RUN_FINISHED.result) — the surface's
   *  own final type; the caller casts. */
  onFinal: (payload: unknown) => void
  onError: (message: string) => void
  /** The stream ended (after a final, an error, or a truncation/abort). */
  onStreamEnd?: () => void
}

export interface StartAguiTurnOptions {
  question: string
  /** Rides RunAgentInput.forwardedProps (item ref, source filter, ...). */
  forwardedProps?: Record<string, unknown>
  handlers: AguiTurnHandlers
}

/** Non-2xx responses carry the API error envelope (tier limits, flag gates);
 *  surface that message on the thrown error so `onError` shows the server's
 *  words, not a generic transport failure. */
const assistantFetch: typeof fetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await fetch(input, init)
    if (!res.ok) throw new Error(await extractHttpErrorMessage(res))
    return res
  },
  { preconnect: fetch.preconnect }
)

export function useAguiTurn(options: { url: string; textField?: string }) {
  const textField = options.textField ?? 'text'
  const handlersRef = useRef<AguiTurnHandlers | null>(null)
  const forwardedRef = useRef<Record<string, unknown>>({})
  // Prose accumulator, reset per run; `terminal` dedupes onFinal/onError so a
  // stream that errors after a final (or vice versa) reports exactly once.
  const runRef = useRef({ raw: '', emitted: '', terminal: false })

  const connection = useMemo(
    () =>
      fetchServerSentEvents(options.url, () => ({
        body: forwardedRef.current,
        fetchClient: assistantFetch,
      })),
    [options.url]
  )

  const chat = useChat({
    connection,
    onChunk: (raw: StreamChunk) => {
      const handlers = handlersRef.current
      if (!handlers) return
      const chunk = raw as {
        type: string
        delta?: unknown
        name?: unknown
        stepName?: unknown
        result?: unknown
        message?: unknown
      }
      switch (chunk.type) {
        case 'RUN_STARTED':
          runRef.current = { raw: '', emitted: '', terminal: false }
          break
        case 'CUSTOM':
          // A tool-using turn runs its agent loop unconstrained and emits the
          // structured JSON in a separate finalization stream (see
          // synthesis-core's adapter note); structured-output.start marks that
          // boundary. Text before it is loop prose — reset so the JSON
          // finalization parses cleanly from its first byte.
          if (chunk.name === 'structured-output.start') {
            runRef.current.raw = ''
            runRef.current.emitted = ''
          }
          break
        case 'TEXT_MESSAGE_CONTENT': {
          if (!handlers.onTextDelta || typeof chunk.delta !== 'string') break
          const run = runRef.current
          run.raw += chunk.delta
          const partial = parsePartialJSON(run.raw) as Record<string, unknown> | undefined
          const text =
            typeof partial?.[textField] === 'string' ? (partial[textField] as string) : ''
          if (text.length > run.emitted.length && text.startsWith(run.emitted)) {
            const delta = text.slice(run.emitted.length)
            run.emitted = text
            handlers.onTextDelta(delta, text)
          }
          break
        }
        case 'STEP_STARTED': {
          if (
            typeof chunk.stepName === 'string' &&
            ACTIVITY_STATUSES.has(chunk.stepName as AssistantActivityStatus)
          ) {
            handlers.onActivity?.(chunk.stepName as AssistantActivityStatus)
          }
          break
        }
        case 'RUN_FINISHED': {
          // AG-UI's standard result slot; a RUN_FINISHED without one (the
          // engine's own, or a non-final wire) does not finalize the turn.
          if (chunk.result !== undefined && !runRef.current.terminal) {
            runRef.current.terminal = true
            handlers.onFinal(chunk.result)
          }
          break
        }
        case 'RUN_ERROR': {
          if (runRef.current.terminal) break
          runRef.current.terminal = true
          handlers.onError(
            typeof chunk.message === 'string' && chunk.message.length > 0
              ? chunk.message
              : 'The assistant could not complete this turn.'
          )
          break
        }
      }
    },
    onError: (error: Error) => {
      // Transport failures (HTTP error, dropped stream) that never produced a
      // RUN_ERROR frame. An abort is the caller's own stop(), not an error.
      if (runRef.current.terminal) return
      if (error.name === 'AbortError') return
      runRef.current.terminal = true
      handlersRef.current?.onError(error.message)
    },
  })

  const { sendMessage, stop, clear, setMessages, messages, isLoading } = chat

  const start = useCallback(
    async ({ question, forwardedProps, handlers }: StartAguiTurnOptions): Promise<void> => {
      handlersRef.current = handlers
      forwardedRef.current = forwardedProps ?? {}
      runRef.current = { raw: '', emitted: '', terminal: false }
      try {
        await sendMessage(question)
      } finally {
        handlers.onStreamEnd?.()
      }
    },
    [sendMessage]
  )

  /** Rewind the thread to just before the `turnIndex`-th user message — the
   *  retry affordance (re-ask an earlier question with only the history that
   *  preceded it). Counts user messages rather than assuming user/assistant
   *  pairs, so turns that produced no assistant message (suppressed, errored)
   *  can't skew the mapping. */
  const rewindToTurn = useCallback(
    (turnIndex: number): void => {
      let userSeen = 0
      for (let i = 0; i < messages.length; i++) {
        if (messages[i].role === 'user') {
          if (userSeen === turnIndex) {
            setMessages(messages.slice(0, i))
            return
          }
          userSeen++
        }
      }
    },
    [messages, setMessages]
  )

  return { start, stop, clear, rewindToTurn, isLoading }
}
