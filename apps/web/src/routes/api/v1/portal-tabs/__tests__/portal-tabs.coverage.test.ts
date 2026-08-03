import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

/**
 * Request-level behaviour coverage for the portal-tabs REST routes.
 *
 * These handlers load the portal domain via a dynamic
 * `await import('@/lib/server/domains/portal/index.server')`, so we mock that
 * module path directly — `vi.mock` is hoisted, so the dynamic import resolves to
 * the mock at call time. The auth, authz, validation and response helpers follow
 * the canonical inboxes test pattern. British spelling is used in comments
 * (organisation, behaviour) per repo convention.
 */
const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  getOrgPortalTabConfigMock: vi.fn(),
  setOrgPortalTabConfigMock: vi.fn(),
  getAllSegmentTabOverridesMock: vi.fn(),
  getSegmentTabOverridesMock: vi.fn(),
  setSegmentTabOverridesMock: vi.fn(),
  deleteSegmentTabOverridesMock: vi.fn(),
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

vi.mock('@/lib/server/domains/api/validation', () => ({
  parseTypeId: (...args: unknown[]) => hoisted.parseTypeIdMock(...args),
}))

vi.mock('@/lib/server/domains/portal/index.server', () => ({
  getOrgPortalTabConfig: (...args: unknown[]) => hoisted.getOrgPortalTabConfigMock(...args),
  setOrgPortalTabConfig: (...args: unknown[]) => hoisted.setOrgPortalTabConfigMock(...args),
  getAllSegmentTabOverrides: (...args: unknown[]) => hoisted.getAllSegmentTabOverridesMock(...args),
  getSegmentTabOverrides: (...args: unknown[]) => hoisted.getSegmentTabOverridesMock(...args),
  setSegmentTabOverrides: (...args: unknown[]) => hoisted.setSegmentTabOverridesMock(...args),
  deleteSegmentTabOverrides: (...args: unknown[]) => hoisted.deleteSegmentTabOverridesMock(...args),
}))

import { Route as OrgRoute } from '../index'
import { Route as SegmentsRoute } from '../segments'
import { Route as SegmentDetailRoute } from '../segments.$segmentId'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const orgHandlers = (OrgRoute as unknown as RouteWithHandlers).options.server.handlers
const segmentsHandlers = (SegmentsRoute as unknown as RouteWithHandlers).options.server.handlers
const segmentDetailHandlers = (SegmentDetailRoute as unknown as RouteWithHandlers).options.server
  .handlers

const PRINCIPAL = 'principal_admin'
const SEGMENT = 'segment_123'

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(
  handlerParams: Record<string, string> = {},
  request = new Request('http://test/api/v1/portal-tabs')
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
  hoisted.parseTypeIdMock.mockImplementation((value: string) => value)
})

describe('/api/v1/portal-tabs (org defaults)', () => {
  it('GET reads org portal tab config after scope and permission checks', async () => {
    const config = { feedback: true, roadmap: false, changelog: true }
    hoisted.getOrgPortalTabConfigMock.mockResolvedValue(config)

    const response = await orgHandlers.GET(args())

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(config)
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.PORTAL_MANAGE
    )
    expect(hoisted.loadPermissionSetMock).toHaveBeenCalledWith(PRINCIPAL)
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(
      expect.any(Set),
      PERMISSIONS.PORTAL_MANAGE
    )
    expect(hoisted.getOrgPortalTabConfigMock).toHaveBeenCalledTimes(1)
  })

  it('GET returns 403 when the principal lacks portal.manage', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await orgHandlers.GET(args())

    expect(response.status).toBe(403)
    expect(hoisted.getOrgPortalTabConfigMock).not.toHaveBeenCalled()
  })

  it('PUT replaces org portal tab config and returns the refreshed config', async () => {
    const body = { feedback: false, myTickets: true }
    const refreshed = { feedback: false, myTickets: true, roadmap: true }
    hoisted.setOrgPortalTabConfigMock.mockResolvedValue(undefined)
    hoisted.getOrgPortalTabConfigMock.mockResolvedValue(refreshed)

    const response = await orgHandlers.PUT(
      args({}, jsonRequest('http://test/api/v1/portal-tabs', 'PUT', body))
    )

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(refreshed)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.PORTAL_MANAGE
    )
    expect(hoisted.setOrgPortalTabConfigMock).toHaveBeenCalledWith(body)
    expect(hoisted.getOrgPortalTabConfigMock).toHaveBeenCalledTimes(1)
  })

  it('PUT returns 403 when the principal lacks portal.manage', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await orgHandlers.PUT(
      args({}, jsonRequest('http://test/api/v1/portal-tabs', 'PUT', { feedback: true }))
    )

    expect(response.status).toBe(403)
    expect(hoisted.setOrgPortalTabConfigMock).not.toHaveBeenCalled()
  })

  it('PUT returns 400 for an invalid body and does not write', async () => {
    const response = await orgHandlers.PUT(
      args({}, jsonRequest('http://test/api/v1/portal-tabs', 'PUT', { feedback: 'nope' }))
    )

    expect(response.status).toBe(400)
    expect(hoisted.setOrgPortalTabConfigMock).not.toHaveBeenCalled()
  })

  it('PUT returns 400 when the body is not valid JSON (null fallback)', async () => {
    // Non-JSON body exercises the `.catch(() => null)` branch; z.object rejects null.
    const badRequest = new Request('http://test/api/v1/portal-tabs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })

    const response = await orgHandlers.PUT(args({}, badRequest))

    expect(response.status).toBe(400)
    expect(hoisted.setOrgPortalTabConfigMock).not.toHaveBeenCalled()
  })

  it('GET surfaces domain errors through handleDomainError', async () => {
    hoisted.getOrgPortalTabConfigMock.mockRejectedValue(new Error('boom'))

    const response = await orgHandlers.GET(args())

    expect(response.status).toBe(500)
  })
})

describe('/api/v1/portal-tabs/segments (list overrides)', () => {
  it('GET lists all segment overrides after scope and permission checks', async () => {
    const rows = [{ segmentId: SEGMENT, segmentName: 'VIPs', overrides: { feedback: true } }]
    hoisted.getAllSegmentTabOverridesMock.mockResolvedValue(rows)

    const response = await segmentsHandlers.GET(args())

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(rows)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.PORTAL_MANAGE
    )
    expect(hoisted.getAllSegmentTabOverridesMock).toHaveBeenCalledTimes(1)
  })

  it('GET returns 403 when the principal lacks portal.manage', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await segmentsHandlers.GET(args())

    expect(response.status).toBe(403)
    expect(hoisted.getAllSegmentTabOverridesMock).not.toHaveBeenCalled()
  })

  it('GET surfaces domain errors through handleDomainError', async () => {
    hoisted.getAllSegmentTabOverridesMock.mockRejectedValue(new Error('boom'))

    const response = await segmentsHandlers.GET(args())

    expect(response.status).toBe(500)
  })
})

describe('/api/v1/portal-tabs/segments/:segmentId (per-segment overrides)', () => {
  it('GET reads a segment override after parsing the id', async () => {
    const config = { feedback: true, support: false }
    hoisted.getSegmentTabOverridesMock.mockResolvedValue(config)

    const response = await segmentDetailHandlers.GET(args({ segmentId: SEGMENT }))

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(config)
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(SEGMENT, 'segment', 'segment ID')
    expect(hoisted.getSegmentTabOverridesMock).toHaveBeenCalledWith(SEGMENT)
  })

  it('GET returns 404 when the segment has no overrides', async () => {
    hoisted.getSegmentTabOverridesMock.mockResolvedValue(null)

    const response = await segmentDetailHandlers.GET(args({ segmentId: SEGMENT }))

    expect(response.status).toBe(404)
  })

  it('GET returns 403 when the principal lacks portal.manage', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await segmentDetailHandlers.GET(args({ segmentId: SEGMENT }))

    expect(response.status).toBe(403)
    expect(hoisted.parseTypeIdMock).not.toHaveBeenCalled()
    expect(hoisted.getSegmentTabOverridesMock).not.toHaveBeenCalled()
  })

  it('GET surfaces an invalid id error through handleDomainError', async () => {
    hoisted.parseTypeIdMock.mockImplementation(() => {
      throw new Error('bad id')
    })

    const response = await segmentDetailHandlers.GET(args({ segmentId: 'not-a-segment' }))

    expect(response.status).toBe(500)
    expect(hoisted.getSegmentTabOverridesMock).not.toHaveBeenCalled()
  })

  it('PUT replaces a segment override and returns the refreshed config', async () => {
    const body = { feedback: false, helpCenter: true }
    const refreshed = { feedback: false, helpCenter: true }
    hoisted.setSegmentTabOverridesMock.mockResolvedValue(undefined)
    hoisted.getSegmentTabOverridesMock.mockResolvedValue(refreshed)

    const response = await segmentDetailHandlers.PUT(
      args(
        { segmentId: SEGMENT },
        jsonRequest('http://test/api/v1/portal-tabs/segments/segment_123', 'PUT', body)
      )
    )

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(refreshed)
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(SEGMENT, 'segment', 'segment ID')
    expect(hoisted.setSegmentTabOverridesMock).toHaveBeenCalledWith(SEGMENT, body)
    expect(hoisted.getSegmentTabOverridesMock).toHaveBeenCalledWith(SEGMENT)
  })

  it('PUT returns 403 when the principal lacks portal.manage', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await segmentDetailHandlers.PUT(
      args(
        { segmentId: SEGMENT },
        jsonRequest('http://test/api/v1/portal-tabs/segments/segment_123', 'PUT', {
          feedback: true,
        })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.setSegmentTabOverridesMock).not.toHaveBeenCalled()
  })

  it('PUT returns 400 for an invalid body and does not write', async () => {
    const response = await segmentDetailHandlers.PUT(
      args(
        { segmentId: SEGMENT },
        jsonRequest('http://test/api/v1/portal-tabs/segments/segment_123', 'PUT', {
          changelog: 42,
        })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.setSegmentTabOverridesMock).not.toHaveBeenCalled()
  })

  it('PUT returns 400 when the body is not valid JSON (null fallback)', async () => {
    const badRequest = new Request('http://test/api/v1/portal-tabs/segments/segment_123', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })

    const response = await segmentDetailHandlers.PUT(args({ segmentId: SEGMENT }, badRequest))

    expect(response.status).toBe(400)
    expect(hoisted.setSegmentTabOverridesMock).not.toHaveBeenCalled()
  })

  it('DELETE removes a segment override and returns 204', async () => {
    hoisted.deleteSegmentTabOverridesMock.mockResolvedValue(undefined)

    const response = await segmentDetailHandlers.DELETE(args({ segmentId: SEGMENT }))

    expect(response.status).toBe(204)
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(SEGMENT, 'segment', 'segment ID')
    expect(hoisted.deleteSegmentTabOverridesMock).toHaveBeenCalledWith(SEGMENT)
  })

  it('DELETE returns 403 when the principal lacks portal.manage', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await segmentDetailHandlers.DELETE(args({ segmentId: SEGMENT }))

    expect(response.status).toBe(403)
    expect(hoisted.deleteSegmentTabOverridesMock).not.toHaveBeenCalled()
  })

  it('DELETE surfaces domain errors through handleDomainError', async () => {
    hoisted.deleteSegmentTabOverridesMock.mockRejectedValue(new Error('boom'))

    const response = await segmentDetailHandlers.DELETE(args({ segmentId: SEGMENT }))

    expect(response.status).toBe(500)
  })
})
