/**
 * Tests for synthesis-core's AG-UI wire forwarding (`wireSink`).
 *
 * The invariants under test:
 *  1. BUFFER-UNTIL-COMMIT — nothing reaches the wire before the attempt
 *     commits; the committing chunk flushes the buffer (in order) and is
 *     itself forwarded. A pristine RUN_ERROR re-dial is therefore invisible:
 *     the discarded per-dial buffer is the guarantee.
 *  2. LIFECYCLE FILTER — engine RUN_STARTED / RUN_FINISHED / RUN_ERROR chunks
 *     never reach the wire (the route-level generator emits one canonical
 *     pair; ChatClient settles the run on ANY RUN_FINISHED, so a mid-loop one
 *     leaking through would end the client turn early).
 *  3. Default-off — with no wireSink the behavior is unchanged (covered by the
 *     entire existing suite; here we just assert no crash when absent).
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

type Chunk = Record<string, unknown> & { type: string }

function streamOf(chunks: Chunk[]) {
  return (async function* () {
    for (const c of chunks) yield c
  })()
}

const GOOD_OBJECT = { text: 'hello world' }
const GOOD_CHUNKS: Chunk[] = [
  { type: 'RUN_STARTED' },
  { type: 'TEXT_MESSAGE_START', messageId: 'm1' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: JSON.stringify(GOOD_OBJECT) },
  { type: 'TOOL_CALL_START', toolCallName: 'search', toolCallId: 'c1' },
  { type: 'TOOL_CALL_END', toolCallId: 'c1' },
  { type: 'CUSTOM', name: 'structured-output.complete', value: { object: GOOD_OBJECT } },
  { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
  { type: 'RUN_FINISHED', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } },
]

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
    retries: 0,
    transportRetries: 2,
    usageLogParams: { pipelineStep: 'assistant', callType: 'chat_completion', model: 'test-model' },
    deriveAnswerKind: () => 'answered',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
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

async function settle<T>(p: Promise<T>): Promise<T> {
  const captured = p.then(
    (v) => ({ ok: true as const, v }),
    (e) => ({ ok: false as const, e })
  )
  await vi.runAllTimersAsync()
  const r = await captured
  if (r.ok) return r.v
  throw r.e
}

describe('wireSink forwarding', () => {
  it('forwards buffered pre-commit envelope chunks in order once the stream commits', async () => {
    mockChat.mockReturnValueOnce(streamOf(GOOD_CHUNKS))
    const wire: Chunk[] = []
    const result = await settle(
      runSynthesis(baseOptions({ wireSink: (c) => wire.push(c as Chunk) }))
    )

    expect(result.outcome).toBe('success')
    // Envelope TEXT_MESSAGE_START buffered, then flushed by the committing
    // delta; lifecycle chunks filtered out entirely.
    expect(wire.map((c) => c.type)).toEqual([
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TOOL_CALL_START',
      'TOOL_CALL_END',
      'CUSTOM',
      'TEXT_MESSAGE_END',
    ])
  })

  it('never forwards RUN_STARTED / RUN_FINISHED / RUN_ERROR', async () => {
    mockChat.mockReturnValueOnce(streamOf(GOOD_CHUNKS))
    const wire: Chunk[] = []
    await settle(runSynthesis(baseOptions({ wireSink: (c) => wire.push(c as Chunk) })))

    expect(wire.some((c) => ['RUN_STARTED', 'RUN_FINISHED', 'RUN_ERROR'].includes(c.type))).toBe(
      false
    )
  })

  it('keeps a pristine RUN_ERROR re-dial invisible to the wire', async () => {
    // Dial 1: envelope then a retryable transport failure — pristine.
    mockChat.mockReturnValueOnce(
      streamOf([
        { type: 'RUN_STARTED' },
        { type: 'TEXT_MESSAGE_START', messageId: 'dead' },
        { type: 'RUN_ERROR', message: '429 rate limited' },
      ])
    )
    // Dial 2: succeeds.
    mockChat.mockReturnValueOnce(streamOf(GOOD_CHUNKS))

    const wire: Chunk[] = []
    const result = await settle(
      runSynthesis(baseOptions({ wireSink: (c) => wire.push(c as Chunk) }))
    )

    expect(result.outcome).toBe('success')
    expect(mockChat).toHaveBeenCalledTimes(2)
    // Nothing from dial 1: the dead TEXT_MESSAGE_START never reached the wire.
    expect(wire.filter((c) => (c as { messageId?: string }).messageId === 'dead')).toEqual([])
    expect(wire[0]?.type).toBe('TEXT_MESSAGE_START')
    expect((wire[0] as { messageId?: string }).messageId).toBe('m1')
  })

  it('forwards CUSTOM events emitted by tools mid-stream', async () => {
    mockChat.mockReturnValueOnce(
      streamOf([
        { type: 'RUN_STARTED' },
        { type: 'TOOL_CALL_START', toolCallName: 'search', toolCallId: 'c1' },
        { type: 'CUSTOM', name: 'quackback:activity', value: { status: 'searching_kb' } },
        { type: 'TOOL_CALL_END', toolCallId: 'c1' },
        { type: 'TEXT_MESSAGE_CONTENT', delta: JSON.stringify(GOOD_OBJECT) },
        { type: 'CUSTOM', name: 'structured-output.complete', value: { object: GOOD_OBJECT } },
        { type: 'RUN_FINISHED' },
      ])
    )
    const wire: Chunk[] = []
    await settle(runSynthesis(baseOptions({ wireSink: (c) => wire.push(c as Chunk) })))

    const custom = wire.filter((c) => c.type === 'CUSTOM') as Array<Chunk & { name: string }>
    expect(custom.map((c) => c.name)).toEqual(['quackback:activity', 'structured-output.complete'])
  })

  it('is inert when no wireSink is provided', async () => {
    mockChat.mockReturnValueOnce(streamOf(GOOD_CHUNKS))
    const result = await settle(runSynthesis(baseOptions()))
    expect(result.outcome).toBe('success')
  })
})

describe('tools and response_format must not share a request', () => {
  const tools = {
    specs: [],
    context: {},
    agentLoopStrategy: (() => false) as never,
    names: new Set<string>(),
  }

  it('forces the split path (adapter reports no combined tools+schema support) when tools are wired', async () => {
    mockChat.mockReturnValueOnce(streamOf(GOOD_CHUNKS))
    await settle(runSynthesis(baseOptions({ tools })))

    const adapter = (mockChat.mock.calls[0][0] as { adapter: Record<string, unknown> }).adapter
    const supports = adapter.supportsCombinedToolsAndSchema as (() => boolean) | undefined
    expect(supports?.()).toBe(false)
  })

  it('keeps the single-request combined stream for tool-less calls', async () => {
    mockChat.mockReturnValueOnce(streamOf(GOOD_CHUNKS))
    await settle(runSynthesis(baseOptions()))

    const adapter = (mockChat.mock.calls[0][0] as { adapter: Record<string, unknown> }).adapter
    expect(adapter.supportsCombinedToolsAndSchema).toBeUndefined()
  })

  it('resets delta-diffing at the finalization boundary so loop prose never poisons the JSON parse', async () => {
    // Split-path shape: unconstrained loop prose, then structured-output.start,
    // then the finalization stream carrying the actual JSON.
    mockChat.mockReturnValueOnce(
      streamOf([
        { type: 'RUN_STARTED' },
        { type: 'TEXT_MESSAGE_CONTENT', delta: 'Let me look into that. ' },
        { type: 'CUSTOM', name: 'structured-output.start', value: { messageId: 'm2' } },
        { type: 'TEXT_MESSAGE_CONTENT', delta: '{"text":"The an' },
        { type: 'TEXT_MESSAGE_CONTENT', delta: 'swer."}' },
        {
          type: 'CUSTOM',
          name: 'structured-output.complete',
          value: { object: { text: 'The answer.' } },
        },
        { type: 'RUN_FINISHED' },
      ])
    )
    const deltas: string[] = []
    const result = await settle(
      runSynthesis(baseOptions({ tools, onTextDelta: (d) => deltas.push(d) }))
    )

    expect(result.outcome).toBe('success')
    // Only the finalization stream's schema text surfaces as clean deltas;
    // the loop prose (unparseable as the envelope) emits nothing.
    expect(deltas.join('')).toBe('The answer.')
  })
})
