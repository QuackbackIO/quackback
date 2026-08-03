import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

// Hoisted mocks for every dependency the user-attribute routes touch. The route
// handlers pull the user-attribute service in via a dynamic `await import(...)`,
// so mocking the module path below means those calls resolve to these spies.
const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  listUserAttributesMock: vi.fn(),
  createUserAttributeMock: vi.fn(),
  updateUserAttributeMock: vi.fn(),
  deleteUserAttributeMock: vi.fn(),
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

vi.mock('@/lib/server/domains/user-attributes/user-attribute.service', () => ({
  listUserAttributes: (...args: unknown[]) => hoisted.listUserAttributesMock(...args),
  createUserAttribute: (...args: unknown[]) => hoisted.createUserAttributeMock(...args),
  updateUserAttribute: (...args: unknown[]) => hoisted.updateUserAttributeMock(...args),
  deleteUserAttribute: (...args: unknown[]) => hoisted.deleteUserAttributeMock(...args),
}))

import { Route as AttributeDetailRoute } from '../$attributeId'
import { Route as AttributesRoute } from '../index'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const listHandlers = (AttributesRoute as unknown as RouteWithHandlers).options.server.handlers
const detailHandlers = (AttributeDetailRoute as unknown as RouteWithHandlers).options.server
  .handlers

const PRINCIPAL = 'principal_admin'
const ATTRIBUTE = 'user_attr_123'

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(
  handlerParams: Record<string, string> = {},
  request = new Request('http://test/api/v1/user-attributes')
) {
  return { request, params: handlerParams }
}

// A row as returned by the service (Date objects), mirroring the UserAttribute
// shape so the serialiser exercises every field, including the non-null
// description / currencyCode / externalKey columns.
function attributeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTRIBUTE,
    key: 'plan_tier',
    label: 'Plan tier',
    description: 'The customer plan tier',
    type: 'currency',
    currencyCode: 'GBP',
    externalKey: 'planTier',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    ...overrides,
  }
}

// The serialised projection the routes return — Date fields become ISO strings.
function serialisedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTRIBUTE,
    key: 'plan_tier',
    label: 'Plan tier',
    description: 'The customer plan tier',
    type: 'currency',
    currencyCode: 'GBP',
    externalKey: 'planTier',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
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

describe('/api/v1/user-attributes index route', () => {
  it('lists definitions after scope and permission checks, serialising every field', async () => {
    const row = attributeRow()
    hoisted.listUserAttributesMock.mockResolvedValue([row])

    const response = await listHandlers.GET(args())

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual([serialisedRow()])
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.USER_ATTRIBUTE_VIEW
    )
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(
      expect.any(Set),
      PERMISSIONS.USER_ATTRIBUTE_VIEW
    )
    expect(hoisted.listUserAttributesMock).toHaveBeenCalledWith()
  })

  it('returns 403 and skips the service when view permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await listHandlers.GET(args())

    expect(response.status).toBe(403)
    expect(hoisted.listUserAttributesMock).not.toHaveBeenCalled()
  })

  it('creates a definition after scope and permission checks', async () => {
    const row = attributeRow()
    hoisted.createUserAttributeMock.mockResolvedValue(row)

    const response = await listHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/user-attributes', 'POST', {
          key: 'plan_tier',
          label: 'Plan tier',
          description: 'The customer plan tier',
          type: 'currency',
          currencyCode: 'GBP',
          externalKey: 'planTier',
        })
      )
    )

    expect(response.status).toBe(201)
    expect(await expectJsonData(response)).toEqual(serialisedRow())
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.USER_ATTRIBUTE_MANAGE
    )
    expect(hoisted.createUserAttributeMock).toHaveBeenCalledWith({
      key: 'plan_tier',
      label: 'Plan tier',
      description: 'The customer plan tier',
      type: 'currency',
      currencyCode: 'GBP',
      externalKey: 'planTier',
    })
  })

  it('returns 403 and skips the service when manage permission is missing on create', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await listHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/user-attributes', 'POST', {
          key: 'k',
          label: 'L',
          type: 'string',
        })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.createUserAttributeMock).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid create body without calling the service', async () => {
    const response = await listHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/user-attributes', 'POST', {
          key: '',
          label: '',
          type: 'nope',
        })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.createUserAttributeMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the create body is not valid JSON', async () => {
    // request.json() rejects → caught as null → schema rejects null.
    const response = await listHandlers.POST(
      args(
        {},
        new Request('http://test/api/v1/user-attributes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not-json',
        })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.createUserAttributeMock).not.toHaveBeenCalled()
  })
})

describe('/api/v1/user-attributes/$attributeId route', () => {
  it('fetches one definition after scope and permission checks', async () => {
    const row = attributeRow()
    hoisted.listUserAttributesMock.mockResolvedValue([row])

    const response = await detailHandlers.GET(args({ attributeId: ATTRIBUTE }))

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(serialisedRow())
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.USER_ATTRIBUTE_VIEW
    )
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(
      ATTRIBUTE,
      'user_attr',
      'user attribute ID'
    )
  })

  it('returns 403 and skips the lookup when view permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await detailHandlers.GET(args({ attributeId: ATTRIBUTE }))

    expect(response.status).toBe(403)
    expect(hoisted.listUserAttributesMock).not.toHaveBeenCalled()
  })

  it('returns 404 when no definition matches the parsed id', async () => {
    hoisted.listUserAttributesMock.mockResolvedValue([attributeRow({ id: 'user_attr_other' })])

    const response = await detailHandlers.GET(args({ attributeId: ATTRIBUTE }))

    expect(response.status).toBe(404)
  })

  it('updates a definition after scope and permission checks', async () => {
    const row = attributeRow({ label: 'Renamed tier' })
    hoisted.updateUserAttributeMock.mockResolvedValue(row)

    const response = await detailHandlers.PATCH(
      args(
        { attributeId: ATTRIBUTE },
        jsonRequest('http://test/api/v1/user-attributes/user_attr_123', 'PATCH', {
          label: 'Renamed tier',
        })
      )
    )

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(serialisedRow({ label: 'Renamed tier' }))
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.USER_ATTRIBUTE_MANAGE
    )
    expect(hoisted.updateUserAttributeMock).toHaveBeenCalledWith(ATTRIBUTE, {
      label: 'Renamed tier',
    })
  })

  it('returns 403 and skips the service when manage permission is missing on update', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await detailHandlers.PATCH(
      args(
        { attributeId: ATTRIBUTE },
        jsonRequest('http://test/api/v1/user-attributes/user_attr_123', 'PATCH', { label: 'X' })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.updateUserAttributeMock).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid update body without calling the service', async () => {
    const response = await detailHandlers.PATCH(
      args(
        { attributeId: ATTRIBUTE },
        jsonRequest('http://test/api/v1/user-attributes/user_attr_123', 'PATCH', {
          label: '',
          type: 'nope',
        })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.updateUserAttributeMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the update body is not valid JSON', async () => {
    // request.json() rejects → the `.catch(() => null)` fallback fires → schema
    // rejects null, so we get a 400 and never reach the service.
    const response = await detailHandlers.PATCH(
      args(
        { attributeId: ATTRIBUTE },
        new Request('http://test/api/v1/user-attributes/user_attr_123', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: 'not-json',
        })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.updateUserAttributeMock).not.toHaveBeenCalled()
  })

  it('deletes a definition after scope and permission checks', async () => {
    hoisted.deleteUserAttributeMock.mockResolvedValue(undefined)

    const response = await detailHandlers.DELETE(args({ attributeId: ATTRIBUTE }))

    expect(response.status).toBe(204)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.USER_ATTRIBUTE_MANAGE
    )
    expect(hoisted.deleteUserAttributeMock).toHaveBeenCalledWith(ATTRIBUTE)
  })

  it('returns 403 and skips the service when manage permission is missing on delete', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await detailHandlers.DELETE(args({ attributeId: ATTRIBUTE }))

    expect(response.status).toBe(403)
    expect(hoisted.deleteUserAttributeMock).not.toHaveBeenCalled()
  })

  it('routes index GET service errors through handleDomainError', async () => {
    // A thrown service error should be caught and mapped, not bubble out.
    hoisted.listUserAttributesMock.mockRejectedValue(new Error('boom'))

    const response = await listHandlers.GET(args())

    expect(response.status).toBe(500)
  })

  it('routes index POST service errors through handleDomainError', async () => {
    hoisted.createUserAttributeMock.mockRejectedValue(new Error('boom'))

    const response = await listHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/user-attributes', 'POST', {
          key: 'plan_tier',
          label: 'Plan tier',
          type: 'string',
        })
      )
    )

    expect(response.status).toBe(500)
  })

  it('routes detail GET service errors through handleDomainError', async () => {
    hoisted.listUserAttributesMock.mockRejectedValue(new Error('boom'))

    const response = await detailHandlers.GET(args({ attributeId: ATTRIBUTE }))

    expect(response.status).toBe(500)
  })

  it('routes detail PATCH service errors through handleDomainError', async () => {
    hoisted.updateUserAttributeMock.mockRejectedValue(new Error('boom'))

    const response = await detailHandlers.PATCH(
      args(
        { attributeId: ATTRIBUTE },
        jsonRequest('http://test/api/v1/user-attributes/user_attr_123', 'PATCH', {
          label: 'Renamed tier',
        })
      )
    )

    expect(response.status).toBe(500)
  })

  it('routes detail DELETE service errors through handleDomainError', async () => {
    hoisted.deleteUserAttributeMock.mockRejectedValue(new Error('boom'))

    const response = await detailHandlers.DELETE(args({ attributeId: ATTRIBUTE }))

    expect(response.status).toBe(500)
  })
})
