/**
 * One-shot AG-UI turn over a `ChatClient` (TanStack AI), for the client
 * surfaces whose turn lifetime is NOT a component's — a plain async function
 * (e.g. Copilot transform). Constructs a
 * fresh client per run over `fetchServerSentEvents` (the same transport the
 * shared `useAguiTurn` hook uses), sends one message, and reports every chunk
 * through `onChunk`; the caller reads its terminal state off the standard
 * RUN_FINISHED.result / RUN_ERROR frames.
 *
 * The client library loads on the first run (see `agui-client.ts`), so the
 * composer that offers transforms does not carry it on page load.
 *
 * `stop()` aborts the run (supersede / unmount): the in-flight request is
 * abandoned and NO terminal chunk or error is surfaced for a caller-driven
 * stop, exactly like the old AbortController path — the caller owns the entry
 * state it settled before aborting.
 */
import type { StreamChunk } from '@tanstack/ai'
import type { ChatClient } from '@tanstack/ai-client'
import { aguiFetchClient, aguiThreadId } from './agui-fetch'

export interface AguiRunHandle {
  /** Abort the run. Its `done` promise still resolves; no error is surfaced. */
  stop: () => void
  /** Resolves once the run's stream ends (final, error, or abort). */
  done: Promise<void>
}

export function runAguiTurn(options: {
  url: string
  /** The user message. Surfaces that own their turn messages server-side
   *  (suggest) send an ignored placeholder; the transform sends its source text. */
  message: string
  /** Rides RunAgentInput.forwardedProps (item ref, transform kind, ...). */
  forwardedProps: Record<string, unknown>
  onChunk: (chunk: StreamChunk) => void
  /** A transport failure that never produced a RUN_ERROR chunk. An abort is the
   *  caller's own stop(), never reported here. */
  onError?: (error: Error) => void
}): AguiRunHandle {
  let stopped = false
  let client: ChatClient | null = null

  const run = async (): Promise<void> => {
    let lib: typeof import('./agui-client')
    try {
      lib = await import('./agui-client')
    } catch (error) {
      // The client chunk failed to load (offline, a deploy replaced it).
      if (!stopped) options.onError?.(error instanceof Error ? error : new Error(String(error)))
      return
    }
    if (stopped) return
    const runClient = new lib.ChatClient({
      threadId: aguiThreadId(),
      connection: lib.fetchServerSentEvents(options.url, () => ({
        body: options.forwardedProps,
        fetchClient: aguiFetchClient(),
      })),
      onChunk: options.onChunk,
      onError: (error: Error) => {
        if (error.name === 'AbortError') return
        options.onError?.(error)
      },
    })
    client = runClient
    try {
      await runClient.sendMessage(options.message)
    } finally {
      runClient.dispose()
    }
  }

  const done = run()
  return {
    stop: () => {
      stopped = true
      client?.stop()
    },
    done,
  }
}
