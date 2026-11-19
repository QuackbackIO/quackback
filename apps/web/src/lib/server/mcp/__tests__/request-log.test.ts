import { describe, it, expect, vi, beforeEach } from 'vitest'

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/server/logger', () => ({ logger: log }))

import { logMcpRequest, summarizeMcpRequest } from '../request-log'

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('summarizeMcpRequest', () => {
  it('reads the client and revision from a 2025-era initialize', async () => {
    const summary = await summarizeMcpRequest(
      post(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'openai-mcp', version: '1.0.0' },
          },
        },
        { 'user-agent': 'openai-mcp/1.0.0' }
      )
    )
    expect(summary).toMatchObject({
      methods: ['initialize'],
      protocolVersion: '2025-11-25',
      clientName: 'openai-mcp',
      clientVersion: '1.0.0',
      userAgent: 'openai-mcp/1.0.0',
    })
  })

  it('reads the client and revision from 2026-07-28 _meta and headers', async () => {
    const summary = await summarizeMcpRequest(
      post(
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'search',
            arguments: { query: 'secret customer text' },
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'chatgpt', version: '2' },
            },
          },
        },
        { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call' }
      )
    )
    expect(summary).toMatchObject({
      methods: ['tools/call'],
      tools: ['search'],
      protocolVersion: '2026-07-28',
      mcpMethodHeader: 'tools/call',
      clientName: 'chatgpt',
    })
    // Arguments never enter the summary.
    expect(JSON.stringify(summary)).not.toContain('secret customer text')
  })

  it('lists every method of a batch', async () => {
    const summary = await summarizeMcpRequest(
      post([
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
      ])
    )
    expect(summary.methods).toEqual(['tools/list', 'notifications/initialized'])
  })

  it('survives a body that is not JSON and leaves it readable', async () => {
    const request = post('not json')
    const summary = await summarizeMcpRequest(request)
    expect(summary.methods).toEqual([])
    expect(await request.text()).toBe('not json')
  })
})

describe('logMcpRequest', () => {
  beforeEach(() => vi.clearAllMocks())

  it('records why a request was refused', async () => {
    await logMcpRequest(
      { methods: ['server/discover'], tools: [], protocolVersion: '2026-07-28' },
      json(
        {
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: Unsupported protocol version: 2026-07-28' },
          id: null,
        },
        400
      ),
      Date.now()
    )
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 400,
        mcp_methods: ['server/discover'],
        mcp_protocol_version: '2026-07-28',
        error: 'Bad Request: Unsupported protocol version: 2026-07-28',
      }),
      'mcp request'
    )
  })

  it('records how many tools a client was shown', async () => {
    const response = json({
      jsonrpc: '2.0',
      id: 1,
      result: { tools: [{ name: 'a' }, { name: 'b' }] },
    })
    await logMcpRequest(
      { methods: ['tools/list'], tools: [], authMethod: 'oauth', credentialId: 'client_1' },
      response,
      Date.now()
    )
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 200,
        tool_count: 2,
        auth_method: 'oauth',
        credential_id: 'client_1',
      }),
      'mcp request'
    )
    // The response the client receives is untouched.
    expect((await response.json()).result.tools).toHaveLength(2)
  })

  it('does not read the body of an ordinary successful call', async () => {
    const response = json({ jsonrpc: '2.0', id: 1, result: { content: [] } })
    const clone = vi.spyOn(response, 'clone')
    await logMcpRequest({ methods: ['tools/call'], tools: ['search'] }, response, Date.now())
    expect(clone).not.toHaveBeenCalled()
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ mcp_tools: ['search'], status: 200 }),
      'mcp request'
    )
  })
})
