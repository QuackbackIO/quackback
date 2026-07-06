import { useCallback, useRef } from 'react'
import { parseAskAiSseBlock, readSseBlocks } from '@/lib/client/utils/sse-blocks'

/**
 * One call to `start()`: a POST body plus the surface's own reaction to every
 * outcome the shared skeleton can reach. The hook owns the fetch/abort/SSE
 * plumbing; everything about what a given turn MEANS (which events it cares
 * about, how an HTTP error becomes user-facing text, what "the stream ended"
 * implies) stays with the caller.
 */
export interface SseTurnRequest {
  /** The endpoint to POST the turn to. */
  url: string
  /** JSON-serializable request body. */
  body: unknown
  /** Dispatch table keyed by SSE event name (typically a `*_EVENTS` constant),
   *  each handler receiving that event's already-JSON-parsed `data`. */
  handlers: Record<string, (data: unknown) => void>
  /** Called instead of reading the body when the response isn't ok or carries
   *  no body — the caller derives its own error text/state from `res`. */
  onHttpError: (res: Response) => void | Promise<void>
  /** Called once the SSE body has been read to completion, whether or not a
   *  terminal event ever arrived. */
  onStreamEnd?: () => void
  /** Called when the request was aborted via `stop()` — never for a genuine
   *  network/parse failure. */
  onAbort?: () => void
  /** Called on any other thrown error (network failure, etc). */
  onError: (err: unknown) => void
}

/**
 * The one-shot POST+SSE streaming skeleton shared by the admin assistant
 * surfaces (the Copilot sidebar and the assistant test sandbox): an
 * AbortController-guarded fetch, `res.ok`/body checks, then reading the body
 * as versioned SSE blocks via `readSseBlocks`/`parseAskAiSseBlock` and
 * dispatching each block by event name. Returns `start`/`stop`; a fresh
 * `start()` call replaces whatever `AbortController` was in flight.
 */
export function useSseTurn() {
  const abortRef = useRef<AbortController | null>(null)

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const start = useCallback(async (request: SseTurnRequest): Promise<void> => {
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        await request.onHttpError(res)
        return
      }

      await readSseBlocks(res.body, (block) => {
        const parsed = parseAskAiSseBlock(block)
        if (!parsed) return
        request.handlers[parsed.event]?.(parsed.data)
      })
      request.onStreamEnd?.()
    } catch (err) {
      if (controller.signal.aborted) {
        request.onAbort?.()
      } else {
        request.onError(err)
      }
    } finally {
      abortRef.current = null
    }
  }, [])

  return { start, stop }
}
