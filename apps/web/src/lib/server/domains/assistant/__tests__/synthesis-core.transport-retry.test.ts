/**
 * Tests for the transport-retry layer in synthesis-core's runOneAttempt.
 *
 * REAL ADAPTER BEHAVIOR: the vendored @tanstack/ai-openai compatible adapter
 * never throws out of `for await` — every transport failure (dial-time and
 * mid-stream alike) surfaces as a RUN_STARTED then RUN_ERROR chunk pair. So
 * retryability turns on whether anything MEANINGFUL was consumed before the
 * RUN_ERROR, not on where the failure happened:
 *   - pristine (only envelope chunks — RUN_STARTED / TEXT_MESSAGE_START / an
 *     empty text delta — before the RUN_ERROR) => re-dial is safe, classified
 *     by isRetryableError on the RUN_ERROR message;
 *   - committed (a non-empty text delta reached the caller, a TOOL_CALL_* chunk
 *     fired, or the structured-output CUSTOM chunk landed) => never re-dial, a
 *     re-dial could double-emit text or double-execute a tool.
 * The transport budget is per-caller (`transportRetries`, default 0); the
 * semantic-salvage retry (`retries`) is a separate layer, pinned to 0 here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'

const mockChat = vi.fn()
const mockAdapterFactory = vi.fn((..._args: unknown[]) => ({ kind: 'text' }))

const mockConfig = vi.hoisted(() => ({
  openaiApiKey: 'test-key' as string | undefined,
  openaiBaseUrl: 'http://localhost:9999/v1' as string | undefined,
}))

vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

vi.mock('@tanstack/ai', () => ({
  chat: (...args: unknown[]) => mockChat(...args),
  parsePartialJSON: (s: string) => {
    try {
      return JSON.parse(s)
    } catch {
      return undefined
    }
  },
}))

vi.mock('@tanstack/ai-openai/compatible', () => ({
  openaiCompatibleText: (...args: unknown[]) => mockAdapterFactory(...args),
}))

vi.mock('@/lib/server/domains/ai/config', () => ({
  stripCodeFences: (s: string) => s,
  structuredOutputProviderOptions: () => ({}),
}))

const mockWithUsageLogging = vi.fn()
vi.mock('@/lib/server/domains/ai/usage-log', () => ({
  withUsageLogging: (...args: unknown[]) => mockWithUsageLogging(...args),
}))

import { runSynthesis, type RunSynthesisOptions } from '../synthesis-core'

/** A RUN_STARTED envelope chunk, then a RUN_ERROR: the real adapter's shape for
 *  a dial-time transport failure. Pristine — nothing meaningful was consumed. */
function runStartedThenError(message: string) {
  return (async function* () {
    yield { type: 'RUN_STARTED' }
    yield { type: 'RUN_ERROR', message }
  })()
}

/** RUN_STARTED, an empty text delta (an envelope tick), then RUN_ERROR: still
 *  pristine — an empty delta does not commit. */
function emptyTextThenError(message: string) {
  return (async function* () {
    yield { type: 'RUN_STARTED' }
    yield { type: 'TEXT_MESSAGE_CONTENT', delta: '' }
    yield { type: 'RUN_ERROR', message }
  })()
}

/** RUN_STARTED, a non-empty text delta (streamed to the caller), then RUN_ERROR:
 *  COMMITTED — re-dialing would double-emit. */
function textThenError(message: string) {
  return (async function* () {
    yield { type: 'RUN_STARTED' }
    yield { type: 'TEXT_MESSAGE_CONTENT', delta: '{"text":"partial' }
    yield { type: 'RUN_ERROR', message }
  })()
}

/** RUN_STARTED, a TOOL_CALL_START (a tool is executing), then RUN_ERROR:
 *  COMMITTED — re-dialing would double-execute the tool (the double-side-effect
 *  path the old out-of-try `throw` regressed). */
function toolThenError(message: string) {
  return (async function* () {
    yield { type: 'RUN_STARTED' }
    yield { type: 'TOOL_CALL_START', toolCallName: 'search_knowledge' }
    yield { type: 'RUN_ERROR', message }
  })()
}

/** Stream that throws on first pull — a defensive path (the real adapter never
 *  does this, but a thrown iterator must still classify as pristine). */
function throwingStream(err: Error): AsyncGenerator<unknown> {
  // eslint-disable-next-line require-yield -- models an iterator that rejects before yielding
  return (async function* () {
    throw err
  })()
}

/** Stream that produces a valid structured object. */
function goodStream(text: string) {
  const object = { text }
  return (async function* () {
    yield { type: 'RUN_STARTED' }
    yield { type: 'TEXT_MESSAGE_CONTENT', delta: JSON.stringify(object) }
    yield { type: 'CUSTOM', name: 'structured-output.complete', value: { object } }
    yield { type: 'RUN_FINISHED', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }
  })()
}

function baseOptions(
  overrides: Partial<RunSynthesisOptions<string>> = {}
): RunSynthesisOptions<string> {
  return {
    model: 'test-model',
    systemPrompts: ['sys'],
    messages: [{ role: 'user', content: 'q' }],
    outputSchema: z.object({ text: z.string() }),
    deltaField: 'text',
    salvageMode: 'forgiving',
    salvage: () => null,
    onFailure: 'throw',
    retries: 0, // isolate transport retry from semantic-salvage retry
    transportRetries: 2, // opt into re-dials for most cases; overridden per test
    usageLogParams: { pipelineStep: 'assistant', callType: 'chat_completion', model: 'test-model' },
    deriveAnswerKind: () => 'answered',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  mockConfig.openaiApiKey = 'test-key'
  mockConfig.openaiBaseUrl = 'http://localhost:9999/v1'
  mockWithUsageLogging.mockImplementation(
    async (
      _params: unknown,
      fn: () => Promise<{ result: unknown; retryCount: number }>,
      extract: (result: unknown) => unknown
    ) => {
      const { result } = await fn()
      extract(result)
      return result
    }
  )
})

afterEach(() => {
  vi.useRealTimers()
})

/** Drive a promise to completion while flushing the retry-backoff timers. */
async function settle<T>(p: Promise<T>): Promise<T> {
  // Attach handlers synchronously so a rejection during the timer flush is
  // never briefly "unhandled" (which vitest fails the run on).
  const captured = p.then(
    (v) => ({ ok: true as const, v }),
    (e) => ({ ok: false as const, e })
  )
  await vi.runAllTimersAsync()
  const r = await captured
  if (r.ok) return r.v
  throw r.e
}

describe('transport retry — pristine RUN_ERROR (real adapter shape)', () => {
  it('re-dials a pristine RUN_STARTED→RUN_ERROR (429) and succeeds', async () => {
    mockChat
      .mockReturnValueOnce(runStartedThenError('429 Too Many Requests'))
      .mockReturnValueOnce(goodStream('recovered'))

    const result = await settle(runSynthesis(baseOptions()))

    expect(result).toEqual({
      outcome: 'success',
      final: { text: 'recovered' },
      usage: expect.anything(),
    })
    expect(mockChat).toHaveBeenCalledTimes(2)
  })

  it('retries a pristine 5xx RUN_ERROR', async () => {
    mockChat
      .mockReturnValueOnce(runStartedThenError('503 Service Unavailable'))
      .mockReturnValueOnce(goodStream('ok'))

    const result = await settle(runSynthesis(baseOptions()))
    expect((result as { final: unknown }).final).toEqual({ text: 'ok' })
    expect(mockChat).toHaveBeenCalledTimes(2)
  })

  it('treats an empty text delta as still pristine and retries', async () => {
    mockChat
      .mockReturnValueOnce(emptyTextThenError('429 rate limit'))
      .mockReturnValueOnce(goodStream('ok'))

    const result = await settle(runSynthesis(baseOptions()))
    expect((result as { final: unknown }).final).toEqual({ text: 'ok' })
    expect(mockChat).toHaveBeenCalledTimes(2)
  })

  it('retries a pristine RUN_ERROR in strict mode too', async () => {
    mockChat
      .mockReturnValueOnce(runStartedThenError('429 rate limit'))
      .mockReturnValueOnce(goodStream('ok'))

    const result = await settle(runSynthesis(baseOptions({ salvageMode: 'strict' })))
    expect((result as { final: unknown }).final).toEqual({ text: 'ok' })
    expect(mockChat).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry a non-retryable pristine RUN_ERROR (4xx)', async () => {
    mockChat.mockReturnValueOnce(runStartedThenError('400 invalid model ID'))

    await expect(settle(runSynthesis(baseOptions()))).rejects.toThrow('400 invalid model ID')
    expect(mockChat).toHaveBeenCalledTimes(1)
  })

  it('exhausts the transport budget then surfaces the last RUN_ERROR', async () => {
    mockChat.mockImplementation(() => runStartedThenError('429 rate limit'))

    await expect(settle(runSynthesis(baseOptions()))).rejects.toThrow('429 rate limit')
    // Initial dial + transportRetries (2) re-dials.
    expect(mockChat).toHaveBeenCalledTimes(3)
  })

  it('defaults transportRetries to 0 — a pristine RUN_ERROR is NOT re-dialed by default', async () => {
    mockChat.mockReturnValueOnce(runStartedThenError('429 rate limit'))

    // transportRetries omitted => default 0 (the latency-sensitive inline default).
    await expect(
      settle(runSynthesis(baseOptions({ transportRetries: undefined })))
    ).rejects.toThrow('429 rate limit')
    expect(mockChat).toHaveBeenCalledTimes(1)
  })

  it('still classifies a defensively-thrown pristine iterator as retryable', async () => {
    mockChat
      .mockReturnValueOnce(throwingStream(new Error('ECONNRESET')))
      .mockReturnValueOnce(goodStream('ok'))

    const result = await settle(runSynthesis(baseOptions()))
    expect((result as { final: unknown }).final).toEqual({ text: 'ok' })
    expect(mockChat).toHaveBeenCalledTimes(2)
  })
})

describe('transport retry — committed RUN_ERROR is never re-dialed', () => {
  it('does NOT retry after a tool call fired (the double-execution path)', async () => {
    // TOOL_CALL_START committed the stream: a re-dial would double-execute the
    // tool. Forgiving mode, salvage returns null — the original error must
    // surface, and there must be exactly one dial.
    mockChat.mockReturnValueOnce(toolThenError('provider exploded'))

    await expect(settle(runSynthesis(baseOptions()))).rejects.toThrow('provider exploded')
    expect(mockChat).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry after text streamed to the caller (double-emit)', async () => {
    mockChat.mockReturnValueOnce(textThenError('socket hang up mid-stream'))

    await expect(settle(runSynthesis(baseOptions()))).rejects.toThrow('socket hang up mid-stream')
    expect(mockChat).toHaveBeenCalledTimes(1)
  })

  it('surfaces the original RUN_ERROR (not the CommittedStreamError wrapper)', async () => {
    mockChat.mockImplementation(() => toolThenError('provider exploded'))

    let caught: Error | null = null
    try {
      await settle(runSynthesis(baseOptions()))
    } catch (err) {
      caught = err as Error
    }
    expect(caught?.message).toBe('provider exploded')
    expect(caught?.name).not.toBe('CommittedStreamError')
  })

  it('a committed RUN_ERROR that salvage recovers returns the answer (no retry, no throw)', async () => {
    // Text streamed, then a RUN_ERROR — but forgiving salvage recovers a valid
    // object from the raw text. Committed, so no re-dial; a usable final wins.
    mockChat.mockReturnValueOnce(textThenError('provider exploded'))

    const result = await settle(
      runSynthesis(baseOptions({ salvage: () => ({ text: 'salvaged' }) }))
    )
    expect((result as { final: unknown }).final).toEqual({ text: 'salvaged' })
    expect(mockChat).toHaveBeenCalledTimes(1)
  })
})

describe('transport retry — aborts', () => {
  it('an abort before the dial bypasses retry entirely', async () => {
    const controller = new AbortController()
    controller.abort()
    mockChat.mockImplementation(() => throwingStream(new Error('The operation was aborted')))

    await expect(settle(runSynthesis(baseOptions({ signal: controller.signal })))).rejects.toThrow()
    expect(mockChat).toHaveBeenCalledTimes(1)
  })

  it('aborting during backoff stops the re-dial promptly', async () => {
    const controller = new AbortController()
    // First dial: pristine retryable RUN_ERROR → schedules a backoff sleep.
    // The abort fires while that sleep is pending, so the sleep rejects and no
    // second dial happens.
    mockChat.mockReturnValueOnce(runStartedThenError('429 rate limit'))

    const p = runSynthesis(baseOptions({ signal: controller.signal }))
    const captured = p.then(
      (v) => ({ ok: true as const, v }),
      (e) => ({ ok: false as const, e })
    )
    // Let the first dial settle and enter the backoff sleep, then abort.
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await vi.runAllTimersAsync()

    const r = await captured
    expect(r.ok).toBe(false)
    // Only the first dial ran — the backoff was aborted before a re-dial.
    expect(mockChat).toHaveBeenCalledTimes(1)
  })
})
