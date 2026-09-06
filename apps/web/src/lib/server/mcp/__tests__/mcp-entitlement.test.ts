/**
 * The plan gate on the MCP server, driven through the real request entry point:
 *
 *   handleMcpRequest -> (operator switch) -> auth -> requireEntitlement
 *     -> getCloudConfig -> getWorkspaceSettings -> resolveCloudConfig
 *     -> refuse or connect the transport
 *
 * The oracle for "allowed" is the transport actually being reached, not merely
 * the absence of a throw: `createMcpServer` is asserted called. Both directions
 * per fixture, plus the cloud-off fixture, because `isEntitled()` grants
 * everything when cloud is absent and a fixture that forgot to enable cloud
 * would pass against unwired code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { storedCloud } from '@/lib/server/domains/settings/cloud/__tests__/cloud-fixture'
import type { ApiKey } from '@/lib/server/domains/api-keys'
import type { ApiKeyId, PrincipalId } from '@quackback/ids'

const hoisted = vi.hoisted(() => ({
  mockGetDeveloperConfig: vi.fn(),
  mockGetWorkspaceSettings: vi.fn(),
  mockWithApiKeyAuth: vi.fn(),
  mockCreateMcpServer: vi.fn(),
  mockHandleRequest: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getDeveloperConfig: hoisted.mockGetDeveloperConfig,
  getWorkspaceSettings: hoisted.mockGetWorkspaceSettings,
}))

vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: hoisted.mockWithApiKeyAuth,
}))

vi.mock('../server', () => ({
  createMcpServer: (...args: unknown[]) => {
    hoisted.mockCreateMcpServer(...args)
    return { connect: vi.fn(async () => {}), close: vi.fn(async () => {}) }
  },
}))

vi.mock('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js', () => ({
  WebStandardStreamableHTTPServerTransport: class {
    async handleRequest(request: Request): Promise<Response> {
      hoisted.mockHandleRequest(request)
      return new Response(JSON.stringify({ jsonrpc: '2.0', result: {}, id: 1 }), { status: 200 })
    }
    async close(): Promise<void> {}
  },
}))

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://example.com' },
}))

import { handleMcpRequest } from '../handler'

function withCloud(cloud: unknown): void {
  hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { id: 'ws_1', cloud } })
}

function mcpRequest(): Request {
  return new Request('https://example.com/api/mcp', {
    method: 'POST',
    headers: { authorization: 'Bearer qb_testkey', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockGetDeveloperConfig.mockResolvedValue({
    mcpEnabled: true,
    mcpPortalAccessEnabled: true,
    oauthDynamicClientRegistrationEnabled: true,
  })
  hoisted.mockWithApiKeyAuth.mockResolvedValue({
    apiKey: { id: 'apikey_1' as ApiKeyId, name: 'CI key', scopes: null } as unknown as ApiKey,
    principalId: 'prn_1' as PrincipalId,
    role: 'admin',
    principal: { type: 'service', displayName: 'CI key' },
    importMode: false,
  })
})

describe('handleMcpRequest — no cloud config', () => {
  it.each([
    ['no cloud block at all', null],
    ['an explicitly disabled block', { enabled: false, plan: 'free' }],
  ])('serves the request with %s', async (_label, cloud) => {
    withCloud(cloud)
    const response = await handleMcpRequest(mcpRequest())
    expect(response.status).toBe(200)
    expect(hoisted.mockCreateMcpServer).toHaveBeenCalledOnce()
  })
})

describe('handleMcpRequest — plan gate', () => {
  it('refuses with 402 on a plan without the entitlement and names the plan that has it', async () => {
    withCloud(storedCloud('free'))

    const response = await handleMcpRequest(mcpRequest())

    expect(response.status).toBe(402)
    const body = (await response.json()) as {
      error: { message: string; data: Record<string, unknown> }
    }
    expect(body.error.message).toBe(
      'The MCP server is a Pro feature. Your workspace is on Free. Upgrade to Pro to enable it.'
    )
    expect(body.error.data).toMatchObject({
      error: 'entitlement_required',
      entitlement: 'mcpServer',
      currentPlan: 'free',
      requiredPlan: 'pro',
      requiredPlanName: 'Pro',
    })
    // The server was never built, so no tool could run.
    expect(hoisted.mockCreateMcpServer).not.toHaveBeenCalled()
    expect(hoisted.mockHandleRequest).not.toHaveBeenCalled()
  })

  it('serves the request on a plan that includes it', async () => {
    withCloud(storedCloud('pro'))
    const response = await handleMcpRequest(mcpRequest())
    expect(response.status).toBe(200)
    expect(hoisted.mockCreateMcpServer).toHaveBeenCalledOnce()
  })

  it('honours an explicit override in either direction', async () => {
    withCloud(storedCloud('free', { mcpServer: true }))
    expect((await handleMcpRequest(mcpRequest())).status).toBe(200)

    withCloud(storedCloud('enterprise', { mcpServer: false }))
    expect((await handleMcpRequest(mcpRequest())).status).toBe(402)
  })

  it('does not disclose the plan to an unauthenticated caller', async () => {
    // A 402 naming the workspace's plan is an answer only a caller who already
    // authenticated should get; an anonymous probe still sees the 401.
    withCloud(storedCloud('free'))
    const response = await handleMcpRequest(
      new Request('https://example.com/api/mcp', { method: 'POST' })
    )
    expect(response.status).toBe(401)
  })
})
