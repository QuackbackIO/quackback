import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

// Hoisted mocks for every dependency the segment routes touch. The domain
// service is loaded lazily via `await import(...)` inside each handler, so we
// mock the module path it resolves to and back each export with a hoisted fn.
const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  listSegmentsMock: vi.fn(),
  createSegmentMock: vi.fn(),
  getSegmentMock: vi.fn(),
  updateSegmentMock: vi.fn(),
  deleteSegmentMock: vi.fn(),
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

vi.mock('@/lib/server/domains/segments/segment.service', () => ({
  listSegments: (...args: unknown[]) => hoisted.listSegmentsMock(...args),
  createSegment: (...args: unknown[]) => hoisted.createSegmentMock(...args),
  getSegment: (...args: unknown[]) => hoisted.getSegmentMock(...args),
  updateSegment: (...args: unknown[]) => hoisted.updateSegmentMock(...args),
  deleteSegment: (...args: unknown[]) => hoisted.deleteSegmentMock(...args),
}))

import { Route as SegmentsRoute } from '../index'
import { Route as SegmentDetailRoute } from '../$segmentId'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const segmentsHandlers = (SegmentsRoute as unknown as RouteWithHandlers).options.server.handlers
const segmentDetailHandlers = (SegmentDetailRoute as unknown as RouteWithHandlers).options.server
  .handlers

const PRINCIPAL = 'principal_admin'
const SEGMENT = 'segment_123'
const CREATED_AT = new Date('2026-01-01T00:00:00.000Z')
const UPDATED_AT = new Date('2026-02-02T00:00:00.000Z')

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(
  handlerParams: Record<string, string> = {},
  request = new Request('http://test/api/v1/segments')
) {
  return { request, params: handlerParams }
}

// Base segment row (no memberCount → exercises the false branch of the
// `'memberCount' in s` ternary inside serializeSegment).
function segment(overrides: Record<string, unknown> = {}) {
  return {
    id: SEGMENT,
    name: 'VIPs',
    slug: 'vips',
    description: null,
    type: 'manual',
    color: '#ffffff',
    rules: null,
    evaluationSchedule: null,
    weightConfig: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
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

describe('/api/v1/segments routes', () => {
  it('lists segments and serialises the memberCount branch', async () => {
    // A segment WITH memberCount exercises the true branch of the
    // `'memberCount' in s` ternary in serializeSegment.
    const row = segment({ memberCount: 7 })
    hoisted.listSegmentsMock.mockResolvedValue([row])

    const response = await segmentsHandlers.GET(args())
    expect(response.status).toBe(200)

    const data = await expectJsonData(response)
    expect(data).toEqual([
      {
        id: SEGMENT,
        name: 'VIPs',
        slug: 'vips',
        description: null,
        type: 'manual',
        color: '#ffffff',
        rules: null,
        evaluationSchedule: null,
        weightConfig: null,
        memberCount: 7,
        createdAt: CREATED_AT.toISOString(),
        updatedAt: UPDATED_AT.toISOString(),
      },
    ])
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.SEGMENT_VIEW
    )
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(
      expect.any(Set),
      PERMISSIONS.SEGMENT_VIEW
    )
    expect(hoisted.listSegmentsMock).toHaveBeenCalledWith()
  })

  it('returns 403 when listing without segment.view permission', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await segmentsHandlers.GET(args())
    expect(response.status).toBe(403)
    expect(hoisted.listSegmentsMock).not.toHaveBeenCalled()
  })

  it('maps domain errors thrown while listing to the appropriate response', async () => {
    // A coded NOT_FOUND error flows through handleDomainError → 404, covering
    // the catch block of the GET handler.
    hoisted.listSegmentsMock.mockRejectedValue({ code: 'SEGMENT_NOT_FOUND', message: 'gone' })

    const response = await segmentsHandlers.GET(args())
    expect(response.status).toBe(404)
  })

  it('creates a segment (no memberCount → serialiser omits it)', async () => {
    const row = segment()
    hoisted.createSegmentMock.mockResolvedValue(row)

    const body = { name: 'VIPs', type: 'manual' }
    const response = await segmentsHandlers.POST(
      args({}, jsonRequest('http://test/api/v1/segments', 'POST', body))
    )
    expect(response.status).toBe(201)

    const data = await expectJsonData(response)
    expect(data).not.toHaveProperty('memberCount')
    expect(data.id).toBe(SEGMENT)
    expect(data.createdAt).toBe(CREATED_AT.toISOString())
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.SEGMENT_MANAGE
    )
    expect(hoisted.createSegmentMock).toHaveBeenCalledWith({ name: 'VIPs', type: 'manual' })
  })

  it('returns 403 when creating without segment.manage permission', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await segmentsHandlers.POST(
      args({}, jsonRequest('http://test/api/v1/segments', 'POST', { name: 'VIPs', type: 'manual' }))
    )
    expect(response.status).toBe(403)
    expect(hoisted.createSegmentMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid create body with 400 before calling the service', async () => {
    // Missing required `type`, empty `name` → zod safeParse fails.
    const response = await segmentsHandlers.POST(
      args({}, jsonRequest('http://test/api/v1/segments', 'POST', { name: '' }))
    )
    expect(response.status).toBe(400)
    expect(hoisted.createSegmentMock).not.toHaveBeenCalled()
  })

  it('treats a non-JSON create body as null and rejects it with 400', async () => {
    // `request.json()` rejects → `.catch(() => null)` → safeParse(null) fails.
    const badRequest = new Request('http://test/api/v1/segments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    const response = await segmentsHandlers.POST(args({}, badRequest))
    expect(response.status).toBe(400)
    expect(hoisted.createSegmentMock).not.toHaveBeenCalled()
  })

  it('maps domain errors thrown while creating to the appropriate response', async () => {
    hoisted.createSegmentMock.mockRejectedValue({ code: 'DUPLICATE_SLUG', message: 'dupe' })

    const response = await segmentsHandlers.POST(
      args({}, jsonRequest('http://test/api/v1/segments', 'POST', { name: 'VIPs', type: 'manual' }))
    )
    expect(response.status).toBe(409)
  })
})

describe('/api/v1/segments/$segmentId routes', () => {
  it('fetches a single segment', async () => {
    const row = segment()
    hoisted.getSegmentMock.mockResolvedValue(row)

    const response = await segmentDetailHandlers.GET(args({ segmentId: SEGMENT }))
    expect(response.status).toBe(200)
    expect((await expectJsonData(response)).id).toBe(SEGMENT)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.SEGMENT_VIEW
    )
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(SEGMENT, 'segment', 'segment ID')
    expect(hoisted.getSegmentMock).toHaveBeenCalledWith(SEGMENT)
  })

  it('returns 403 when fetching without segment.view permission', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await segmentDetailHandlers.GET(args({ segmentId: SEGMENT }))
    expect(response.status).toBe(403)
    expect(hoisted.getSegmentMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the segment does not exist', async () => {
    hoisted.getSegmentMock.mockResolvedValue(null)

    const response = await segmentDetailHandlers.GET(args({ segmentId: SEGMENT }))
    expect(response.status).toBe(404)
  })

  it('maps domain errors thrown while fetching to the appropriate response', async () => {
    hoisted.getSegmentMock.mockRejectedValue({ code: 'VALIDATION_ERROR', message: 'bad id' })

    const response = await segmentDetailHandlers.GET(args({ segmentId: SEGMENT }))
    expect(response.status).toBe(400)
  })

  it('updates a segment', async () => {
    const row = segment({ name: 'Premium VIPs' })
    hoisted.updateSegmentMock.mockResolvedValue(row)

    const response = await segmentDetailHandlers.PATCH(
      args(
        { segmentId: SEGMENT },
        jsonRequest('http://test/api/v1/segments/segment_123', 'PATCH', { name: 'Premium VIPs' })
      )
    )
    expect(response.status).toBe(200)
    expect((await expectJsonData(response)).name).toBe('Premium VIPs')
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.SEGMENT_MANAGE
    )
    expect(hoisted.updateSegmentMock).toHaveBeenCalledWith(SEGMENT, { name: 'Premium VIPs' })
  })

  it('returns 403 when updating without segment.manage permission', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await segmentDetailHandlers.PATCH(
      args(
        { segmentId: SEGMENT },
        jsonRequest('http://test/api/v1/segments/segment_123', 'PATCH', { name: 'Premium VIPs' })
      )
    )
    expect(response.status).toBe(403)
    expect(hoisted.updateSegmentMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid update body with 400 before calling the service', async () => {
    // Empty `name` violates the `.min(1)` constraint on the optional field.
    const response = await segmentDetailHandlers.PATCH(
      args(
        { segmentId: SEGMENT },
        jsonRequest('http://test/api/v1/segments/segment_123', 'PATCH', { name: '' })
      )
    )
    expect(response.status).toBe(400)
    expect(hoisted.updateSegmentMock).not.toHaveBeenCalled()
  })

  it('treats a non-JSON update body as null and rejects it with 400', async () => {
    // A malformed body makes `request.json()` reject, so `.catch(() => null)`
    // returns null and updateSegmentBodySchema.safeParse(null) fails → 400.
    const badRequest = new Request('http://test/api/v1/segments/segment_123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    const response = await segmentDetailHandlers.PATCH(args({ segmentId: SEGMENT }, badRequest))
    expect(response.status).toBe(400)
    expect(hoisted.updateSegmentMock).not.toHaveBeenCalled()
  })

  it('maps domain errors thrown while updating to the appropriate response', async () => {
    hoisted.updateSegmentMock.mockRejectedValue({ code: 'SEGMENT_NOT_FOUND', message: 'gone' })

    const response = await segmentDetailHandlers.PATCH(
      args(
        { segmentId: SEGMENT },
        jsonRequest('http://test/api/v1/segments/segment_123', 'PATCH', { name: 'Premium VIPs' })
      )
    )
    expect(response.status).toBe(404)
  })

  it('deletes a segment and returns 204', async () => {
    hoisted.deleteSegmentMock.mockResolvedValue(undefined)

    const response = await segmentDetailHandlers.DELETE(args({ segmentId: SEGMENT }))
    expect(response.status).toBe(204)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.SEGMENT_MANAGE
    )
    expect(hoisted.deleteSegmentMock).toHaveBeenCalledWith(SEGMENT)
  })

  it('returns 403 when deleting without segment.manage permission', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await segmentDetailHandlers.DELETE(args({ segmentId: SEGMENT }))
    expect(response.status).toBe(403)
    expect(hoisted.deleteSegmentMock).not.toHaveBeenCalled()
  })

  it('maps domain errors thrown while deleting to the appropriate response', async () => {
    hoisted.deleteSegmentMock.mockRejectedValue({ code: 'CONFLICT', message: 'in use' })

    const response = await segmentDetailHandlers.DELETE(args({ segmentId: SEGMENT }))
    expect(response.status).toBe(409)
  })
})
