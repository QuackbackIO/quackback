/**
 * MCP conformance for both protocol eras, driven through the real request
 * entry point (handleMcpRequest) with only auth, settings and the one domain
 * read the calls reach mocked.
 *
 * - 2026-07-28 ("modern"): stateless requests that carry their revision in a
 *   per-request `_meta` envelope plus the MCP-Protocol-Version, Mcp-Method and
 *   Mcp-Name headers. No initialize.
 * - 2025-11-25 ("legacy"): initialize, notifications/initialized, then plain
 *   JSON-RPC, answered as JSON.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ApiKey } from '@/lib/server/domains/api-keys'
import type { ApiKeyId, PrincipalId } from '@quackback/ids'

const hoisted = vi.hoisted(() => ({
  devConfig: vi.fn(),
  withApiKeyAuth: vi.fn(),
  verifyAccessTokenRequest: vi.fn(),
  recordAuditEvent: vi.fn(async (_input: unknown) => undefined),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getDeveloperConfig: hoisted.devConfig,
  getWorkspaceSettings: vi.fn().mockResolvedValue(null),
  isFeatureEnabled: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({ withApiKeyAuth: hoisted.withApiKeyAuth }))
vi.mock('better-auth/oauth2', () => ({
  verifyAccessTokenRequest: hoisted.verifyAccessTokenRequest,
  requestToResourceInput: vi.fn(() => ({})),
}))
vi.mock('../oauth-principal', () => ({
  readOAuthPrincipal: vi.fn(async () => ({ role: 'admin', clientName: 'Test client' })),
}))
vi.mock('@/lib/server/policy/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/policy/permissions')>()
  return {
    ...actual,
    permissionsForPrincipal: async (_id: unknown, role: 'admin' | 'member' | 'user') =>
      actual.permissionsForLegacyRole(role),
  }
})
vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://example.com', trustedProxyHops: 1 },
  getBaseUrl: () => 'https://example.com',
}))
vi.mock('@/lib/server/domains/settings/widget-install-pairing', () => ({
  getWidgetInstallStatus: vi.fn(async () => ({
    connected: true,
    enabled: true,
    lastDetectedAt: null,
    originHost: null,
    sdkVersion: null,
    currentSdkVersion: '1.0.0',
    sdkNeedsUpdate: false,
  })),
}))
vi.mock('@/lib/server/audit/log', () => ({ recordAuditEvent: hoisted.recordAuditEvent }))

import { handleMcpRequest } from '../handler'
import { mcpServerVersion } from '../server'
import { MCP_MAX_REQUEST_BYTES, MCP_UPLOAD_MAX_BYTES } from '../tools/files'

const MODERN = '2026-07-28'
const LEGACY = '2025-11-25'
const URL = 'https://example.com/api/mcp'

type Rpc = {
  jsonrpc: '2.0'
  id?: number
  result?: Record<string, unknown> & { _meta?: Record<string, unknown> }
  error?: { code: number; message: string; data?: Record<string, unknown> }
}

const ENVELOPE = {
  'io.modelcontextprotocol/protocolVersion': MODERN,
  'io.modelcontextprotocol/clientInfo': { name: 'conformance', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
}

function post(body: unknown, headers: Record<string, string>, token = 'qb_testkey'): Request {
  return new Request(URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

/** A 2026-07-28 request: envelope in `_meta`, revision and method in headers. */
function modern(
  method: string,
  params: Record<string, unknown> = {},
  opts: { name?: string; headers?: Record<string, string>; id?: number; token?: string } = {}
): Request {
  return post(
    { jsonrpc: '2.0', id: opts.id ?? 1, method, params: { ...params, _meta: ENVELOPE } },
    {
      'mcp-protocol-version': MODERN,
      'mcp-method': method,
      ...(opts.name ? { 'mcp-name': opts.name } : {}),
      ...opts.headers,
    },
    opts.token
  )
}

/** A 2025-era request after the handshake. */
function legacy(method: string, params?: Record<string, unknown>, id: number | null = 1): Request {
  return post(
    { jsonrpc: '2.0', ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) },
    { 'mcp-protocol-version': LEGACY }
  )
}

async function json(response: Response): Promise<Rpc> {
  expect(response.headers.get('content-type') ?? '').toContain('application/json')
  return (await response.json()) as Rpc
}

function apiKeyAs(role: 'admin' | 'user' = 'admin') {
  hoisted.withApiKeyAuth.mockResolvedValue({
    apiKey: { id: 'apikey_1' as ApiKeyId, name: 'CI key', scopes: null } as unknown as ApiKey,
    principalId: 'principal_1' as PrincipalId,
    role,
    principal: { type: 'service', displayName: 'CI key' },
    importMode: false,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.devConfig.mockResolvedValue({ mcpEnabled: true, mcpPortalAccessEnabled: true })
  apiKeyAs('admin')
})

describe('MCP 2026-07-28 (stateless, per-request envelope)', () => {
  it('answers server/discover with the modern revision, cache fields and server identity', async () => {
    const response = await handleMcpRequest(modern('server/discover'))
    expect(response.status).toBe(200)
    const { result } = await json(response)
    expect(result).toMatchObject({
      supportedVersions: [MODERN],
      resultType: 'complete',
      ttlMs: 5 * 60 * 1000,
      cacheScope: 'private',
      capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
    })
    expect(result?.instructions).toEqual(expect.any(String))
    expect(result?._meta?.['io.modelcontextprotocol/serverInfo']).toEqual({
      name: 'quackback',
      version: mcpServerVersion(),
    })
  })

  it('lists tools without initialize, cacheable and private, with titles and declared scopes', async () => {
    const response = await handleMcpRequest(modern('tools/list'))
    expect(response.status).toBe(200)
    const { result } = await json(response)
    expect(result).toMatchObject({
      resultType: 'complete',
      ttlMs: 5 * 60 * 1000,
      cacheScope: 'private',
    })
    const tools = result?.tools as {
      name: string
      title?: string
      inputSchema: { $schema?: string }
      _meta?: { securitySchemes?: unknown }
      securitySchemes?: unknown
      outputSchema?: { type?: string }
    }[]
    expect(tools).toHaveLength(44)
    const search = tools.find((tool) => tool.name === 'search')
    expect(search?.title).toBe('Search workspace')
    const schemes = [{ type: 'oauth2', scopes: ['read:feedback', 'read:article'] }]
    // Top level for OpenAI's Apps SDK, and the `_meta` mirror it documents.
    expect(search?.securitySchemes).toEqual(schemes)
    expect(search?._meta?.securitySchemes).toEqual(schemes)
    expect(search?.inputSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    // Read tools list an output schema; write tools do not.
    expect(search?.outputSchema?.type).toBe('object')
    expect(tools.find((tool) => tool.name === 'create_post')?.outputSchema).toBeUndefined()
  })

  it('lists the same tools for every caller', async () => {
    const asAdmin = await json(await handleMcpRequest(modern('tools/list')))
    apiKeyAs('user')
    const asPortalUser = await json(await handleMcpRequest(modern('tools/list')))
    expect(asPortalUser.result?.tools).toEqual(asAdmin.result?.tools)
  })

  it('lists and reads resources with cache fields', async () => {
    const list = await json(await handleMcpRequest(modern('resources/list')))
    expect(list.result).toMatchObject({ ttlMs: 5 * 60 * 1000, cacheScope: 'private' })

    const read = await json(
      await handleMcpRequest(
        modern('resources/read', { uri: 'quackback://nope' }, { name: 'quackback://nope' })
      )
    )
    // Resource not found is -32602 (Invalid Params) on 2026-07-28.
    expect(read.error?.code).toBe(-32602)
  })

  it('calls a tool and marks the result complete', async () => {
    const response = await handleMcpRequest(
      modern(
        'tools/call',
        { name: 'widget_install_status', arguments: {} },
        { name: 'widget_install_status', id: 7 }
      )
    )
    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body.id).toBe(7)
    expect(body.result).toMatchObject({ resultType: 'complete' })
    expect(body.result?.isError).not.toBe(true)
    const [content] = body.result?.content as { type: string; text: string }[]
    expect(JSON.parse(content.text)).toMatchObject({ connected: true })
    // The same body, structured, for clients that read the output schema.
    expect(body.result?.structuredContent).toEqual(JSON.parse(content.text))
  })

  it('refuses a revision it does not serve and names the one it does', async () => {
    const request = post(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: { ...ENVELOPE, 'io.modelcontextprotocol/protocolVersion': '2099-01-01' },
        },
      },
      { 'mcp-protocol-version': '2099-01-01', 'mcp-method': 'tools/list' }
    )
    const response = await handleMcpRequest(request)
    expect(response.status).toBe(400)
    const { error } = await json(response)
    expect(error?.message).toMatch(/Unsupported protocol version/)
    expect(error?.data?.supported).toEqual([MODERN])
  })

  it('refuses a request whose Mcp-Method header disagrees with the body', async () => {
    const response = await handleMcpRequest(
      modern('tools/list', {}, { headers: { 'mcp-method': 'tools/call' } })
    )
    expect(response.status).toBe(400)
    expect((await json(response)).error?.code).toBe(-32020)
  })

  it('refuses a request whose Mcp-Name header disagrees with the tool called', async () => {
    const response = await handleMcpRequest(
      modern(
        'tools/call',
        { name: 'widget_install_status', arguments: {} },
        { name: 'get_settings' }
      )
    )
    expect(response.status).toBe(400)
    expect((await json(response)).error?.code).toBe(-32020)
  })

  it('answers a step-up with a complete tool result and the RFC 6750 challenge', async () => {
    hoisted.verifyAccessTokenRequest.mockResolvedValue({
      sub: 'user_1',
      principalId: 'principal_1',
      scope: 'read:feedback',
      name: 'Jane',
    })
    const response = await handleMcpRequest(
      modern(
        'tools/call',
        { name: 'get_settings', arguments: {} },
        { name: 'get_settings', id: 3, token: 'oauth.jwt.token' }
      )
    )
    expect(response.status).toBe(403)
    expect(response.headers.get('www-authenticate')).toMatch(/error="insufficient_scope"/)
    const body = await json(response)
    expect(body.id).toBe(3)
    expect(body.result).toMatchObject({ isError: true, resultType: 'complete' })
  })

  it('answers its own refusals with an implementation-range code and the request id', async () => {
    hoisted.devConfig.mockResolvedValue({ mcpEnabled: false })
    const response = await handleMcpRequest(modern('tools/list', {}, { id: 42 }))
    expect(response.status).toBe(403)
    const body = await json(response)
    expect(body.id).toBe(42)
    expect(body.error?.code).toBeLessThanOrEqual(-32000)
    expect(body.error?.code).toBeGreaterThanOrEqual(-32019)
  })
})

describe('MCP 2025-11-25 (initialize, then stateless JSON)', () => {
  it('completes initialize → notifications/initialized → tools/list → tools/call', async () => {
    const init = await handleMcpRequest(
      post(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: LEGACY,
            capabilities: {},
            clientInfo: { name: 'legacy-client', version: '1.0.0' },
          },
        },
        {}
      )
    )
    expect(init.status).toBe(200)
    const initialized = await json(init)
    expect(initialized.result).toMatchObject({
      protocolVersion: LEGACY,
      serverInfo: { name: 'quackback', version: mcpServerVersion() },
    })
    expect(initialized.result?.instructions).toEqual(expect.any(String))

    const notified = await handleMcpRequest(legacy('notifications/initialized', undefined, null))
    expect(notified.status).toBe(202)

    const list = await json(await handleMcpRequest(legacy('tools/list')))
    expect(list.result?.tools).toHaveLength(44)
    const legacySearch = (list.result?.tools as { name: string; securitySchemes?: unknown }[]).find(
      (tool) => tool.name === 'search'
    )
    expect(legacySearch?.securitySchemes).toEqual([
      { type: 'oauth2', scopes: ['read:feedback', 'read:article'] },
    ])
    // 2026-only fields never reach a 2025 client.
    expect(list.result).not.toHaveProperty('resultType')
    expect(list.result).not.toHaveProperty('ttlMs')
    expect(list.result).not.toHaveProperty('cacheScope')

    const call = await json(
      await handleMcpRequest(
        legacy('tools/call', { name: 'widget_install_status', arguments: {} }, 2)
      )
    )
    expect(call.id).toBe(2)
    expect(call.result?.isError).not.toBe(true)
    expect(call.result?.structuredContent).toMatchObject({ connected: true })
    expect(call.result).not.toHaveProperty('resultType')
  })

  it('downgrades a client that offers 2026-07-28 in initialize to the newest 2025 revision', async () => {
    const response = await handleMcpRequest(
      post(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: MODERN,
            capabilities: {},
            clientInfo: { name: 'eager-client', version: '1.0.0' },
          },
        },
        {}
      )
    )
    expect(response.status).toBe(200)
    expect((await json(response)).result?.protocolVersion).toBe(LEGACY)
  })

  it('takes a body up to the request cap upload_file needs, on either era', async () => {
    // The cap fits upload_file's full limit as base64 (upload-size.test.ts).
    const pad = 'x'.repeat(MCP_UPLOAD_MAX_BYTES + 1024)
    expect((await handleMcpRequest(legacy('tools/list', { _meta: { pad } }))).status).toBe(200)
  })

  it('refuses a body over the cap with a 413 that says what the limit is for', async () => {
    const pad = 'x'.repeat(MCP_MAX_REQUEST_BYTES + 1)
    const request = legacy('tools/list', { _meta: { pad } })
    // As a real HTTP client sends it; the cap is checked before the body is read.
    const sized = new Request(request, {
      headers: {
        ...Object.fromEntries(request.headers),
        'content-length': String(pad.length + 200),
      },
    })
    const response = await handleMcpRequest(sized)
    expect(response.status).toBe(413)
    expect(JSON.stringify(await response.json())).toContain('upload_file accepts files up to')
  })

  it('records the caller’s address and user agent on an audited tool call', async () => {
    apiKeyAs('user')
    const request = post(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'update_settings', arguments: { area: 'portal', patch: {} } },
      },
      {
        'mcp-protocol-version': LEGACY,
        'user-agent': 'claude-desktop/1.0',
        'x-forwarded-for': '198.51.100.7',
      }
    )
    await handleMcpRequest(request)
    expect(hoisted.recordAuditEvent).toHaveBeenCalledOnce()
    const event = hoisted.recordAuditEvent.mock.calls[0][0] as {
      event: string
      headers?: Headers
    }
    expect(event.event).toBe('mcp.tool_call')
    expect(event.headers?.get('user-agent')).toBe('claude-desktop/1.0')
    expect(event.headers?.get('x-forwarded-for')).toBe('198.51.100.7')
  })
})
