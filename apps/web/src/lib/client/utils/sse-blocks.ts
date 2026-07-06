/**
 * Framing-only SSE block parsing, shared by every client that consumes one of
 * the app's versioned `*.v1.*` SSE contracts (kb-ask, the assistant sandbox,
 * the copilot sidebar): split a response body into "\n\n"-delimited blocks,
 * then parse an individual block's `event:`/`data:` lines. Callers own
 * dispatch — this module only knows about framing, never a specific event
 * vocabulary. Lives under lib/ (not components/) so non-component client code
 * — e.g. `use-sse-turn.ts` — can depend on it directly; `ask-ai.tsx`
 * re-exports both names for its existing importers.
 */

/** Parse one SSE block ("event: ...\ndata: ...") into an event, or null. */
export function parseAskAiSseBlock(block: string): { event: string; data: unknown } | null {
  const eventMatch = /^event: (.+)$/m.exec(block)
  const dataMatch = /^data: (.+)$/m.exec(block)
  if (!eventMatch || !dataMatch) return null
  try {
    return { event: eventMatch[1].trim(), data: JSON.parse(dataMatch[1]) }
  } catch {
    return null
  }
}

/**
 * Read an SSE body to completion, invoking `onBlock` for each "\n\n"-delimited
 * block (including a final unterminated one). Framing only — callers parse and
 * dispatch. Shared by the kb-ask reader and the admin assistant surfaces so the
 * chunk-splitting lives in one place.
 */
export async function readSseBlocks(
  body: ReadableStream<Uint8Array>,
  onBlock: (block: string) => void
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep = buffer.indexOf('\n\n')
    while (sep !== -1) {
      onBlock(buffer.slice(0, sep))
      buffer = buffer.slice(sep + 2)
      sep = buffer.indexOf('\n\n')
    }
  }
  if (buffer.trim()) onBlock(buffer)
}
