import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { decodeCursor, encodeCursor } from '@/lib/server/domains/api/responses'

const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  searchContactsMock: vi.fn(),
  createContactMock: vi.fn(),
  getContactMock: vi.fn(),
  updateContactMock: vi.fn(),
  archiveContactMock: vi.fn(),
  linkContactToUserMock: vi.fn(),
  listLinksForContactMock: vi.fn(),
  unlinkContactFromUserMock: vi.fn(),
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
  searchContacts: (...args: unknown[]) => hoisted.searchContactsMock(...args),
  createContact: (...args: unknown[]) => hoisted.createContactMock(...args),
  getContact: (...args: unknown[]) => hoisted.getContactMock(...args),
  updateContact: (...args: unknown[]) => hoisted.updateContactMock(...args),
  archiveContact: (...args: unknown[]) => hoisted.archiveContactMock(...args),
  linkContactToUser: (...args: unknown[]) => hoisted.linkContactToUserMock(...args),
  listLinksForContact: (...args: unknown[]) => hoisted.listLinksForContactMock(...args),
  unlinkContactFromUser: (...args: unknown[]) => hoisted.unlinkContactFromUserMock(...args),
}))

vi.mock('@/lib/server/domains/audit', () => ({
  recordEvent: (...args: unknown[]) => hoisted.recordEventMock(...args),
}))

import { Route as ContactsRoute } from '../index'
import { Route as ContactDetailRoute } from '../$contactId'
import { Route as ContactLinksRoute } from '../$contactId.links'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const contactHandlers = (ContactsRoute as unknown as RouteWithHandlers).options.server.handlers
const contactDetailHandlers = (ContactDetailRoute as unknown as RouteWithHandlers).options.server
  .handlers
const contactLinksHandlers = (ContactLinksRoute as unknown as RouteWithHandlers).options.server
  .handlers

const PRINCIPAL = 'principal_admin'
const CONTACT = 'contact_123'
const USER = 'user_123'
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
  request = new Request('http://test/api/v1/contacts')
) {
  return { request, params: handlerParams }
}

function contact(overrides: Record<string, unknown> = {}) {
  return {
    id: CONTACT,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: null,
    title: null,
    organizationId: null,
    archivedAt: null,
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

describe('/api/v1/contacts collection routes', () => {
  it('lists contacts with default query params and no further page', async () => {
    const row = contact()
    // Single item, limit 25 → items.length (1) <= limit so hasMore is false.
    hoisted.searchContactsMock.mockResolvedValue([row])

    const response = await contactHandlers.GET(args())
    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual([row])

    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ORG_VIEW
    )
    // No query string → query/email/organizationId undefined, includeArchived false,
    // offset 0 (no cursor), limit default 25 → searchContacts asked for limit + 1.
    expect(hoisted.searchContactsMock).toHaveBeenCalledWith({
      query: undefined,
      email: undefined,
      organizationId: undefined,
      includeArchived: false,
      limit: 26,
      offset: 0,
    })

    const body = await (await contactHandlers.GET(args())).json()
    expect(body.meta.pagination).toEqual({ cursor: null, hasMore: false })
  })

  it('applies query params, decodes cursor, and returns a next cursor when more remain', async () => {
    // Request limit 2 with a cursor encoding offset 4. The service returns 3 rows
    // (limit + 1) so hasMore is true: the page is sliced to 2 and a next cursor is set.
    const rows = [
      contact({ id: 'contact_a' }),
      contact({ id: 'contact_b' }),
      contact({ id: 'contact_c' }),
    ]
    hoisted.searchContactsMock.mockResolvedValue(rows)

    const cursor = encodeCursor(4)
    const url =
      `http://test/api/v1/contacts?q=ada&email=ada@example.com&organizationId=${ORG}` +
      `&includeArchived=true&limit=2&cursor=${cursor}`
    const response = await contactHandlers.GET(args({}, new Request(url)))
    expect(response.status).toBe(200)

    expect(hoisted.searchContactsMock).toHaveBeenCalledWith({
      query: 'ada',
      email: 'ada@example.com',
      organizationId: ORG,
      includeArchived: true,
      limit: 3,
      offset: 4,
    })

    const body = await response.json()
    expect(body.data).toHaveLength(2)
    expect(body.meta.pagination.hasMore).toBe(true)
    // Next offset = previous offset (4) + limit (2) = 6.
    expect(decodeCursor(body.meta.pagination.cursor)).toBe(6)
  })

  it('caps the limit at 100', async () => {
    hoisted.searchContactsMock.mockResolvedValue([])
    const response = await contactHandlers.GET(
      args({}, new Request('http://test/api/v1/contacts?limit=500'))
    )
    expect(response.status).toBe(200)
    // limit capped at 100 → service asked for 101.
    expect(hoisted.searchContactsMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 101 }))
  })

  it('denies listing without org.view permission', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)
    const response = await contactHandlers.GET(args())
    expect(response.status).toBe(403)
    expect(hoisted.searchContactsMock).not.toHaveBeenCalled()
  })

  it('creates a contact and records an audit event', async () => {
    const row = contact()
    hoisted.createContactMock.mockResolvedValue(row)

    const response = await contactHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/contacts', 'POST', {
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          organizationId: ORG,
        })
      )
    )
    expect(response.status).toBe(201)
    expect(await expectJsonData(response)).toEqual(row)

    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ORG_MANAGE
    )
    expect(hoisted.createContactMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        organizationId: ORG,
      }),
      { principalId: PRINCIPAL }
    )
    expect(hoisted.recordEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: PRINCIPAL,
        action: 'contact.created',
        targetType: 'contact',
        targetId: row.id,
        source: 'api',
        diff: { after: { name: row.name, email: row.email } },
      })
    )
  })

  it('denies creating without org.manage permission', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)
    const response = await contactHandlers.POST(
      args({}, jsonRequest('http://test/api/v1/contacts', 'POST', { name: 'Ada' }))
    )
    expect(response.status).toBe(403)
    expect(hoisted.createContactMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid create body before calling the service', async () => {
    // name min length is 1 → empty string fails the zod schema.
    const response = await contactHandlers.POST(
      args({}, jsonRequest('http://test/api/v1/contacts', 'POST', { name: '' }))
    )
    expect(response.status).toBe(400)
    expect(hoisted.createContactMock).not.toHaveBeenCalled()
  })

  it('treats unparseable JSON as a 400 on create', async () => {
    // request.json() rejects → caught as null → safeParse(null) fails the object schema.
    const badRequest = new Request('http://test/api/v1/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const response = await contactHandlers.POST(args({}, badRequest))
    expect(response.status).toBe(400)
    expect(hoisted.createContactMock).not.toHaveBeenCalled()
  })

  it('routes thrown errors through handleDomainError on list and create', async () => {
    // A bare Error has no `code`/`statusCode` → handleDomainError falls back to 500.
    hoisted.searchContactsMock.mockRejectedValue(new Error('boom'))
    const listResponse = await contactHandlers.GET(args())
    expect(listResponse.status).toBe(500)

    hoisted.createContactMock.mockRejectedValue(new Error('boom'))
    const createResponse = await contactHandlers.POST(
      args({}, jsonRequest('http://test/api/v1/contacts', 'POST', { name: 'Ada' }))
    )
    expect(createResponse.status).toBe(500)
  })
})

describe('/api/v1/contacts/$contactId detail routes', () => {
  it('gets a contact by id', async () => {
    const row = contact()
    hoisted.getContactMock.mockResolvedValue(row)

    const response = await contactDetailHandlers.GET(args({ contactId: CONTACT }))
    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(row)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ORG_VIEW
    )
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(CONTACT, 'contact', 'contact ID')
    expect(hoisted.getContactMock).toHaveBeenCalledWith(CONTACT)
  })

  it('returns 404 when the contact does not exist', async () => {
    hoisted.getContactMock.mockResolvedValue(null)
    const response = await contactDetailHandlers.GET(args({ contactId: CONTACT }))
    expect(response.status).toBe(404)
  })

  it('denies getting a contact without org.view permission', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)
    const response = await contactDetailHandlers.GET(args({ contactId: CONTACT }))
    expect(response.status).toBe(403)
    expect(hoisted.getContactMock).not.toHaveBeenCalled()
  })

  it('patches a contact and records the before/after diff', async () => {
    const before = contact({ name: 'Old name', email: 'old@example.com' })
    const after = contact({ name: 'New name', email: 'new@example.com' })
    hoisted.getContactMock.mockResolvedValue(before)
    hoisted.updateContactMock.mockResolvedValue(after)

    const response = await contactDetailHandlers.PATCH(
      args(
        { contactId: CONTACT },
        jsonRequest('http://test/api/v1/contacts/contact_123', 'PATCH', {
          name: 'New name',
          organizationId: ORG,
        })
      )
    )
    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(after)

    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ORG_MANAGE
    )
    expect(hoisted.updateContactMock).toHaveBeenCalledWith(
      CONTACT,
      expect.objectContaining({ name: 'New name', organizationId: ORG }),
      { principalId: PRINCIPAL }
    )
    // before is truthy → diff.before populated.
    expect(hoisted.recordEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contact.updated',
        diff: {
          before: { name: 'Old name', email: 'old@example.com' },
          after: { name: 'New name', email: 'new@example.com' },
        },
      })
    )
  })

  it('patches when the prior contact lookup returns null (diff.before undefined)', async () => {
    const after = contact({ name: 'New name' })
    hoisted.getContactMock.mockResolvedValue(null)
    hoisted.updateContactMock.mockResolvedValue(after)

    const response = await contactDetailHandlers.PATCH(
      args(
        { contactId: CONTACT },
        jsonRequest('http://test/api/v1/contacts/contact_123', 'PATCH', { name: 'New name' })
      )
    )
    expect(response.status).toBe(200)
    // before is null → ternary yields undefined for diff.before.
    expect(hoisted.recordEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        diff: { before: undefined, after: { name: after.name, email: after.email } },
      })
    )
  })

  it('denies patching without org.manage permission', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)
    const response = await contactDetailHandlers.PATCH(
      args(
        { contactId: CONTACT },
        jsonRequest('http://test/api/v1/contacts/contact_123', 'PATCH', { name: 'X' })
      )
    )
    expect(response.status).toBe(403)
    expect(hoisted.updateContactMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid patch body before calling the service', async () => {
    const response = await contactDetailHandlers.PATCH(
      args(
        { contactId: CONTACT },
        jsonRequest('http://test/api/v1/contacts/contact_123', 'PATCH', { name: '' })
      )
    )
    expect(response.status).toBe(400)
    expect(hoisted.updateContactMock).not.toHaveBeenCalled()
  })

  it('archives a contact and records an audit event', async () => {
    hoisted.archiveContactMock.mockResolvedValue(undefined)

    const response = await contactDetailHandlers.DELETE(args({ contactId: CONTACT }))
    expect(response.status).toBe(204)
    expect(hoisted.archiveContactMock).toHaveBeenCalledWith(CONTACT, { principalId: PRINCIPAL })
    expect(hoisted.recordEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contact.archived',
        targetType: 'contact',
        targetId: CONTACT,
        source: 'api',
      })
    )
  })

  it('denies archiving without org.manage permission', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)
    const response = await contactDetailHandlers.DELETE(args({ contactId: CONTACT }))
    expect(response.status).toBe(403)
    expect(hoisted.archiveContactMock).not.toHaveBeenCalled()
  })

  it('routes thrown errors through handleDomainError on get, patch, and delete', async () => {
    hoisted.getContactMock.mockRejectedValueOnce(new Error('boom'))
    expect((await contactDetailHandlers.GET(args({ contactId: CONTACT }))).status).toBe(500)

    hoisted.updateContactMock.mockRejectedValueOnce(new Error('boom'))
    expect(
      (
        await contactDetailHandlers.PATCH(
          args(
            { contactId: CONTACT },
            jsonRequest('http://test/api/v1/contacts/contact_123', 'PATCH', { name: 'X' })
          )
        )
      ).status
    ).toBe(500)

    hoisted.archiveContactMock.mockRejectedValueOnce(new Error('boom'))
    expect((await contactDetailHandlers.DELETE(args({ contactId: CONTACT }))).status).toBe(500)
  })
})

describe('/api/v1/contacts/$contactId/links routes', () => {
  it('lists links for a contact', async () => {
    const links = [{ contactId: CONTACT, userId: USER }]
    hoisted.listLinksForContactMock.mockResolvedValue(links)

    const response = await contactLinksHandlers.GET(args({ contactId: CONTACT }))
    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(links)
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ORG_VIEW
    )
    expect(hoisted.listLinksForContactMock).toHaveBeenCalledWith(CONTACT)
  })

  it('denies listing links without org.view permission', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)
    const response = await contactLinksHandlers.GET(args({ contactId: CONTACT }))
    expect(response.status).toBe(403)
    expect(hoisted.listLinksForContactMock).not.toHaveBeenCalled()
  })

  it('links a contact to a user and records an audit event', async () => {
    const link = { contactId: CONTACT, userId: USER }
    hoisted.linkContactToUserMock.mockResolvedValue(link)

    const response = await contactLinksHandlers.POST(
      args(
        { contactId: CONTACT },
        jsonRequest('http://test/api/v1/contacts/contact_123/links', 'POST', { userId: USER })
      )
    )
    expect(response.status).toBe(201)
    expect(await expectJsonData(response)).toEqual(link)

    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ORG_MANAGE
    )
    // parseTypeId is invoked for both the contact id and the user id.
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(CONTACT, 'contact', 'contact ID')
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(USER, 'user', 'user ID')
    expect(hoisted.linkContactToUserMock).toHaveBeenCalledWith(
      { contactId: CONTACT, userId: USER, linkedByPrincipalId: PRINCIPAL },
      { principalId: PRINCIPAL }
    )
    expect(hoisted.recordEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contact.linked_user',
        targetId: CONTACT,
        diff: { context: { userId: USER } },
      })
    )
  })

  it('denies linking without org.manage permission', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)
    const response = await contactLinksHandlers.POST(
      args(
        { contactId: CONTACT },
        jsonRequest('http://test/api/v1/contacts/contact_123/links', 'POST', { userId: USER })
      )
    )
    expect(response.status).toBe(403)
    expect(hoisted.linkContactToUserMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid link body before calling the service', async () => {
    // userId min length is 1 → empty string fails the zod schema.
    const response = await contactLinksHandlers.POST(
      args(
        { contactId: CONTACT },
        jsonRequest('http://test/api/v1/contacts/contact_123/links', 'POST', { userId: '' })
      )
    )
    expect(response.status).toBe(400)
    expect(hoisted.linkContactToUserMock).not.toHaveBeenCalled()
  })

  it('unlinks a contact from a user and records an audit event', async () => {
    hoisted.unlinkContactFromUserMock.mockResolvedValue(undefined)

    const response = await contactLinksHandlers.DELETE(
      args(
        { contactId: CONTACT },
        new Request(`http://test/api/v1/contacts/contact_123/links?userId=${USER}`)
      )
    )
    expect(response.status).toBe(204)
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(USER, 'user', 'user ID')
    expect(hoisted.unlinkContactFromUserMock).toHaveBeenCalledWith(CONTACT, USER, {
      principalId: PRINCIPAL,
    })
    expect(hoisted.recordEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contact.unlinked_user',
        targetId: CONTACT,
        diff: { context: { userId: USER } },
      })
    )
  })

  it('returns 400 when the userId query param is missing on unlink', async () => {
    const response = await contactLinksHandlers.DELETE(
      args({ contactId: CONTACT }, new Request('http://test/api/v1/contacts/contact_123/links'))
    )
    expect(response.status).toBe(400)
    expect(hoisted.unlinkContactFromUserMock).not.toHaveBeenCalled()
  })

  it('denies unlinking without org.manage permission', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)
    const response = await contactLinksHandlers.DELETE(
      args(
        { contactId: CONTACT },
        new Request(`http://test/api/v1/contacts/contact_123/links?userId=${USER}`)
      )
    )
    expect(response.status).toBe(403)
    expect(hoisted.unlinkContactFromUserMock).not.toHaveBeenCalled()
  })

  it('routes thrown errors through handleDomainError on list, link, and unlink', async () => {
    hoisted.listLinksForContactMock.mockRejectedValueOnce(new Error('boom'))
    expect((await contactLinksHandlers.GET(args({ contactId: CONTACT }))).status).toBe(500)

    hoisted.linkContactToUserMock.mockRejectedValueOnce(new Error('boom'))
    expect(
      (
        await contactLinksHandlers.POST(
          args(
            { contactId: CONTACT },
            jsonRequest('http://test/api/v1/contacts/contact_123/links', 'POST', { userId: USER })
          )
        )
      ).status
    ).toBe(500)

    hoisted.unlinkContactFromUserMock.mockRejectedValueOnce(new Error('boom'))
    expect(
      (
        await contactLinksHandlers.DELETE(
          args(
            { contactId: CONTACT },
            new Request(`http://test/api/v1/contacts/contact_123/links?userId=${USER}`)
          )
        )
      ).status
    ).toBe(500)
  })
})
