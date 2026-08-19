/**
 * Server-sent-events plumbing shared by the streaming routes: one writer
 * owning the encoder, `event:`/`data:` framing, the closed guard (a failed
 * enqueue marks the consumer gone and silences further sends), and an
 * idempotent close.
 */

export const SSE_RESPONSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  // Disable proxy buffering so events flush immediately.
  'X-Accel-Buffering': 'no',
} as const

export interface SseStream {
  stream: ReadableStream<Uint8Array>
  /** Send one named event with a JSON payload, optionally id-tagged (SSE ids
   *  let clients resume via Last-Event-ID). No-op once closed. */
  send: (event: string, data: unknown, id?: string) => void
  /** Send a raw, pre-framed chunk (comments, retry hints, prebuilt frames). */
  sendRaw: (chunk: string) => void
  /** Whether the stream is closed or the consumer is gone. */
  isClosed: () => boolean
  /** Stop sending and close the stream. Safe to call more than once. */
  close: () => void
}

export function createSseStream(
  options: { onCancel?: () => void | Promise<void> } = {}
): SseStream {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
    async cancel() {
      closed = true
      await options.onCancel?.()
    },
  })

  const sendRaw = (chunk: string) => {
    if (closed) return
    try {
      controller.enqueue(encoder.encode(chunk))
    } catch {
      closed = true
    }
  }

  return {
    stream,
    sendRaw,
    send: (event, data, id) =>
      sendRaw(`${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    isClosed: () => closed,
    close: () => {
      closed = true
      try {
        controller.close()
      } catch {
        /* already closed */
      }
    },
  }
}
