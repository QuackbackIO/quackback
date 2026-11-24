// @vitest-environment node
/**
 * synthesis-core and structuredChat against the REAL @tanstack/ai engine and
 * OpenAI-compatible adapter, with only the HTTP layer stubbed. The other
 * suites mock `chat()`, so they cannot see what the library itself does. These
 * pin the library behaviour the AI surfaces rely on:
 *
 *  - every `chat()` call carries a `threadId` (1.x throws without one);
 *  - the OpenRouter request keeps exactly the params `require_parameters`
 *    gates on (no new top-level field appears);
 *  - with tools wired, the agent loop and the structured finalization are
 *    separate requests (tools never share a request with response_format);
 *  - the reasoning a model streams stays off the AG-UI wire;
 *  - token usage still reaches RUN_FINISHED and the usage middleware.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { maxIterations, toolDefinition, type StreamChunk } from '@tanstack/ai'

const mockConfig = vi.hoisted(() => ({
  openaiApiKey: 'test-key',
  openaiBaseUrl: 'https://openrouter.ai/api/v1',
  aiRequireParameters: undefined,
}))
vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

const mockLogAiUsage = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/server/domains/ai/usage-log', () => ({
  logAiUsage: mockLogAiUsage,
  withUsageLogging: async (
    _params: unknown,
    fn: () => Promise<{ result: unknown }>,
    extract: (result: unknown) => unknown
  ) => {
    const { result } = await fn()
    extract(result)
    return result
  },
}))

vi.mock('@/lib/server/logger', () => {
  const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => log }
  return { logger: log }
})

import { runSynthesis, type RunSynthesisOptions } from '../synthesis-core'
import { resetStructuredFallbackMemory, structuredChat } from '../../ai/structured-chat'
import { createUsageLoggingMiddleware } from '../../ai/usage-middleware'

const STUB_USAGE = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }

type Body = Record<string, unknown> & { messages: unknown[]; tools?: unknown[] }

const CHUNK = { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'm' }
const delta = (d: Record<string, unknown>, finish: string | null = null) => ({
  ...CHUNK,
  choices: [{ index: 0, delta: d, finish_reason: finish }],
})
const USAGE = {
  ...CHUNK,
  choices: [],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
}

function sse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

function completion(content: string): Response {
  return new Response(
    JSON.stringify({
      id: 'x',
      object: 'chat.completion',
      created: 1,
      model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { headers: { 'content-type': 'application/json' } }
  )
}

const THINKING = delta({
  role: 'assistant',
  reasoning: 'let me think',
  reasoning_details: [{ type: 'reasoning.text', text: 'let me think', index: 0 }],
})

let bodies: Body[]

function stubProvider(replies: Array<(body: Body) => Response>): void {
  bodies = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Body
      bodies.push(body)
      const reply = replies.shift()
      if (!reply) throw new Error('unexpected extra provider request')
      return reply(body)
    })
  )
}

const OutputSchema = z.object({ text: z.string() })

function options(
  overrides: Partial<RunSynthesisOptions<string>> = {}
): RunSynthesisOptions<string> {
  return {
    model: 'test-model',
    systemPrompts: ['sys'],
    messages: [{ role: 'user', content: 'q' }],
    outputSchema: OutputSchema,
    deltaField: 'text',
    salvageMode: 'forgiving',
    salvage: () => null,
    onFailure: 'throw',
    retries: 0,
    usageLogParams: { pipelineStep: 'assistant', callType: 'chat_completion', model: 'test-model' },
    deriveAnswerKind: () => 'answered',
    ...overrides,
  }
}

beforeEach(() => {
  resetStructuredFallbackMemory()
  mockLogAiUsage.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('synthesis-core on the real TanStack AI engine', () => {
  it('streams a tool-less structured turn and keeps reasoning off the wire', async () => {
    stubProvider([
      () =>
        sse([
          THINKING,
          delta({ content: '{"text":"hello' }),
          delta({ content: ' world"}' }),
          delta({}, 'stop'),
          USAGE,
        ]),
    ])
    const wire: StreamChunk[] = []
    const deltas: string[] = []

    const outcome = await runSynthesis(
      options({ wireSink: (c) => wire.push(c), onTextDelta: (d) => deltas.push(d) })
    )

    expect(outcome).toMatchObject({ outcome: 'success', final: { text: 'hello world' } })
    expect(outcome).toMatchObject({ usage: STUB_USAGE })
    expect(deltas.join('')).toBe('hello world')
    expect(wire.some((c) => c.type === 'TEXT_MESSAGE_CONTENT')).toBe(true)
    expect(wire.filter((c) => c.type.startsWith('REASONING_'))).toEqual([])
    expect(wire.filter((c) => c.type.startsWith('RUN_'))).toEqual([])

    expect(bodies).toHaveLength(1)
    expect(Object.keys(bodies[0]).sort()).toEqual([
      'max_tokens',
      'messages',
      'model',
      'provider',
      'response_format',
      'stream',
      'stream_options',
    ])
    expect(bodies[0].provider).toEqual({ require_parameters: true })
  })

  it('runs the tool loop and the structured finalization as separate requests', async () => {
    stubProvider([
      () =>
        sse([
          THINKING,
          delta({
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'lookup', arguments: '{"q":"x"}' },
              },
            ],
          }),
          delta({}, 'tool_calls'),
          USAGE,
        ]),
      () => sse([delta({ role: 'assistant', content: 'found it' }), delta({}, 'stop'), USAGE]),
      () =>
        sse([delta({ role: 'assistant', content: '{"text":"final"}' }), delta({}, 'stop'), USAGE]),
    ])
    const lookup = toolDefinition({
      name: 'lookup',
      description: 'Look something up',
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
    }).server(async () => ({ ok: true }))
    const wire: StreamChunk[] = []

    const outcome = await runSynthesis(
      options({
        tools: {
          specs: [lookup],
          context: undefined,
          agentLoopStrategy: maxIterations(4),
          names: new Set(['lookup']),
        },
        wireSink: (c) => wire.push(c),
      })
    )

    expect(outcome).toMatchObject({ outcome: 'success', final: { text: 'final' } })
    expect(outcome).toMatchObject({ usage: STUB_USAGE })
    expect(wire.some((c) => c.type === 'TOOL_CALL_START')).toBe(true)
    expect(wire.filter((c) => c.type.startsWith('REASONING_'))).toEqual([])
    expect(wire.filter((c) => c.type.startsWith('RUN_'))).toEqual([])

    expect(bodies).toHaveLength(3)
    for (const loop of bodies.slice(0, 2)) {
      expect(loop.tools).toHaveLength(1)
      expect(loop).not.toHaveProperty('response_format')
    }
    expect(bodies[2]).not.toHaveProperty('tools')
    expect(bodies[2]).toHaveProperty('response_format')
  })
})

describe('structuredChat on the real TanStack AI engine', () => {
  it('returns the schema-validated object from a json_schema request', async () => {
    stubProvider([
      (body) =>
        body.stream
          ? sse([delta({ role: 'assistant', content: '{"text":"ok"}' }), delta({}, 'stop'), USAGE])
          : completion('{"text":"ok"}'),
    ])

    const usage = createUsageLoggingMiddleware({ pipelineStep: 'contract', model: 'm' })

    const result = await structuredChat({
      model: 'm',
      systemPrompts: ['sys'],
      messages: [{ role: 'user', content: 'hi' }],
      schema: OutputSchema,
      maxTokens: 100,
      middleware: [usage],
    })
    await usage.settled()

    expect(result).toEqual({ text: 'ok' })
    expect(mockLogAiUsage).toHaveBeenCalledTimes(1)
    expect(mockLogAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      })
    )
    expect(bodies).toHaveLength(1)
    expect((bodies[0].response_format as { type: string }).type).toBe('json_schema')
  })

  it('falls back to a prompt-described schema after a response_format rejection', async () => {
    const rejection = () =>
      new Response(
        JSON.stringify({
          error: {
            message: 'response_format json_schema is not supported',
            param: 'response_format',
          },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      )
    stubProvider([
      rejection,
      (body) =>
        body.stream
          ? sse([delta({ role: 'assistant', content: '{"text":"ok"}' }), delta({}, 'stop'), USAGE])
          : completion('{"text":"ok"}'),
    ])

    const result = await structuredChat({
      model: 'm-fallback',
      systemPrompts: ['sys'],
      messages: [{ role: 'user', content: 'hi' }],
      schema: OutputSchema,
      maxTokens: 100,
    })

    expect(result).toEqual({ text: 'ok' })
    expect(bodies).toHaveLength(2)
    expect(bodies[1].response_format).toEqual({ type: 'json_object' })
  })
})
