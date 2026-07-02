import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  createOrganizationMock: vi.fn(),
  listOrganizationsMock: vi.fn(),
  getOrganizationMock: vi.fn(),
  updateOrganizationMock: vi.fn(),
  archiveOrganizationMock: vi.fn(),
  listContactsForOrganizationMock: vi.fn(),
  recordEventMock: vi.fn(),
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

vi.mock('@/lib/server/domains/organizations', () => ({
  createOrganization: (...args: unknown[]) => hoisted.createOrganizationMock(...args),
  listOrganizations: (...args: unknown[]) => hoisted.listOrganizationsMock(...args),
  getOrganization: (...args: unknown[]) => hoisted.getOrganizationMock(...args),
  updateOrganization: (...args: unknown[]) => hoisted.updateOrganizationMock(...args),
  archiveOrganization: (...args: unknown[]) => hoisted.archiveOrganizationMock(...args),
  listContactsForOrganization: (...args: unknown[]) =>
    hoisted.listContactsForOrganizationMock(...args),
}))

vi.mock('@/lib/server/domains/audit', () => ({
  recordEvent: (...args: unknown[]) => hoisted.recordEventMock(...args),
}))

import { Route as OrganizationsRoute } from '../index'
import { Route as OrganizationDetailRoute } from '../$organizationId'
import { Route as OrganizationContactsRoute } from '../$organizationId.contacts'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const orgHandlers = (OrganizationsRoute as unknown as RouteWithHandlers).options.server.handlers
const orgDetailHandlers = (OrganizationDetailRoute as unknown as RouteWithHandlers).options.server
  .handlers
const orgContactsHandlers = (OrganizationContactsRoute as unknown as RouteWithHandlers).options
  .server.handlers

const PRINCIPAL = 'principal_admin'
const ORG = 'org_123'

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(
  handlerParams: Record<string, string> = {},
  request = new Request('http://test/api/v1/organizations')
) {
  return { request, params: handlerParams }
}

function organisation(overrides: Record<string, unknown> = {}) {
  return {
    id: ORG,
    name: 'Acme',
    domain: 'acme.example',
    externalId: null,
    website: null,
    notes: null,
    archivedAt: null,
    ...overrides,
  }
}

function contact(overrides: Record<string, unknown> = {}) {
  return {
    id: 'contact_1',
    organizationId: ORG,
    name: 'Jane Doe',
    email: 'jane@acme.example',
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
  hoisted.recordEventMock.mockResolvedValue(undefined)
})

describe('/api/v1/organizations index', () => {
  it('lists organisations without search and without more pages', async () => {
    const row = organisation()
    // Service returns exactly `limit` rows so hasMore is false (page === items, cursor null).
    hoisted.listOrganizationsMock.mockResolvedValue([row])

    const response = await orgHandlers.GET(args())

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual([row])
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ORG_VIEW
    )
    // Default branch: no search param (?? undefined), includeArchived false, default limit 50.
    expect(hoisted.listOrganizationsMock).toHaveBeenCalledWith({
      search: undefined,
      includeArchived: false,
      limit: 51,
      offset: 0,
    })
  })

  it('returns pagination cursor when there are more pages and honours search/includeArchived/limit', async () => {
    // Two rows with limit=1 means hasMore true -> page sliced to 1 and nextCursor encoded.
    const rows = [organisation(), organisation({ id: 'org_456', name: 'Beta' })]
    hoisted.listOrganizationsMock.mockResolvedValue(rows)

    const response = await orgHandlers.GET(
      args(
        {},
        new Request('http://test/api/v1/organizations?search=ac&includeArchived=true&limit=1')
      )
    )

    expect(response.status).toBe(200)
    const data = await response.clone().json()
    expect(data.data).toHaveLength(1)
    expect(data.meta.pagination.hasMore).toBe(true)
    expect(typeof data.meta.pagination.cursor).toBe('string')
    expect(data.meta.pagination.cursor).not.toBeNull()
    expect(hoisted.listOrganizationsMock).toHaveBeenCalledWith({
      search: 'ac',
      includeArchived: true,
      limit: 2,
      offset: 0,
    })
  })

  it('clamps limit above the 200 maximum and decodes a provided cursor offset', async () => {
    hoisted.listOrganizationsMock.mockResolvedValue([])
    // Cursor encodes offset 200 (base64url of {"offset":200}).
    const cursor = Buffer.from(JSON.stringify({ offset: 200 })).toString('base64url')

    const response = await orgHandlers.GET(
      args({}, new Request(`http://test/api/v1/organizations?limit=9999&cursor=${cursor}`))
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toEqual([])
    expect(hoisted.listOrganizationsMock).toHaveBeenCalledWith({
      search: undefined,
      includeArchived: false,
      limit: 201,
      offset: 200,
    })
    expect(body.meta.pagination.hasMore).toBe(false)
    expect(body.meta.pagination.cursor).toBeNull()
  })

  it('denies listing without org.view permission', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await orgHandlers.GET(args())

    expect(response.status).toBe(403)
    expect(hoisted.listOrganizationsMock).not.toHaveBeenCalled()
  })

  it('creates an organisation and records an audit event', async () => {
    const row = organisation()
    hoisted.createOrganizationMock.mockResolvedValue(row)

    const response = await orgHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/organizations', 'POST', {
          name: 'Acme',
          domain: 'acme.example',
          externalId: null,
          website: null,
          notes: null,
        })
      )
    )

    expect(response.status).toBe(201)
    expect(await expectJsonData(response)).toEqual(row)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ORG_MANAGE
    )
    expect(hoisted.createOrganizationMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Acme', domain: 'acme.example' }),
      { principalId: PRINCIPAL }
    )
    expect(hoisted.recordEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: PRINCIPAL,
        action: 'organization.created',
        targetType: 'organization',
        targetId: row.id,
        source: 'api',
        diff: { after: { name: row.name, domain: row.domain } },
      })
    )
  })

  it('denies creation without org.manage permission', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await orgHandlers.POST(
      args({}, jsonRequest('http://test/api/v1/organizations', 'POST', { name: 'Acme' }))
    )

    expect(response.status).toBe(403)
    expect(hoisted.createOrganizationMock).not.toHaveBeenCalled()
    expect(hoisted.recordEventMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid create body (zod failure) before calling the service', async () => {
    const response = await orgHandlers.POST(
      args({}, jsonRequest('http://test/api/v1/organizations', 'POST', { name: '' }))
    )

    expect(response.status).toBe(400)
    expect(hoisted.createOrganizationMock).not.toHaveBeenCalled()
  })

  it('rejects a non-JSON create body (json parse rejects -> null) before calling the service', async () => {
    // Body is not valid JSON so request.json() rejects and is caught as null, failing safeParse.
    const badRequest = new Request('http://test/api/v1/organizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })

    const response = await orgHandlers.POST(args({}, badRequest))

    expect(response.status).toBe(400)
    expect(hoisted.createOrganizationMock).not.toHaveBeenCalled()
  })

  it('routes a thrown service error through handleDomainError on list', async () => {
    hoisted.listOrganizationsMock.mockRejectedValue(new Error('boom'))

    const response = await orgHandlers.GET(args())

    expect(response.status).toBe(500)
  })

  it('routes a thrown service error through handleDomainError on create', async () => {
    hoisted.createOrganizationMock.mockRejectedValue(new Error('boom'))

    const response = await orgHandlers.POST(
      args({}, jsonRequest('http://test/api/v1/organizations', 'POST', { name: 'Acme' }))
    )

    expect(response.status).toBe(500)
  })
})

describe('/api/v1/organizations/$organizationId detail', () => {
  it('gets an organisation', async () => {
    const row = organisation()
    hoisted.getOrganizationMock.mockResolvedValue(row)

    const response = await orgDetailHandlers.GET(args({ organizationId: ORG }))

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(row)
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(ORG, 'org', 'organization ID')
    expect(hoisted.getOrganizationMock).toHaveBeenCalledWith(ORG)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ORG_VIEW
    )
  })

  it('returns 404 when the organisation does not exist', async () => {
    hoisted.getOrganizationMock.mockResolvedValue(null)

    const response = await orgDetailHandlers.GET(args({ organizationId: ORG }))

    expect(response.status).toBe(404)
  })

  it('denies get without org.view permission', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await orgDetailHandlers.GET(args({ organizationId: ORG }))

    expect(response.status).toBe(403)
    expect(hoisted.getOrganizationMock).not.toHaveBeenCalled()
  })

  it('patches an organisation and records the before/after diff when a prior record exists', async () => {
    const before = organisation({ name: 'Old name', domain: 'old.example' })
    const after = organisation({ name: 'New name', domain: 'new.example' })
    hoisted.getOrganizationMock.mockResolvedValue(before)
    hoisted.updateOrganizationMock.mockResolvedValue(after)

    const response = await orgDetailHandlers.PATCH(
      args(
        { organizationId: ORG },
        jsonRequest('http://test/api/v1/organizations/org_123', 'PATCH', {
          name: 'New name',
          domain: 'new.example',
        })
      )
    )

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(after)
    expect(hoisted.updateOrganizationMock).toHaveBeenCalledWith(
      ORG,
      { name: 'New name', domain: 'new.example' },
      { principalId: PRINCIPAL }
    )
    expect(hoisted.recordEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'organization.updated',
        diff: {
          before: { name: 'Old name', domain: 'old.example' },
          after: { name: 'New name', domain: 'new.example' },
        },
      })
    )
  })

  it('patches an organisation with an undefined before-diff when no prior record exists', async () => {
    // getOrganization returns null so the `before ? ... : undefined` branch hits undefined.
    const after = organisation({ name: 'New name', domain: 'new.example' })
    hoisted.getOrganizationMock.mockResolvedValue(null)
    hoisted.updateOrganizationMock.mockResolvedValue(after)

    const response = await orgDetailHandlers.PATCH(
      args(
        { organizationId: ORG },
        jsonRequest('http://test/api/v1/organizations/org_123', 'PATCH', { name: 'New name' })
      )
    )

    expect(response.status).toBe(200)
    expect(hoisted.recordEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'organization.updated',
        diff: {
          before: undefined,
          after: { name: 'New name', domain: 'new.example' },
        },
      })
    )
  })

  it('denies patch without org.manage permission', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await orgDetailHandlers.PATCH(
      args(
        { organizationId: ORG },
        jsonRequest('http://test/api/v1/organizations/org_123', 'PATCH', { name: 'New name' })
      )
    )

    expect(response.status).toBe(403)
    expect(hoisted.updateOrganizationMock).not.toHaveBeenCalled()
    expect(hoisted.recordEventMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid patch body before calling the service', async () => {
    const response = await orgDetailHandlers.PATCH(
      args(
        { organizationId: ORG },
        jsonRequest('http://test/api/v1/organizations/org_123', 'PATCH', { name: '' })
      )
    )

    expect(response.status).toBe(400)
    expect(hoisted.updateOrganizationMock).not.toHaveBeenCalled()
    expect(hoisted.getOrganizationMock).not.toHaveBeenCalled()
  })

  it('rejects a non-JSON patch body (json parse rejects -> null) before calling the service', async () => {
    // Invalid JSON makes request.json() reject; the .catch(() => null) arrow yields null,
    // which then fails safeParse with a 400.
    const badRequest = new Request('http://test/api/v1/organizations/org_123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })

    const response = await orgDetailHandlers.PATCH(args({ organizationId: ORG }, badRequest))

    expect(response.status).toBe(400)
    expect(hoisted.updateOrganizationMock).not.toHaveBeenCalled()
  })

  it('archives an organisation (soft delete) and records the event', async () => {
    hoisted.archiveOrganizationMock.mockResolvedValue(undefined)

    const response = await orgDetailHandlers.DELETE(args({ organizationId: ORG }))

    expect(response.status).toBe(204)
    expect(hoisted.archiveOrganizationMock).toHaveBeenCalledWith(ORG, { principalId: PRINCIPAL })
    expect(hoisted.recordEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'organization.archived',
        targetType: 'organization',
        targetId: ORG,
        source: 'api',
      })
    )
  })

  it('denies archive without org.manage permission', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await orgDetailHandlers.DELETE(args({ organizationId: ORG }))

    expect(response.status).toBe(403)
    expect(hoisted.archiveOrganizationMock).not.toHaveBeenCalled()
    expect(hoisted.recordEventMock).not.toHaveBeenCalled()
  })

  it('routes a thrown service error through handleDomainError on get', async () => {
    hoisted.getOrganizationMock.mockRejectedValue(new Error('boom'))

    const response = await orgDetailHandlers.GET(args({ organizationId: ORG }))

    expect(response.status).toBe(500)
  })

  it('routes a thrown service error through handleDomainError on patch', async () => {
    hoisted.getOrganizationMock.mockResolvedValue(organisation())
    hoisted.updateOrganizationMock.mockRejectedValue(new Error('boom'))

    const response = await orgDetailHandlers.PATCH(
      args(
        { organizationId: ORG },
        jsonRequest('http://test/api/v1/organizations/org_123', 'PATCH', { name: 'New name' })
      )
    )

    expect(response.status).toBe(500)
  })

  it('routes a thrown service error through handleDomainError on archive', async () => {
    hoisted.archiveOrganizationMock.mockRejectedValue(new Error('boom'))

    const response = await orgDetailHandlers.DELETE(args({ organizationId: ORG }))

    expect(response.status).toBe(500)
  })
})

describe('/api/v1/organizations/$organizationId/contacts', () => {
  it('lists contacts for an organisation without more pages', async () => {
    const row = contact()
    hoisted.listContactsForOrganizationMock.mockResolvedValue([row])

    const response = await orgContactsHandlers.GET(args({ organizationId: ORG }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toEqual([row])
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ORG_VIEW
    )
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(ORG, 'org', 'organization ID')
    expect(hoisted.listContactsForOrganizationMock).toHaveBeenCalledWith(ORG, {
      includeArchived: false,
      limit: 51,
      offset: 0,
    })
    expect(body.meta.pagination.hasMore).toBe(false)
    expect(body.meta.pagination.cursor).toBeNull()
  })

  it('returns a pagination cursor and honours includeArchived/limit when there are more pages', async () => {
    const rows = [contact(), contact({ id: 'contact_2', name: 'John Roe' })]
    hoisted.listContactsForOrganizationMock.mockResolvedValue(rows)

    const response = await orgContactsHandlers.GET(
      args(
        { organizationId: ORG },
        new Request(
          'http://test/api/v1/organizations/org_123/contacts?includeArchived=true&limit=1'
        )
      )
    )

    expect(response.status).toBe(200)
    const data = await response.clone().json()
    expect(data.data).toHaveLength(1)
    expect(data.meta.pagination.hasMore).toBe(true)
    expect(typeof data.meta.pagination.cursor).toBe('string')
    expect(hoisted.listContactsForOrganizationMock).toHaveBeenCalledWith(ORG, {
      includeArchived: true,
      limit: 2,
      offset: 0,
    })
  })

  it('denies listing contacts without org.view permission', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)

    const response = await orgContactsHandlers.GET(args({ organizationId: ORG }))

    expect(response.status).toBe(403)
    expect(hoisted.listContactsForOrganizationMock).not.toHaveBeenCalled()
  })

  it('routes a thrown service error through handleDomainError on list contacts', async () => {
    hoisted.listContactsForOrganizationMock.mockRejectedValue(new Error('boom'))

    const response = await orgContactsHandlers.GET(args({ organizationId: ORG }))

    expect(response.status).toBe(500)
  })
})
