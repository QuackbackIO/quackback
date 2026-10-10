// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import OpenAI from 'openai'
import { chat } from '@tanstack/ai'
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'
import { getOpenAIClientOptions, parseOpenAIHeaders } from '../client-options'

afterEach(() => vi.unstubAllGlobals())

describe('OpenAI gateway headers', () => {
  it('accepts optional string/null values and normalizes header names', () => {
    expect(parseOpenAIHeaders(undefined)).toEqual({})
    expect(parseOpenAIHeaders('')).toEqual({})
    expect(parseOpenAIHeaders('{"Authorization":null,"X-Gateway":"synthetic"}')).toEqual({
      authorization: null,
      'x-gateway': 'synthetic',
    })
  })

  it.each([
    'private malformed',
    'null',
    '[]',
    '{"x-private":42}',
    '{"x-private":true}',
    '{"x bad":"private"}',
    '{"x":"private\\nvalue"}',
    '{"X":"private","x":null}',
  ])('rejects invalid configuration without including its value', (value) => {
    expect(() => parseOpenAIHeaders(value)).toThrow(
      'Invalid OPENAI_DEFAULT_HEADERS: expected unique HTTP header names with string or null values'
    )
    try {
      parseOpenAIHeaders(value)
    } catch (error) {
      expect(String(error)).not.toContain('private')
    }
  })

  it('preserves SDK defaults when no overrides are configured', async () => {
    let request: Request | undefined
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init)
      return Response.json({ data: [] })
    })
    const client = new OpenAI(
      getOpenAIClientOptions({
        openaiApiKey: 'synthetic-key',
        openaiBaseUrl: 'https://gateway.example/v1',
      })
    )
    await client.embeddings.create({ model: 'synthetic-model', input: 'fixture' })
    expect(request!.headers.get('authorization')).toBe('Bearer synthetic-key')
  })

  it('applies overrides to actual SDK chat/embeddings and TanStack streaming/nonstreaming requests', async () => {
    const requests: Request[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request)
      const body = await request.clone().json()
      if (body.stream) {
        const chunk = {
          id: 'fixture',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'synthetic-model',
          choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }],
        }
        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
          headers: { 'content-type': 'text/event-stream' },
        })
      }
      return Response.json({
        id: 'fixture',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        data: [{ object: 'embedding', embedding: [0], index: 0 }],
      })
    })
    const options = getOpenAIClientOptions({
      openaiApiKey: 'synthetic-key',
      openaiBaseUrl: 'https://gateway.example/v1',
      openaiDefaultHeaders:
        '{"Authorization":null,"cf-aig-authorization":"Bearer synthetic-gateway","x-remove":null}',
    })
    const client = new OpenAI(options)
    await client.chat.completions.create({ model: 'synthetic-model', messages: [] })
    await client.embeddings.create({ model: 'synthetic-model', input: 'fixture' })
    await chat({
      adapter: openaiCompatibleText('synthetic-model', options),
      messages: [{ role: 'user', content: 'fixture' }],
      stream: false,
    })
    for await (const _chunk of chat({
      adapter: openaiCompatibleText('synthetic-model', options),
      messages: [{ role: 'user', content: 'fixture' }],
      stream: true,
    })) {
      /* consume */
    }
    expect(requests).toHaveLength(4)
    for (const request of requests) {
      expect(request.headers.has('authorization')).toBe(false)
      expect(request.headers.has('x-remove')).toBe(false)
      expect(request.headers.get('cf-aig-authorization')).toBe('Bearer synthetic-gateway')
      expect((await request.json()).provider).toBeUndefined()
    }
  })
})
