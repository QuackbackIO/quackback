/**
 * Structured requests go out as `response_format: json_schema`. Some
 * OpenAI-compatible servers reject that with a 400. The helper retries once as
 * `json_object` with the schema described in the prompt, remembers per base URL
 * that the server needs it, and validates with the same zod schema either way.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const hoisted = vi.hoisted(() => ({
  chat: vi.fn(),
  cfg: {
    openaiBaseUrl: 'https://llm.internal/v1' as string | null,
    aiRequireParameters: undefined,
  },
}))

vi.mock('@tanstack/ai', () => ({ chat: hoisted.chat }))
vi.mock('@tanstack/ai-openai/compatible', () => ({
  openaiCompatibleText: (model: string, opts: { baseURL: string }) => ({
    model,
    baseURL: opts.baseURL,
  }),
}))
vi.mock('@/lib/server/config', () => ({
  config: {
    get openaiBaseUrl() {
      return hoisted.cfg.openaiBaseUrl
    },
    openaiApiKey: 'k',
    get aiRequireParameters() {
      return hoisted.cfg.aiRequireParameters
    },
  },
}))
vi.mock('@/lib/server/logger', () => {
  const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => log }
  return { logger: log }
})

import {
  isResponseFormatRejection,
  resetStructuredFallbackMemory,
  structuredChat,
} from '../structured-chat'

const Schema = z.object({ sentiment: z.enum(['positive', 'negative']), confidence: z.number() })
const base = {
  model: 'm',
  systemPrompts: ['You classify.'],
  messages: [{ role: 'user' as const, content: 'hello' }],
  schema: Schema,
  maxTokens: 500,
}

/** The error shape the OpenAI SDK throws for a 400 from the server. */
function rejection(message: string, param?: string) {
  return Object.assign(new Error(`400 ${message}`), {
    status: 400,
    param,
    error: { message, param },
  })
}

beforeEach(() => {
  hoisted.chat.mockReset()
  hoisted.cfg.openaiBaseUrl = 'https://llm.internal/v1'
  hoisted.cfg.aiRequireParameters = undefined
  resetStructuredFallbackMemory()
})

describe('structuredChat', () => {
  it('sends json_schema through outputSchema first', async () => {
    hoisted.chat.mockResolvedValueOnce({ sentiment: 'positive', confidence: 0.9 })
    const out = await structuredChat(base)
    expect(out).toEqual({ sentiment: 'positive', confidence: 0.9 })
    expect(hoisted.chat).toHaveBeenCalledTimes(1)
    expect(hoisted.chat.mock.calls[0][0].outputSchema).toBe(Schema)
  })

  it('retries once as json_object with the schema in the prompt when json_schema is rejected', async () => {
    hoisted.chat
      .mockRejectedValueOnce(rejection("'response_format.type' json_schema is unsupported"))
      .mockResolvedValueOnce('```json\n{"sentiment":"negative","confidence":0.4}\n```')

    const out = await structuredChat(base)

    expect(out).toEqual({ sentiment: 'negative', confidence: 0.4 })
    expect(hoisted.chat).toHaveBeenCalledTimes(2)
    const second = hoisted.chat.mock.calls[1][0]
    expect(second.outputSchema).toBeUndefined()
    expect(second.modelOptions.response_format).toEqual({ type: 'json_object' })
    expect(second.modelOptions.max_tokens).toBe(500)
    const system = second.systemPrompts.join('\n')
    expect(system).toContain('You classify.')
    expect(system).toMatch(/JSON/)
    expect(system).toContain('"sentiment"')
    expect(system).toContain('"confidence"')
    expect(second.messages).toEqual(base.messages)
  })

  it('remembers the endpoint and skips json_schema on later calls', async () => {
    hoisted.chat
      .mockRejectedValueOnce(rejection("'response_format' type json_schema is not supported"))
      .mockResolvedValueOnce('{"sentiment":"positive","confidence":1}')
      .mockResolvedValueOnce('{"sentiment":"negative","confidence":0}')

    await structuredChat(base)
    await structuredChat(base)

    expect(hoisted.chat).toHaveBeenCalledTimes(3)
    expect(hoisted.chat.mock.calls[2][0].outputSchema).toBeUndefined()
    expect(hoisted.chat.mock.calls[2][0].modelOptions.response_format).toEqual({
      type: 'json_object',
    })
  })

  it('sends no response_format when the server does not implement the parameter', async () => {
    hoisted.chat
      .mockRejectedValueOnce(rejection('Unsupported parameter: response_format', 'response_format'))
      .mockResolvedValueOnce('```json\n{"sentiment":"positive","confidence":1}\n```')
      .mockResolvedValueOnce('{"sentiment":"negative","confidence":0}')

    expect(await structuredChat(base)).toEqual({ sentiment: 'positive', confidence: 1 })
    const retry = hoisted.chat.mock.calls[1][0]
    expect(retry.outputSchema).toBeUndefined()
    expect(retry.modelOptions).toEqual({ max_tokens: 500 })
    expect(retry.systemPrompts.join('\n')).toContain('"confidence"')

    // Remembered: the next call goes straight to the prompt-only request.
    await structuredChat(base)
    expect(hoisted.chat).toHaveBeenCalledTimes(3)
    expect(hoisted.chat.mock.calls[2][0].modelOptions).toEqual({ max_tokens: 500 })
  })

  it('drops to prompt-only when json_object is rejected too', async () => {
    hoisted.chat
      .mockRejectedValueOnce(rejection('json_schema is not supported'))
      .mockRejectedValueOnce(rejection('json_object is not supported', 'response_format'))
      .mockResolvedValueOnce('{"sentiment":"positive","confidence":1}')

    await structuredChat(base)

    expect(hoisted.chat).toHaveBeenCalledTimes(3)
    expect(hoisted.chat.mock.calls[1][0].modelOptions.response_format).toEqual({
      type: 'json_object',
    })
    expect(hoisted.chat.mock.calls[2][0].modelOptions.response_format).toBeUndefined()
  })

  it('keys the memory by model as well as base URL', async () => {
    hoisted.chat
      .mockRejectedValueOnce(rejection('json_schema is not supported'))
      .mockResolvedValueOnce('{"sentiment":"positive","confidence":1}')
      .mockResolvedValueOnce({ sentiment: 'negative', confidence: 0 })

    await structuredChat(base)
    await structuredChat({ ...base, model: 'other-model' })

    expect(hoisted.chat.mock.calls[2][0].outputSchema).toBe(Schema)
  })

  it('does not carry the memory to a different base URL', async () => {
    hoisted.chat
      .mockRejectedValueOnce(rejection('response_format json_schema not supported'))
      .mockResolvedValueOnce('{"sentiment":"positive","confidence":1}')
      .mockResolvedValueOnce({ sentiment: 'negative', confidence: 0 })

    await structuredChat(base)
    hoisted.cfg.openaiBaseUrl = 'https://other.example/v1'
    await structuredChat(base)

    expect(hoisted.chat.mock.calls[2][0].outputSchema).toBe(Schema)
  })

  it('validates the fallback output with the same schema', async () => {
    hoisted.chat
      .mockRejectedValueOnce(rejection('json_schema is not supported'))
      .mockResolvedValueOnce('{"sentiment":"sideways","confidence":1}')

    await expect(structuredChat(base)).rejects.toMatchObject({
      code: 'structured-output-validation-failed',
    })
  })

  it('reports unparseable and empty fallback output with the structured-output codes', async () => {
    hoisted.chat
      .mockRejectedValueOnce(rejection('json_schema is not supported'))
      .mockResolvedValueOnce('not json at all')
    await expect(structuredChat(base)).rejects.toMatchObject({
      code: 'structured-output-parse-failed',
    })

    resetStructuredFallbackMemory()
    hoisted.chat
      .mockRejectedValueOnce(rejection('json_schema is not supported'))
      .mockResolvedValueOnce('')
    await expect(structuredChat(base)).rejects.toMatchObject({
      code: 'structured-output-missing-result',
    })
  })

  it('does not retry unrelated failures', async () => {
    hoisted.chat.mockRejectedValueOnce(Object.assign(new Error('503 upstream'), { status: 503 }))
    await expect(structuredChat(base)).rejects.toThrow('503 upstream')
    expect(hoisted.chat).toHaveBeenCalledTimes(1)
  })

  it('keeps require_parameters on OpenRouter for the first request', async () => {
    hoisted.cfg.openaiBaseUrl = 'https://openrouter.ai/api/v1'
    hoisted.chat.mockResolvedValueOnce({ sentiment: 'positive', confidence: 1 })
    await structuredChat(base)
    expect(hoisted.chat.mock.calls[0][0].modelOptions).toEqual({
      max_tokens: 500,
      provider: { require_parameters: true },
    })
  })

  it('passes middleware to both attempts', async () => {
    const mw = [{ name: 'usage' }]
    hoisted.chat
      .mockRejectedValueOnce(rejection('json_schema is not supported'))
      .mockResolvedValueOnce('{"sentiment":"positive","confidence":1}')
    await structuredChat({ ...base, middleware: mw as never })
    expect(hoisted.chat.mock.calls[0][0].middleware).toBe(mw)
    expect(hoisted.chat.mock.calls[1][0].middleware).toBe(mw)
  })
})

describe('isResponseFormatRejection', () => {
  it('matches the 400 shapes servers use for a response_format they do not support', () => {
    expect(isResponseFormatRejection(rejection('x', 'response_format'))).toBe(true)
    expect(
      isResponseFormatRejection(
        rejection("Invalid parameter: 'response_format' of type 'json_schema' is not supported")
      )
    ).toBe(true)
    expect(isResponseFormatRejection(rejection('This model does not support json_schema'))).toBe(
      true
    )
    expect(isResponseFormatRejection(rejection('Unsupported value: response_format'))).toBe(true)
    expect(
      isResponseFormatRejection(
        Object.assign(new Error('bad'), {
          status: 422,
          error: { message: 'response_format.json_schema is not allowed' },
        })
      )
    ).toBe(true)
  })

  it('does not match other 400s, other statuses or non-errors', () => {
    expect(
      isResponseFormatRejection(
        rejection('Unsupported parameter: max_completion_tokens', 'max_completion_tokens')
      )
    ).toBe(false)
    expect(isResponseFormatRejection(rejection('context length exceeded'))).toBe(false)
    expect(
      isResponseFormatRejection(Object.assign(new Error('response_format'), { status: 500 }))
    ).toBe(false)
    expect(isResponseFormatRejection(null)).toBe(false)
    expect(isResponseFormatRejection('response_format')).toBe(false)
  })
})
