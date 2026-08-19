/**
 * Shared fixtures for tests that exercise the assistant's AG-UI streaming
 * surfaces (the Copilot panel, the Test agent card, Ask AI): building
 * `data: <json>` SSE frames of AG-UI StreamChunks —
 * the exact wire format `toServerSentEventsResponse` emits and
 * `fetchServerSentEvents` parses — and stubbing global `fetch` with a
 * streaming `Response`. The raw byte-stream helpers are shared with the old
 * fixture module (`@/test/sse`) since the framing transport is the same.
 */
import { streamOf, mockStreamingResponse } from './sse'
import { vi } from 'vitest'

export { streamOf, mockStreamingResponse }

type Chunk = Record<string, unknown> & { type: string }

/** One AG-UI SSE frame: `data: <json>` (no `event:` line — AG-UI multiplexes
 *  on the chunk's own `type`). */
export function aguiFrame(chunk: Chunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`
}

/** A complete single-run AG-UI SSE body: the canonical lifecycle pair around
 *  `middle`, with the post-processed payload on RUN_FINISHED.result. */
export function aguiRun(options: {
  middle?: Chunk[]
  result?: unknown
  threadId?: string
  runId?: string
}): string {
  const { middle = [], result, threadId = 'thread-test', runId = 'run-test' } = options
  const frames: Chunk[] = [
    { type: 'RUN_STARTED', threadId, runId },
    ...middle,
    {
      type: 'RUN_FINISHED',
      threadId,
      runId,
      finishReason: 'stop',
      ...(result !== undefined ? { result } : {}),
    },
  ]
  return frames.map(aguiFrame).join('')
}

/** A run that fails after starting: RUN_STARTED then a coded RUN_ERROR. */
export function aguiErrorRun(options: {
  code?: string
  message: string
  middle?: Chunk[]
}): string {
  const frames: Chunk[] = [
    { type: 'RUN_STARTED', threadId: 'thread-test', runId: 'run-test' },
    ...(options.middle ?? []),
    {
      type: 'RUN_ERROR',
      code: options.code ?? 'turn_failed',
      message: options.message,
    },
  ]
  return frames.map(aguiFrame).join('')
}

/** Structured-output text deltas for `object`, split into `pieces` chunks —
 *  the raw-JSON TEXT_MESSAGE_CONTENT stream a structured turn produces. */
export function structuredDeltas(object: unknown, pieces = 3): Chunk[] {
  const json = JSON.stringify(object)
  const size = Math.ceil(json.length / pieces)
  const chunks: Chunk[] = []
  for (let i = 0; i < json.length; i += size) {
    chunks.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: json.slice(i, i + size) })
  }
  return chunks
}

/** Stub global `fetch` to resolve a fresh streaming AG-UI response per call.
 *  Returns the mock for request-body assertions; undo via
 *  `vi.unstubAllGlobals()`. */
export function stubAguiFetch(frames: string) {
  const fetchMock = vi.fn(() => Promise.resolve(mockStreamingResponse(frames)))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** The parsed JSON body of the `call`-th stubbed fetch (an AG-UI
 *  RunAgentInput: threadId/runId/messages/forwardedProps/...). */
export function aguiRequestBody(
  fetchMock: ReturnType<typeof vi.fn>,
  call = 0
): Record<string, unknown> {
  const init = fetchMock.mock.calls[call]?.[1] as { body?: string } | undefined
  return init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {}
}
