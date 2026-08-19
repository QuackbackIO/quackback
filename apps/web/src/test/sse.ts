/**
 * Raw byte-stream fixtures for tests that exercise streaming HTTP responses:
 * wrapping text in a one-shot `ReadableStream` and stubbing a streaming
 * `Response`. The AG-UI frame builders that use these live in `@/test/agui`.
 */

/** A byte stream of `text` that then closes — the shape a completed SSE
 *  response body reads as. Pass an array to deliver multiple chunks (e.g. to
 *  prove frame buffering across awkward chunk boundaries). */
export function streamOf(text: string | string[]): ReadableStream<Uint8Array> {
  const chunks = Array.isArray(text) ? text : [text]
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

/** An `ok` streaming `Response` whose body replays `frames` once. Build a
 *  FRESH one per fetch call (the AG-UI stub in @/test/agui does this) — a stream can only be
 *  consumed once. */
export function mockStreamingResponse(frames: string): Response {
  return { ok: true, body: streamOf(frames) } as Response
}
