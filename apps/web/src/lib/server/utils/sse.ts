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
  /**
   * Write a comment ping and report whether the consumer is still taking data.
   *
   * `unconsumed` means the previous write is still sitting in the stream — the
   * reader is gone or stuck, which is how an abandoned tab is detected.
   */
  heartbeatPing: () => 'ok' | 'closed' | 'unconsumed'
  /** Whether the stream is closed or the consumer is gone. */
  isClosed: () => boolean
  /** Stop sending and close the stream. Safe to call more than once. */
  close: () => void
}

/**
 * How often an otherwise silent stream writes a comment line.
 *
 * Servers and proxies close a connection that carries no bytes for a while:
 * Bun's `idleTimeout` defaults to 10 seconds, and it counts a streamed response
 * that has stopped writing as idle. The heartbeat below runs on a longer cycle
 * because each beat also writes presence, so the keepalive is separate and
 * costs one comment line and nothing else.
 */
export const SSE_STREAM_KEEPALIVE_MS = 5_000

/**
 * How long a just-written keepalive may wait unread before it counts against
 * the reader. The keepalive and the heartbeat run on separate timers, so a
 * beat can land after a keepalive is written and before the server has pulled
 * it; that frame says nothing about whether anyone is reading. A reader that
 * is really gone is still caught on the next beat, because keepalives stop
 * once the queue holds anything.
 */
const KEEPALIVE_GRACE_MS = 1_000

export function createSseStream(
  options: { onCancel?: () => void | Promise<void>; keepAliveMs?: number } = {}
): SseStream {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let closed = false
  let keepAlive: ReturnType<typeof setInterval> | null = null
  let lastKeepAliveAt = 0
  const stopKeepAlive = () => {
    if (keepAlive) clearInterval(keepAlive)
    keepAlive = null
  }

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
      const every = options.keepAliveMs ?? SSE_STREAM_KEEPALIVE_MS
      if (every > 0) {
        keepAlive = setInterval(() => {
          if (closed) return stopKeepAlive()
          // Only into an empty queue: a keepalive must never be what makes a
          // live consumer look behind to the heartbeat's unconsumed check.
          const size = controller.desiredSize
          if (size === null || size <= 0) return
          try {
            controller.enqueue(encoder.encode(': keepalive\n\n'))
            lastKeepAliveAt = Date.now()
          } catch {
            closed = true
            stopKeepAlive()
          }
        }, every)
        keepAlive.unref?.()
      }
    },
    async cancel() {
      closed = true
      stopKeepAlive()
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
    heartbeatPing: () => {
      if (closed) return 'closed'
      const size = controller?.desiredSize
      if (size !== undefined && size !== null && size <= 0) {
        return Date.now() - lastKeepAliveAt < KEEPALIVE_GRACE_MS ? 'ok' : 'unconsumed'
      }
      try {
        controller.enqueue(encoder.encode(': ping\n\n'))
        return 'ok'
      } catch {
        closed = true
        return 'closed'
      }
    },
    isClosed: () => closed,
    close: () => {
      closed = true
      stopKeepAlive()
      try {
        controller.close()
      } catch {
        /* already closed */
      }
    },
  }
}
