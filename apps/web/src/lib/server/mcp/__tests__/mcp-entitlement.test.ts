/**
 * The plan gate on the MCP server, driven through the real request entry point:
 *
 *   handleMcpRequest -> (operator switch) -> auth -> isFeatureLive('mcpServer')
 *     -> getPlanLimits -> getCloudConfig -> getWorkspaceSettings -> resolveCloudConfig
 *     -> refuse or connect the transport
 *
 * The oracle for "allowed" is the transport actually being reached, not merely
 * the absence of a throw: `createMcpServer` is asserted called. Both directions
 * per fixture, plus the cloud-off fixture, because `isEntitled()` grants
 * everything when cloud is absent and a fixture that forgot to enable cloud
 * would pass against unwired code.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

// The gate reads the plan limits view through the real settings readers; the
// planLimits flag is off, so the answer is the plan's own grant.
vi.mock('@/lib/server/domains/settings/settings.service', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.service')>()),
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

// The plan limits view reads the settings row itself, so the stored cloud
// block is written to a real settings row as well as served to the settings
// service mock: both readers see the same plan, as they do in production.
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, settings } from '@/lib/server/db'
import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { invalidateTierLimitsCache } from '@/lib/server/domains/settings/tier-limits.service'
import { invalidatePlanLimits } from '@/lib/server/domains/plan-limits/plan-limits.cache'
import { handleMcpRequest } from '../handler'

const fixture = await createDbTestFixture()
afterAll(fixture.close)
beforeEach(fixture.begin)
afterEach(fixture.rollback)

async function withCloud(cloud: unknown): Promise<void> {
  hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { id: 'ws_1', cloud } })
  const [row] = await testDb.select({ id: settings.id }).from(settings).limit(1)
  if (row) {
    await testDb
      .update(settings)
      .set({ cloud: cloud as never, tierLimits: null })
      .where(eq(settings.id, row.id))
  } else {
    await testDb
      .insert(settings)
      .values({ name: 'Acme', slug: 'acme', createdAt: new Date(), cloud: cloud as never })
  }
  invalidateTierLimitsCache()
  await invalidateSettingsCache()
  await invalidatePlanLimits()
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

describe.skipIf(!fixture.available)('handleMcpRequest — no cloud config', () => {
  it.each([
    ['no cloud block at all', null],
    ['an explicitly disabled block', { enabled: false, plan: 'free' }],
  ])('serves the request with %s', async (_label, cloud) => {
    await withCloud(cloud)
    const response = await handleMcpRequest(mcpRequest())
    expect(response.status).toBe(200)
    expect(hoisted.mockCreateMcpServer).toHaveBeenCalledOnce()
  })
})

describe.skipIf(!fixture.available)('handleMcpRequest — plan gate', () => {
  it('refuses with 402 on a plan without the entitlement and names the plan that has it', async () => {
    await withCloud(storedCloud('free'))

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
    await withCloud(storedCloud('pro'))
    const response = await handleMcpRequest(mcpRequest())
    expect(response.status).toBe(200)
    expect(hoisted.mockCreateMcpServer).toHaveBeenCalledOnce()
  })

  it('honours an explicit override in either direction', async () => {
    await withCloud(storedCloud('free', { mcpServer: true }))
    expect((await handleMcpRequest(mcpRequest())).status).toBe(200)

    await withCloud(storedCloud('enterprise', { mcpServer: false }))
    expect((await handleMcpRequest(mcpRequest())).status).toBe(402)
  })

  it('does not disclose the plan to an unauthenticated caller', async () => {
    // A 402 naming the workspace's plan is an answer only a caller who already
    // authenticated should get; an anonymous probe still sees the 401.
    await withCloud(storedCloud('free'))
    const response = await handleMcpRequest(
      new Request('https://example.com/api/mcp', { method: 'POST' })
    )
    expect(response.status).toBe(401)
  })
})
