// @vitest-environment node
/**
 * The Claude API path end to end below the network: the real TanStack AI
 * engine, the real @tanstack/ai-anthropic adapter and Anthropic SDK, and a
 * fetch double standing in for api.anthropic.com. Checks what goes on the
 * wire (headers, structured output, images, thinking, no sampling params) and
 * what comes back (zod-validated objects, errors, retries, usage).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const mockConfig = vi.hoisted(() => ({
  openaiApiKey: undefined as string | undefined,
  openaiBaseUrl: undefined as string | undefined,
  anthropicApiKey: 'sk-ant-test' as string | undefined,
  anthropicVersion: undefined as string | undefined,
  aiReasoningEffort: undefined as string | undefined,
  aiRequireParameters: undefined,
  aiReasoningExclude: undefined,
}))

vi.mock('@/lib/server/config', () => ({ config: mockConfig }))
vi.mock('@/lib/server/logger', () => {
  const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => log }
  return { logger: log }
})

import { chat, type ChatMiddleware } from '@tanstack/ai'
import {
  anthropicModelOptions,
  createChatAdapter,
  toAnthropicOutputSchema,
  withPromptUsage,
} from '../chat-adapter'
import { structuredChat } from '../structured-chat'

interface Captured {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

let captured: Captured[] = []

/** A streamed Messages response whose single text block is `text`. */
function sseResponse(text: string, usage = { input_tokens: 120, output_tokens: 30 }): Response {
  const events: Array<[string, unknown]> = [
    [
      'message_start',
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-5-5',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: usage.input_tokens, output_tokens: 1 },
        },
      },
    ],
    [
      'content_block_start',
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ],
    [
      'content_block_delta',
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    ],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    [
      'message_delta',
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: usage.output_tokens },
      },
    ],
    ['message_stop', { type: 'message_stop' }],
  ]
  const body = events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function errorResponse(status: number, type: string, message: string): Response {
  return new Response(JSON.stringify({ type: 'error', error: { type, message } }), {
    status,
    headers: { 'content-type': 'application/json', 'retry-after-ms': '1' },
  })
}

function stubFetch(...responses: Array<() => Response>) {
  const queue = [...responses]
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v))
    captured.push({
      url: String(input),
      headers,
      body: JSON.parse(String(init?.body ?? '{}')),
    })
    const next = queue.shift()
    if (!next) throw new Error('unexpected request')
    return next()
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

const Schema = z.object({
  reply: z.string().max(600),
  tone: z.enum(['warm', 'cool']),
  ops: z.array(z.object({ target: z.string().max(80), value: z.string() })).max(20),
})

const pixel = Buffer.from('fake-png-bytes').toString('base64')

beforeEach(() => {
  captured = []
  mockConfig.anthropicApiKey = 'sk-ant-test'
  mockConfig.openaiApiKey = undefined
  mockConfig.openaiBaseUrl = undefined
  mockConfig.anthropicVersion = undefined
  mockConfig.aiReasoningEffort = undefined
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('structuredChat on the Claude API', () => {
  it('sends one streamed request with output_config.format, images and the API version', async () => {
    stubFetch(() =>
      sseResponse(
        JSON.stringify({ reply: 'Done.', tone: 'warm', ops: [{ target: 'a', value: 'b' }] })
      )
    )
    const out = await structuredChat({
      model: 'claude-haiku-5-5',
      systemPrompts: ['You design.'],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'data', value: pixel, mimeType: 'image/jpeg' } },
            { type: 'text', content: 'Match this brand.' },
          ],
        },
      ],
      schema: Schema,
      maxTokens: 900,
    })

    expect(out).toEqual({ reply: 'Done.', tone: 'warm', ops: [{ target: 'a', value: 'b' }] })
    expect(captured).toHaveLength(1)
    const [req] = captured
    expect(req.url).toContain('https://api.anthropic.com/v1/messages')
    expect(req.headers['x-api-key']).toBe('sk-ant-test')
    expect(req.headers['anthropic-version']).toBe('2026-10-21')
    expect(req.body.model).toBe('claude-haiku-5-5')
    expect(req.body.stream).toBe(true)
    expect(req.body.max_tokens).toBe(900)
    expect(req.body.thinking).toEqual({ type: 'disabled' })
    expect(req.body).not.toHaveProperty('temperature')
    expect(req.body).not.toHaveProperty('top_p')
    expect(req.body).not.toHaveProperty('tools')
    expect(req.body).not.toHaveProperty('tool_choice')
    expect(req.body).not.toHaveProperty('provider')
    expect(req.body.system).toEqual([{ type: 'text', text: 'You design.' }])

    const content = (req.body.messages as Array<{ content: unknown[] }>)[0].content
    expect(content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: pixel },
    })
    expect(content[1]).toMatchObject({ type: 'text', text: 'Match this brand.' })

    const format = (req.body.output_config as { format: { type: string; schema: unknown } }).format
    expect(format.type).toBe('json_schema')
    const schemaText = JSON.stringify(format.schema)
    expect(schemaText).not.toContain('maxLength')
    expect(schemaText).not.toContain('maxItems')
    expect(schemaText).not.toContain('"$schema"')
    expect(format.schema).toMatchObject({ type: 'object', additionalProperties: false })
  })

  it('sends ANTHROPIC_VERSION when set', async () => {
    mockConfig.anthropicVersion = '2023-06-01'
    stubFetch(() => sseResponse(JSON.stringify({ reply: 'x', tone: 'cool', ops: [] })))
    await structuredChat({
      model: 'claude-haiku-5-5',
      systemPrompts: [],
      messages: [{ role: 'user', content: 'hi' }],
      schema: Schema,
      maxTokens: 100,
    })
    expect(captured[0].headers['anthropic-version']).toBe('2023-06-01')
  })

  it('maps AI_REASONING_EFFORT to adaptive thinking with output headroom', async () => {
    mockConfig.aiReasoningEffort = 'low'
    stubFetch(() => sseResponse(JSON.stringify({ reply: 'x', tone: 'cool', ops: [] })))
    await structuredChat({
      model: 'claude-haiku-5-5',
      systemPrompts: [],
      messages: [{ role: 'user', content: 'hi' }],
      schema: Schema,
      maxTokens: 400,
    })
    const body = captured[0].body
    expect(body).not.toHaveProperty('thinking')
    expect((body.output_config as { effort: string }).effort).toBe('low')
    expect(body.max_tokens).toBe(400 + 8000)
  })

  it('rejects an answer that breaks the zod schema the API could not express', async () => {
    // maxLength is stripped for the API, so the model can overrun it; zod catches it.
    stubFetch(() => sseResponse(JSON.stringify({ reply: 'x'.repeat(601), tone: 'warm', ops: [] })))
    await expect(
      structuredChat({
        model: 'claude-haiku-5-5',
        systemPrompts: [],
        messages: [{ role: 'user', content: 'hi' }],
        schema: Schema,
        maxTokens: 100,
      })
    ).rejects.toThrow()
  })

  it('rejects an answer that is not JSON', async () => {
    stubFetch(() => sseResponse('I would rather chat.'))
    await expect(
      structuredChat({
        model: 'claude-haiku-5-5',
        systemPrompts: [],
        messages: [{ role: 'user', content: 'hi' }],
        schema: Schema,
        maxTokens: 100,
      })
    ).rejects.toThrow()
  })

  it('retries an overloaded or rate-limited API, then answers', async () => {
    const fetch = stubFetch(
      () => errorResponse(529, 'overloaded_error', 'Overloaded'),
      () => errorResponse(429, 'rate_limit_error', 'Slow down'),
      () => sseResponse(JSON.stringify({ reply: 'ok', tone: 'warm', ops: [] }))
    )
    const out = await structuredChat({
      model: 'claude-haiku-5-5',
      systemPrompts: [],
      messages: [{ role: 'user', content: 'hi' }],
      schema: Schema,
      maxTokens: 100,
    })
    expect(out.reply).toBe('ok')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('fails once, with the API message, on a bad request', async () => {
    const fetch = stubFetch(() =>
      errorResponse(400, 'invalid_request_error', 'model: claude-nope is not a model')
    )
    await expect(
      structuredChat({
        model: 'claude-nope',
        systemPrompts: [],
        messages: [{ role: 'user', content: 'hi' }],
        schema: Schema,
        maxTokens: 100,
      })
    ).rejects.toThrow(/claude-nope is not a model/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reports token usage to middleware', async () => {
    stubFetch(() =>
      sseResponse(JSON.stringify({ reply: 'x', tone: 'cool', ops: [] }), {
        input_tokens: 321,
        output_tokens: 45,
      })
    )
    const seen: Array<{ promptTokens?: number; completionTokens?: number }> = []
    const usageProbe: ChatMiddleware = {
      name: 'probe',
      onUsage: (_ctx, usage) => {
        seen.push(usage)
      },
    }
    await structuredChat({
      model: 'claude-haiku-5-5',
      systemPrompts: [],
      messages: [{ role: 'user', content: 'hi' }],
      schema: Schema,
      maxTokens: 100,
      middleware: [usageProbe],
    })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.at(-1)).toMatchObject({ promptTokens: 321, completionTokens: 45 })
  })
})

describe('createChatAdapter', () => {
  it('drops OpenRouter extras from a plain chat call', async () => {
    stubFetch(() => sseResponse('Hello there.'))
    const text = await chat({
      adapter: createChatAdapter('claude-haiku-5-5'),
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
      modelOptions: {
        max_tokens: 50,
        provider: { require_parameters: true },
        reasoning: { exclude: true },
      } as never,
    })
    expect(text).toBe('Hello there.')
    expect(captured[0].body).not.toHaveProperty('provider')
    expect(captured[0].body).not.toHaveProperty('reasoning')
    expect(captured[0].body.max_tokens).toBe(50)
  })

  it('builds the OpenAI-compatible adapter when that provider is active', () => {
    mockConfig.anthropicApiKey = undefined
    mockConfig.openaiApiKey = 'sk'
    mockConfig.openaiBaseUrl = 'https://x/v1'
    expect(createChatAdapter('m').name).not.toBe('anthropic')
  })
})

describe('toAnthropicOutputSchema', () => {
  it('keeps what the API accepts and closes every object', () => {
    const out = toAnthropicOutputSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 5, pattern: '^a' },
        count: { type: 'integer', minimum: 0, maximum: 9 },
        when: { type: 'string', format: 'date-time' },
        colour: { type: 'string', format: 'hex-color' },
        tags: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
        many: { type: 'array', items: { type: 'string' }, minItems: 2 },
        nested: {
          anyOf: [{ type: 'object', properties: { x: { type: 'number' } } }, { type: 'null' }],
        },
        properties: { type: 'string', enum: ['a'] },
      },
      required: ['name'],
      additionalProperties: {},
    })
    expect(out).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        count: { type: 'integer' },
        when: { type: 'string', format: 'date-time' },
        colour: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
        many: { type: 'array', items: { type: 'string' } },
        nested: {
          anyOf: [
            { type: 'object', properties: { x: { type: 'number' } }, additionalProperties: false },
            { type: 'null' },
          ],
        },
        properties: { type: 'string', enum: ['a'] },
      },
      required: ['name'],
      additionalProperties: false,
    })
  })
})

describe('anthropicModelOptions', () => {
  it('turns thinking off by default on models that allow it', () => {
    expect(anthropicModelOptions('claude-haiku-5-5', { max_tokens: 300 }, undefined)).toEqual({
      max_tokens: 300,
      thinking: { type: 'disabled' },
    })
  })

  it('uses low effort with headroom on models whose thinking cannot be disabled', () => {
    expect(anthropicModelOptions('claude-opus-5-5', { max_tokens: 300 }, undefined)).toEqual({
      max_tokens: 8300,
      output_config: { effort: 'low' },
    })
    expect(anthropicModelOptions('claude-sonnet-5-5', {}, 'high')).toEqual({
      output_config: { effort: 'high' },
    })
  })

  it('maps minimal to low and ignores an unknown effort', () => {
    expect(anthropicModelOptions('claude-haiku-5-5', {}, 'minimal')).toEqual({
      output_config: { effort: 'low' },
    })
    expect(anthropicModelOptions('claude-haiku-5-5', {}, 'turbo')).toEqual({
      thinking: { type: 'disabled' },
    })
  })
})

describe('withPromptUsage', () => {
  async function* events() {
    yield { type: 'message_start', message: { usage: { input_tokens: 50, output_tokens: 1 } } }
    yield { type: 'message_delta', usage: { output_tokens: 9 } }
    yield { type: 'message_delta', usage: { input_tokens: 70, output_tokens: 12 } }
  }

  it('fills the prompt tokens a delta leaves out and keeps the ones it has', async () => {
    const out = []
    for await (const e of withPromptUsage(events())) out.push(e)
    expect(out[1]).toEqual({ type: 'message_delta', usage: { output_tokens: 9, input_tokens: 50 } })
    expect(out[2]).toEqual({
      type: 'message_delta',
      usage: { input_tokens: 70, output_tokens: 12 },
    })
  })
})
