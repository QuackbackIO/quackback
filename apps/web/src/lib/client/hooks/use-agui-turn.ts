/**
 * The AG-UI turn hook shared by the admin assistant surfaces (Copilot panel,
 * Ask AI): one TanStack AI `ChatClient` per mounted hook over
 * `fetchServerSentEvents` — the client accumulates the thread and re-sends it natively, so
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
 *   via `aguiFetchClient`, which rewrites the envelope into a RUN_ERROR frame.
 *
 * The client library loads on the first `start()` (see `agui-client.ts`), not
 * with the panel, so the inbox does not carry it on page load. That is why
 * this drives `ChatClient` directly rather than through ai-react's `useChat`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { StreamChunk } from '@tanstack/ai'
import type { ChatClient } from '@tanstack/ai-client'
import { aguiFetchClient, aguiThreadId } from '@/lib/client/utils/agui-fetch'
import type { AguiClientModule } from '@/lib/client/utils/agui-client'
import { GENERIC_ERROR } from '@/lib/client/utils/http-error'
import { unplannedErrorText } from '@/lib/client/error-text'
import { useStableCallback } from '@/lib/client/hooks/use-stable-callback'
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

/** Non-2xx envelopes become a synthetic RUN_ERROR SSE frame (same wrapper
 *  `runAguiTurn` uses). Throwing from fetchClient is wrong on AI 0.52+: the
 *  adapter wraps any rejection as StreamReadError ("Stream response body
 *  read failed") and the server's message is lost. */
const assistantFetch = aguiFetchClient()

export function useAguiTurn(options: { url: string; textField?: string }) {
  const textField = options.textField ?? 'text'
  const handlersRef = useRef<AguiTurnHandlers | null>(null)
  const forwardedRef = useRef<Record<string, unknown>>({})
  // Prose accumulator, reset per run; `terminal` dedupes onFinal/onError so a
  // stream that errors after a final (or vice versa) reports exactly once.
  const runRef = useRef({ raw: '', emitted: '', terminal: false })

  // One thread per mounted hook; it re-sends its own history every turn.
  const [threadId] = useState(aguiThreadId)
  const clientRef = useRef<{ url: string; client: ChatClient } | null>(null)
  const libRef = useRef<AguiClientModule | null>(null)
  // Bumped by stop(): a start() still waiting for the client chunk must not send.
  const stopsRef = useRef(0)

  const onChunk = useStableCallback((raw: StreamChunk): void => {
    const handlers = handlersRef.current
    const lib = libRef.current
    if (!handlers || !lib) return
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
        const partial = lib.parsePartialJSON(run.raw) as Record<string, unknown> | undefined
        const text = typeof partial?.[textField] === 'string' ? (partial[textField] as string) : ''
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
  })

  const onError = useStableCallback((error: Error): void => {
    // Transport failures (HTTP error, dropped stream) that never produced a
    // RUN_ERROR frame. An abort is the caller's own stop(), not an error.
    if (runRef.current.terminal) return
    if (error.name === 'AbortError') return
    runRef.current.terminal = true
    // Its message is the browser's or the stream library's, never ours.
    handlersRef.current?.onError(unplannedErrorText(error, GENERIC_ERROR))
  })

  const url = options.url
  const clientFor = useCallback(
    (lib: AguiClientModule): ChatClient => {
      const current = clientRef.current
      if (current?.url === url) return current.client
      current?.client.dispose()
      const client = new lib.ChatClient({
        threadId,
        connection: lib.fetchServerSentEvents(url, () => ({
          body: forwardedRef.current,
          fetchClient: assistantFetch,
        })),
        onChunk,
        onError,
      })
      clientRef.current = { url, client }
      return client
    },
    [threadId, url, onChunk, onError]
  )

  useEffect(
    () => () => {
      clientRef.current?.client.dispose()
      clientRef.current = null
    },
    []
  )

  const start = useCallback(
    async ({ question, forwardedProps, handlers }: StartAguiTurnOptions): Promise<void> => {
      handlersRef.current = handlers
      forwardedRef.current = forwardedProps ?? {}
      runRef.current = { raw: '', emitted: '', terminal: false }
      const stops = stopsRef.current
      try {
        let lib = libRef.current
        if (!lib) {
          try {
            lib = await import('@/lib/client/utils/agui-client')
          } catch (error) {
            // The client chunk failed to load (offline, a deploy replaced it).
            if (stops === stopsRef.current) {
              onError(error instanceof Error ? error : new Error(String(error)))
            }
            return
          }
          libRef.current = lib
        }
        if (stops !== stopsRef.current) return
        await clientFor(lib).sendMessage(question)
      } finally {
        handlers.onStreamEnd?.()
      }
    },
    [clientFor, onError]
  )

  const stop = useCallback((): void => {
    stopsRef.current += 1
    clientRef.current?.client.stop()
  }, [])

  const clear = useCallback((): void => {
    clientRef.current?.client.clear()
  }, [])

  /** Rewind the thread to just before the `turnIndex`-th user message — the
   *  retry affordance (re-ask an earlier question with only the history that
   *  preceded it). Counts user messages rather than assuming user/assistant
   *  pairs, so turns that produced no assistant message (suppressed, errored)
   *  can't skew the mapping. */
  const rewindToTurn = useCallback((turnIndex: number): void => {
    const client = clientRef.current?.client
    if (!client) return
    const messages = client.getMessages()
    let userSeen = 0
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === 'user') {
        if (userSeen === turnIndex) {
          client.setMessagesManually(messages.slice(0, i))
          return
        }
        userSeen++
      }
    }
  }, [])

  return { start, stop, clear, rewindToTurn }
}
