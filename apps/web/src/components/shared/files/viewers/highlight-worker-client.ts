/**
 * Starts the worker that highlights code off the page. Its own chunk carries
 * the grammars; the page only ever sees the highlighted lines it posts back.
 */
import type { HighlightRequest, HighlightResponse } from './highlight-lines'
import type { HighlightedLines } from './text-lines'

export interface CodeHighlighter {
  /**
   * The highlighted lines of `text` (`language` null guesses one), or null
   * when it stays plain. Rejects once the worker fails or is stopped.
   */
  highlight(text: string, language: string | null): Promise<HighlightedLines | null>
  /** Stops the worker; requests still waiting reject. */
  terminate(): void
}

export function createCodeHighlighter(): CodeHighlighter {
  const worker = new Worker(new URL('./highlight.worker.ts', import.meta.url), {
    type: 'module',
    name: 'code-highlighter',
  })
  const waiting = new Map<
    number,
    { resolve: (lines: HighlightedLines | null) => void; reject: (error: Error) => void }
  >()
  let nextId = 0
  let stopped = false

  const stop = (reason: string) => {
    stopped = true
    worker.terminate()
    for (const request of waiting.values()) request.reject(new Error(reason))
    waiting.clear()
  }

  worker.onmessage = (event: MessageEvent<HighlightResponse>) => {
    const request = waiting.get(event.data.id)
    if (!request) return
    waiting.delete(event.data.id)
    request.resolve(event.data.lines)
  }
  worker.onerror = () => stop('The highlighter failed')

  return {
    highlight(text, language) {
      if (stopped) return Promise.reject(new Error('The highlighter is stopped'))
      const id = nextId++
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject })
        const request: HighlightRequest = { id, text, language }
        worker.postMessage(request)
      })
    },
    terminate() {
      if (!stopped) stop('The highlighter is stopped')
    },
  }
}
