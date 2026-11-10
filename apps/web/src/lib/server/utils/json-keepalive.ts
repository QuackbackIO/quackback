/**
 * A JSON answer that may take longer than the server keeps a silent
 * connection: Bun closes one that has written nothing for 10 seconds, a
 * slow handler included. Whitespace before a JSON value is still valid JSON,
 * so a space is written every interval until the answer is ready, then the
 * answer. The status is 200 from the start, so the answer carries any
 * refusal in its body.
 */
import { SSE_KEEPALIVE_INTERVAL_MS } from '@/lib/server/domains/assistant/agui'

const SPACE = new TextEncoder().encode(' ')

export function jsonWithKeepalive(
  answer: Promise<unknown>,
  intervalMs: number = SSE_KEEPALIVE_INTERVAL_MS
): Response {
  const encoder = new TextEncoder()
  let timer: ReturnType<typeof setInterval> | null = null
  const stop = () => {
    if (timer !== null) clearInterval(timer)
    timer = null
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(() => {
        try {
          controller.enqueue(SPACE)
        } catch {
          stop()
        }
      }, intervalMs)
      void answer.then(
        (value) => {
          stop()
          try {
            controller.enqueue(encoder.encode(JSON.stringify(value)))
            controller.close()
          } catch {
            /* the reader has gone */
          }
        },
        (err: unknown) => {
          stop()
          controller.error(err)
        }
      )
    },
    cancel: stop,
  })
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
