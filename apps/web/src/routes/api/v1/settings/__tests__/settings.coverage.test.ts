import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

// Request-level behaviour tests for the workspace settings REST routes:
//   - /api/v1/settings/features    (GET, PATCH)
//   - /api/v1/settings/help-center (GET, PATCH)
//
// Both routes are gated by admin.manage_settings and load their domain
// service lazily via dynamic import(), so we mock the shared settings
// service module. Mirrors the canonical inboxes route test structure.

const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  getFeatureFlagsMock: vi.fn(),
  updateFeatureFlagsMock: vi.fn(),
  getHelpCenterConfigMock: vi.fn(),
  updateHelpCenterConfigMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => hoisted.withApiKeyAuthMock(...args),
  assertScopeAllowed: (...args: unknown[]) => hoisted.assertScopeAllowedMock(...args),
}))

vi.mock('@/lib/server/domains/authz/authz.service', () => ({
  loadPermissionSet: (...args: unknown[]) => hoisted.loadPermissionSetMock(...args),
  hasPermission: (...args: unknown[]) => hoisted.hasPermissionMock(...args),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getFeatureFlags: (...args: unknown[]) => hoisted.getFeatureFlagsMock(...args),
  updateFeatureFlags: (...args: unknown[]) => hoisted.updateFeatureFlagsMock(...args),
  getHelpCenterConfig: (...args: unknown[]) => hoisted.getHelpCenterConfigMock(...args),
  updateHelpCenterConfig: (...args: unknown[]) => hoisted.updateHelpCenterConfigMock(...args),
}))

import { Route as FeaturesRoute } from '../features'
import { Route as HelpCenterRoute } from '../help-center'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const featureHandlers = (FeaturesRoute as unknown as RouteWithHandlers).options.server.handlers
const helpCenterHandlers = (HelpCenterRoute as unknown as RouteWithHandlers).options.server.handlers

const PRINCIPAL = 'principal_admin'

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(
  handlerParams: Record<string, string> = {},
  request = new Request('http://test/api/v1/settings/features')
) {
  return { request, params: handlerParams }
}

async function expectJsonData(response: Response) {
  return (await response.json()).data
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.withApiKeyAuthMock.mockResolvedValue({
    principalId: PRINCIPAL,
    role: 'team',
    key: { scopes: [] },
  })
  hoisted.loadPermissionSetMock.mockResolvedValue(new Set<string>())
  hoisted.hasPermissionMock.mockReturnValue(true)
})

describe('/api/v1/settings/features routes', () => {
  it('reads feature flags after scope and permission checks', async () => {
    const flags = {
      helpCenter: true,
      aiFeedbackExtraction: false,
      tickets: true,
      supportInbox: false,
      linkPreviews: true,
    }
    hoisted.getFeatureFlagsMock.mockResolvedValue(flags)

    const response = await featureHandlers.GET(args())

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(flags)
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ADMIN_MANAGE_SETTINGS
    )
    expect(hoisted.loadPermissionSetMock).toHaveBeenCalledWith(PRINCIPAL)
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(
      expect.any(Set),
      PERMISSIONS.ADMIN_MANAGE_SETTINGS
    )
    expect(hoisted.getFeatureFlagsMock).toHaveBeenCalledWith()
  })

  it('returns 403 from GET when the permission check fails', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await featureHandlers.GET(args())

    expect(response.status).toBe(403)
    expect(hoisted.getFeatureFlagsMock).not.toHaveBeenCalled()
  })

  it('returns 500 when reading feature flags throws a domain error', async () => {
    hoisted.getFeatureFlagsMock.mockRejectedValue(new Error('boom'))

    const response = await featureHandlers.GET(args())

    expect(response.status).toBe(500)
  })

  it('toggles feature flags after scope and permission checks', async () => {
    const updated = { helpCenter: false, tickets: true }
    hoisted.updateFeatureFlagsMock.mockResolvedValue(updated)

    const response = await featureHandlers.PATCH(
      args(
        {},
        jsonRequest('http://test/api/v1/settings/features', 'PATCH', {
          helpCenter: false,
          tickets: true,
        })
      )
    )

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(updated)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ADMIN_MANAGE_SETTINGS
    )
    expect(hoisted.updateFeatureFlagsMock).toHaveBeenCalledWith({
      helpCenter: false,
      tickets: true,
    })
  })

  it('accepts an empty partial body when toggling feature flags', async () => {
    hoisted.updateFeatureFlagsMock.mockResolvedValue({})

    const response = await featureHandlers.PATCH(
      args({}, jsonRequest('http://test/api/v1/settings/features', 'PATCH', {}))
    )

    expect(response.status).toBe(200)
    expect(hoisted.updateFeatureFlagsMock).toHaveBeenCalledWith({})
  })

  it('returns 403 from PATCH when the permission check fails', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await featureHandlers.PATCH(
      args({}, jsonRequest('http://test/api/v1/settings/features', 'PATCH', { helpCenter: true }))
    )

    expect(response.status).toBe(403)
    expect(hoisted.updateFeatureFlagsMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid feature-flags body with 400', async () => {
    const response = await featureHandlers.PATCH(
      args(
        {},
        jsonRequest('http://test/api/v1/settings/features', 'PATCH', {
          helpCenter: 'not-a-boolean',
        })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.updateFeatureFlagsMock).not.toHaveBeenCalled()
  })

  it('rejects a non-JSON feature-flags body with 400', async () => {
    // request.json() rejects on invalid JSON; the route swallows that to null,
    // which then fails safeParse (object expected) and returns 400.
    const request = new Request('http://test/api/v1/settings/features', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })

    const response = await featureHandlers.PATCH({ request, params: {} })

    expect(response.status).toBe(400)
    expect(hoisted.updateFeatureFlagsMock).not.toHaveBeenCalled()
  })

  it('returns 500 when toggling feature flags throws a domain error', async () => {
    hoisted.updateFeatureFlagsMock.mockRejectedValue(new Error('boom'))

    const response = await featureHandlers.PATCH(
      args({}, jsonRequest('http://test/api/v1/settings/features', 'PATCH', { tickets: false }))
    )

    expect(response.status).toBe(500)
  })
})

describe('/api/v1/settings/help-center routes', () => {
  it('reads help-center config after scope and permission checks', async () => {
    const config = {
      enabled: true,
      homepageTitle: 'Help Centre',
      homepageDescription: 'Find answers fast',
    }
    hoisted.getHelpCenterConfigMock.mockResolvedValue(config)

    const response = await helpCenterHandlers.GET(
      args({}, new Request('http://test/api/v1/settings/help-center'))
    )

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(config)
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ADMIN_MANAGE_SETTINGS
    )
    expect(hoisted.loadPermissionSetMock).toHaveBeenCalledWith(PRINCIPAL)
    expect(hoisted.getHelpCenterConfigMock).toHaveBeenCalledWith()
  })

  it('returns 403 from GET when the permission check fails', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await helpCenterHandlers.GET(
      args({}, new Request('http://test/api/v1/settings/help-center'))
    )

    expect(response.status).toBe(403)
    expect(hoisted.getHelpCenterConfigMock).not.toHaveBeenCalled()
  })

  it('returns 500 when reading help-center config throws a domain error', async () => {
    hoisted.getHelpCenterConfigMock.mockRejectedValue(new Error('boom'))

    const response = await helpCenterHandlers.GET(
      args({}, new Request('http://test/api/v1/settings/help-center'))
    )

    expect(response.status).toBe(500)
  })

  it('updates help-center config after scope and permission checks', async () => {
    const updated = {
      enabled: false,
      homepageTitle: 'Support',
      homepageDescription: '',
    }
    hoisted.updateHelpCenterConfigMock.mockResolvedValue(updated)

    const response = await helpCenterHandlers.PATCH(
      args(
        {},
        jsonRequest('http://test/api/v1/settings/help-center', 'PATCH', {
          enabled: false,
          homepageTitle: 'Support',
        })
      )
    )

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(updated)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ADMIN_MANAGE_SETTINGS
    )
    expect(hoisted.updateHelpCenterConfigMock).toHaveBeenCalledWith({
      enabled: false,
      homepageTitle: 'Support',
    })
  })

  it('returns 403 from PATCH when the permission check fails', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await helpCenterHandlers.PATCH(
      args({}, jsonRequest('http://test/api/v1/settings/help-center', 'PATCH', { enabled: true }))
    )

    expect(response.status).toBe(403)
    expect(hoisted.updateHelpCenterConfigMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid help-center body with 400', async () => {
    // homepageTitle has a min(1) constraint, so an empty string fails safeParse.
    const response = await helpCenterHandlers.PATCH(
      args(
        {},
        jsonRequest('http://test/api/v1/settings/help-center', 'PATCH', {
          homepageTitle: '',
        })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.updateHelpCenterConfigMock).not.toHaveBeenCalled()
  })

  it('rejects a non-JSON help-center body with 400', async () => {
    const request = new Request('http://test/api/v1/settings/help-center', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })

    const response = await helpCenterHandlers.PATCH({ request, params: {} })

    expect(response.status).toBe(400)
    expect(hoisted.updateHelpCenterConfigMock).not.toHaveBeenCalled()
  })

  it('returns 500 when updating help-center config throws a domain error', async () => {
    hoisted.updateHelpCenterConfigMock.mockRejectedValue(new Error('boom'))

    const response = await helpCenterHandlers.PATCH(
      args({}, jsonRequest('http://test/api/v1/settings/help-center', 'PATCH', { enabled: true }))
    )

    expect(response.status).toBe(500)
  })
})
