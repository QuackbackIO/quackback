import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  listBusinessHoursMock: vi.fn(),
  createBusinessHoursMock: vi.fn(),
  getBusinessHoursMock: vi.fn(),
  updateBusinessHoursMock: vi.fn(),
  archiveBusinessHoursMock: vi.fn(),
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

vi.mock('@/lib/server/domains/sla', () => ({
  listBusinessHours: (...args: unknown[]) => hoisted.listBusinessHoursMock(...args),
  createBusinessHours: (...args: unknown[]) => hoisted.createBusinessHoursMock(...args),
  getBusinessHours: (...args: unknown[]) => hoisted.getBusinessHoursMock(...args),
  updateBusinessHours: (...args: unknown[]) => hoisted.updateBusinessHoursMock(...args),
  archiveBusinessHours: (...args: unknown[]) => hoisted.archiveBusinessHoursMock(...args),
}))

import { Route as DetailRoute } from '../$id'
import { Route as IndexRoute } from '../index'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const indexHandlers = (IndexRoute as unknown as RouteWithHandlers).options.server.handlers
const detailHandlers = (DetailRoute as unknown as RouteWithHandlers).options.server.handlers

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(
  params: Record<string, string> = {},
  request = new Request('http://test/api/v1/business-hours')
) {
  return { request, params }
}

async function data(response: Response) {
  return ((await response.json()) as { data: unknown }).data
}

function schedule() {
  return {
    mon: [{ start: '09:00', end: '17:00' }],
    tue: [{ start: '09:00', end: '17:00' }],
    wed: [{ start: '09:00', end: '17:00' }],
    thu: [{ start: '09:00', end: '17:00' }],
    fri: [{ start: '09:00', end: '17:00' }],
    sat: [],
    sun: [],
  }
}

function businessHours(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bizhrs_support',
    name: 'Support hours',
    timezone: 'Europe/Berlin',
    schedule: schedule(),
    holidays: [],
    archivedAt: null,
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
    updatedAt: new Date('2026-01-01T11:00:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.withApiKeyAuthMock.mockResolvedValue({
    principalId: 'principal_agent',
    role: 'team',
    key: { scopes: [] },
  })
  hoisted.loadPermissionSetMock.mockResolvedValue(new Set<string>())
  hoisted.hasPermissionMock.mockReturnValue(true)
  hoisted.parseTypeIdMock.mockImplementation((value: string) => value)
  hoisted.listBusinessHoursMock.mockResolvedValue([businessHours()])
  hoisted.createBusinessHoursMock.mockResolvedValue(businessHours({ id: 'bizhrs_new' }))
  hoisted.getBusinessHoursMock.mockResolvedValue(businessHours())
  hoisted.updateBusinessHoursMock.mockResolvedValue(businessHours({ name: 'Updated hours' }))
  hoisted.archiveBusinessHoursMock.mockResolvedValue(businessHours({ archivedAt: new Date() }))
})

describe('/api/v1/business-hours routes', () => {
  it('lists calendars with SLA view scope, permission, and includeArchived query support', async () => {
    const response = await indexHandlers.GET(
      args({}, new Request('http://test/api/v1/business-hours?includeArchived=true'))
    )

    expect(response.status).toBe(200)
    // Dates are serialized to ISO strings through the JSON response body.
    expect(await data(response)).toEqual(JSON.parse(JSON.stringify([businessHours()])))
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.loadPermissionSetMock).toHaveBeenCalledWith('principal_agent')
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.SLA_VIEW
    )
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(expect.any(Set), PERMISSIONS.SLA_VIEW)
    expect(hoisted.listBusinessHoursMock).toHaveBeenCalledWith({ includeArchived: true })
  })

  it('creates calendars after business-hours manage checks and rejects invalid create bodies', async () => {
    const body = {
      name: 'Support hours',
      timezone: 'Europe/Berlin',
      schedule: schedule(),
      holidays: [{ date: '2026-12-25', label: 'Christmas' }],
    }

    const response = await indexHandlers.POST(
      args({}, jsonRequest('http://test/api/v1/business-hours', 'POST', body))
    )

    expect(response.status).toBe(201)
    expect(await data(response)).toMatchObject({ id: 'bizhrs_new' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.BUSINESS_HOURS_MANAGE
    )
    expect(hoisted.createBusinessHoursMock).toHaveBeenCalledWith(body)

    vi.clearAllMocks()
    hoisted.withApiKeyAuthMock.mockResolvedValue({ principalId: 'principal_agent', role: 'team' })
    hoisted.loadPermissionSetMock.mockResolvedValue(new Set<string>())
    hoisted.hasPermissionMock.mockReturnValue(true)

    const invalid = await indexHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/business-hours', 'POST', {
          name: '',
          schedule: { mon: [{ start: '99:99', end: '17:00' }] },
        })
      )
    )
    expect(invalid.status).toBe(400)
    expect(hoisted.createBusinessHoursMock).not.toHaveBeenCalled()
  })

  it('gets, patches, archives, and returns not found for one calendar', async () => {
    hoisted.parseTypeIdMock.mockReturnValue('bizhrs_support')

    const getResponse = await detailHandlers.GET(
      args(
        { id: 'bizhrs_support' },
        new Request('http://test/api/v1/business-hours/bizhrs_support')
      )
    )
    expect(getResponse.status).toBe(200)
    expect(await data(getResponse)).toMatchObject({ id: 'bizhrs_support' })
    expect(hoisted.getBusinessHoursMock).toHaveBeenCalledWith('bizhrs_support')

    hoisted.getBusinessHoursMock.mockResolvedValueOnce(null)
    const missing = await detailHandlers.GET(
      args(
        { id: 'bizhrs_missing' },
        new Request('http://test/api/v1/business-hours/bizhrs_missing')
      )
    )
    expect(missing.status).toBe(404)

    const patchBody = {
      name: 'Updated hours',
      timezone: 'Europe/London',
      holidays: [{ date: '2026-01-01' }],
    }
    const patchResponse = await detailHandlers.PATCH(
      args(
        { id: 'bizhrs_support' },
        jsonRequest('http://test/api/v1/business-hours/bizhrs_support', 'PATCH', patchBody)
      )
    )
    expect(patchResponse.status).toBe(200)
    expect(await data(patchResponse)).toMatchObject({ name: 'Updated hours' })
    expect(hoisted.updateBusinessHoursMock).toHaveBeenCalledWith('bizhrs_support', patchBody)

    const deleteResponse = await detailHandlers.DELETE(
      args(
        { id: 'bizhrs_support' },
        new Request('http://test/api/v1/business-hours/bizhrs_support', { method: 'DELETE' })
      )
    )
    expect(deleteResponse.status).toBe(204)
    expect(hoisted.archiveBusinessHoursMock).toHaveBeenCalledWith('bizhrs_support')
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(
      'bizhrs_support',
      'bizhrs',
      'business hours ID'
    )
  })

  it('rejects invalid patch bodies before mutating', async () => {
    const response = await detailHandlers.PATCH(
      args(
        { id: 'bizhrs_support' },
        jsonRequest('http://test/api/v1/business-hours/bizhrs_support', 'PATCH', {
          timezone: '',
          holidays: [{ date: 'tomorrow' }],
        })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.updateBusinessHoursMock).not.toHaveBeenCalled()
  })

  it('returns 403 before service calls when route-level permissions are missing', async () => {
    const cases = [
      [indexHandlers.GET, args()],
      [indexHandlers.POST, args({}, jsonRequest('http://test/api/v1/business-hours', 'POST', {}))],
      [detailHandlers.GET, args({ id: 'bizhrs_support' })],
      [
        detailHandlers.PATCH,
        args(
          { id: 'bizhrs_support' },
          jsonRequest('http://test/api/v1/business-hours/bizhrs_support', 'PATCH', {})
        ),
      ],
      [detailHandlers.DELETE, args({ id: 'bizhrs_support' })],
    ] as const
    hoisted.hasPermissionMock.mockReturnValue(false)

    for (const [handler, handlerArgs] of cases) {
      const response = await handler(handlerArgs)
      expect(response.status).toBe(403)
    }

    expect(hoisted.listBusinessHoursMock).not.toHaveBeenCalled()
    expect(hoisted.createBusinessHoursMock).not.toHaveBeenCalled()
    expect(hoisted.getBusinessHoursMock).not.toHaveBeenCalled()
    expect(hoisted.updateBusinessHoursMock).not.toHaveBeenCalled()
    expect(hoisted.archiveBusinessHoursMock).not.toHaveBeenCalled()
  })
})
