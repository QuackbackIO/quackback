/**
 * Request-level behaviour coverage for the ticket-status workflow catalogue
 * routes:
 *   - GET/POST  /api/v1/ticket-statuses          (index.ts)
 *   - GET/PATCH/DELETE /api/v1/ticket-statuses/:statusId  ($statusId.ts)
 *
 * Unlike the inboxes cluster, these handlers gate purely on `withApiKeyAuth`
 * role checks (no assertScopeAllowed / hasPermission / PERMISSIONS). A denied
 * caller therefore surfaces as a thrown ForbiddenError routed through
 * handleDomainError (→ 403). The api/responses and handleDomainError modules
 * are intentionally left unmocked so real status codes flow.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/shared/errors'

const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  listTicketStatusesMock: vi.fn(),
  createTicketStatusMock: vi.fn(),
  getTicketStatusMock: vi.fn(),
  updateTicketStatusMock: vi.fn(),
  archiveTicketStatusMock: vi.fn(),
  // db.select() chain stub for the DELETE reference-count guard.
  dbSelectMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => hoisted.withApiKeyAuthMock(...args),
}))

vi.mock('@/lib/server/domains/api/validation', () => ({
  parseTypeId: (...args: unknown[]) => hoisted.parseTypeIdMock(...args),
}))

vi.mock('@/lib/server/domains/tickets', () => ({
  listTicketStatuses: (...args: unknown[]) => hoisted.listTicketStatusesMock(...args),
  createTicketStatus: (...args: unknown[]) => hoisted.createTicketStatusMock(...args),
  getTicketStatus: (...args: unknown[]) => hoisted.getTicketStatusMock(...args),
  updateTicketStatus: (...args: unknown[]) => hoisted.updateTicketStatusMock(...args),
  archiveTicketStatus: (...args: unknown[]) => hoisted.archiveTicketStatusMock(...args),
}))

vi.mock('@/lib/server/db', () => ({
  TICKET_STATUS_CATEGORIES: ['open', 'pending', 'on_hold', 'solved', 'closed'],
  db: {
    select: (...args: unknown[]) => hoisted.dbSelectMock(...args),
  },
  // Tables/operators used only to build the predicate; their identity does not
  // matter to the assertions, so simple sentinels keep the mock honest.
  tickets: { statusId: 'tickets.statusId', deletedAt: 'tickets.deletedAt' },
  eq: vi.fn((col, val) => ({ _eq: [col, val] })),
  and: vi.fn((...args) => ({ _and: args })),
  isNull: vi.fn((col) => ({ _isNull: col })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ _sql: { strings, values } }),
    {}
  ),
}))

import { Route as IndexRoute } from '../index'
import { Route as StatusDetailRoute } from '../$statusId'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const indexHandlers = (IndexRoute as unknown as RouteWithHandlers).options.server.handlers
const detailHandlers = (StatusDetailRoute as unknown as RouteWithHandlers).options.server.handlers

const PRINCIPAL = 'principal_admin'
const STATUS_ID = 'ticket_status_123'

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(
  handlerParams: Record<string, string> = {},
  request = new Request('http://test/api/v1/ticket-statuses')
) {
  return { request, params: handlerParams }
}

/** A persisted ticket-status row as the domain service would return it. */
function statusRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STATUS_ID,
    name: 'In progress',
    slug: 'in-progress',
    color: '#00AABB',
    category: 'open',
    position: 1,
    isDefault: false,
    isSystem: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  }
}

/** Shape the route's serialize() output (Dates → ISO strings). */
function serialized(row: ReturnType<typeof statusRow>) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    color: row.color,
    category: row.category,
    position: row.position,
    isDefault: row.isDefault,
    isSystem: row.isSystem,
    createdAt: (row.createdAt as Date).toISOString(),
    deletedAt: row.deletedAt ? (row.deletedAt as Date).toISOString() : null,
  }
}

/** Stub for `db.select({...}).from(tickets).where(...)` resolving to `rows`. */
function makeRefChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  }
}

async function expectJsonData(response: Response) {
  return (await response.json()).data
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.withApiKeyAuthMock.mockResolvedValue({
    principalId: PRINCIPAL,
    role: 'admin',
    key: { scopes: [] },
  })
  hoisted.parseTypeIdMock.mockImplementation((value: string) => value)
})

describe('GET/POST /api/v1/ticket-statuses (index)', () => {
  it('lists statuses with includeDeleted=false by default and gates on the team role', async () => {
    const row = statusRow()
    hoisted.listTicketStatusesMock.mockResolvedValue([row])

    const response = await indexHandlers.GET(args())
    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual([serialized(row)])
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.listTicketStatusesMock).toHaveBeenCalledWith({ includeDeleted: false })
  })

  it('honours the includeDeleted=true query toggle', async () => {
    const archived = statusRow({ deletedAt: new Date('2026-02-02T00:00:00.000Z') })
    hoisted.listTicketStatusesMock.mockResolvedValue([archived])

    const response = await indexHandlers.GET(
      args({}, new Request('http://test/api/v1/ticket-statuses?includeDeleted=true'))
    )
    expect(response.status).toBe(200)
    // Archived rows serialise deletedAt to an ISO string (the non-null branch).
    expect(await expectJsonData(response)).toEqual([serialized(archived)])
    expect(hoisted.listTicketStatusesMock).toHaveBeenCalledWith({ includeDeleted: true })
  })

  it('treats any non-"true" includeDeleted value as false', async () => {
    hoisted.listTicketStatusesMock.mockResolvedValue([])

    const response = await indexHandlers.GET(
      args({}, new Request('http://test/api/v1/ticket-statuses?includeDeleted=yes'))
    )
    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual([])
    expect(hoisted.listTicketStatusesMock).toHaveBeenCalledWith({ includeDeleted: false })
  })

  it('returns 403 when the listing caller is not authorised', async () => {
    hoisted.withApiKeyAuthMock.mockRejectedValueOnce(new ForbiddenError('FORBIDDEN', 'nope'))

    const response = await indexHandlers.GET(args())
    expect(response.status).toBe(403)
    expect(hoisted.listTicketStatusesMock).not.toHaveBeenCalled()
  })

  it('creates a status with all optional fields, gating on the admin role', async () => {
    const row = statusRow({ name: 'Waiting', slug: 'waiting', category: 'pending', position: 3 })
    hoisted.createTicketStatusMock.mockResolvedValue(row)

    const response = await indexHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/ticket-statuses', 'POST', {
          name: 'Waiting',
          slug: 'waiting',
          color: '#112233',
          category: 'pending',
          position: 3,
          isDefault: true,
        })
      )
    )
    expect(response.status).toBe(201)
    expect(await expectJsonData(response)).toEqual(serialized(row))
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'admin' })
    expect(hoisted.createTicketStatusMock).toHaveBeenCalledWith(
      {
        name: 'Waiting',
        slug: 'waiting',
        color: '#112233',
        category: 'pending',
        position: 3,
        isDefault: true,
      },
      { principalId: PRINCIPAL }
    )
  })

  it('creates a status with only required fields (optionals resolve to undefined)', async () => {
    const row = statusRow({ name: 'Minimal', slug: 'minimal', color: null })
    hoisted.createTicketStatusMock.mockResolvedValue(row)

    const response = await indexHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/ticket-statuses', 'POST', {
          name: 'Minimal',
          slug: 'minimal',
          category: 'open',
        })
      )
    )
    expect(response.status).toBe(201)
    expect(hoisted.createTicketStatusMock).toHaveBeenCalledWith(
      {
        name: 'Minimal',
        slug: 'minimal',
        color: undefined,
        category: 'open',
        position: undefined,
        isDefault: undefined,
      },
      { principalId: PRINCIPAL }
    )
    // serialize() returns null for a null colour column.
    expect(await expectJsonData(response)).toEqual(serialized(row))
  })

  it('rejects an invalid create body with 400 before calling the service', async () => {
    const response = await indexHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/ticket-statuses', 'POST', {
          name: '',
          slug: 'Bad Slug!',
          category: 'open',
        })
      )
    )
    expect(response.status).toBe(400)
    expect(hoisted.createTicketStatusMock).not.toHaveBeenCalled()
  })

  it('treats a non-JSON create body as null and returns 400', async () => {
    // request.json() throws → caught into `null` → safeParse fails.
    const badRequest = new Request('http://test/api/v1/ticket-statuses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const response = await indexHandlers.POST(args({}, badRequest))
    expect(response.status).toBe(400)
    expect(hoisted.createTicketStatusMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the create caller is not an admin', async () => {
    hoisted.withApiKeyAuthMock.mockRejectedValueOnce(new ForbiddenError('FORBIDDEN', 'nope'))

    const response = await indexHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/ticket-statuses', 'POST', {
          name: 'Waiting',
          slug: 'waiting',
          category: 'pending',
        })
      )
    )
    expect(response.status).toBe(403)
    expect(hoisted.createTicketStatusMock).not.toHaveBeenCalled()
  })

  it('routes a service conflict (DUPLICATE_SLUG) to 409 on create', async () => {
    hoisted.createTicketStatusMock.mockRejectedValueOnce({
      code: 'DUPLICATE_SLUG',
      message: 'slug already exists',
    })

    const response = await indexHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/ticket-statuses', 'POST', {
          name: 'Waiting',
          slug: 'waiting',
          category: 'pending',
        })
      )
    )
    expect(response.status).toBe(409)
  })
})

describe('GET/PATCH/DELETE /api/v1/ticket-statuses/:statusId (detail)', () => {
  it('returns a single status and parses the id with the ticket_status prefix', async () => {
    const row = statusRow()
    hoisted.getTicketStatusMock.mockResolvedValue(row)

    const response = await detailHandlers.GET(args({ statusId: STATUS_ID }))
    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(serialized(row))
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(STATUS_ID, 'ticket_status', 'status ID')
    expect(hoisted.getTicketStatusMock).toHaveBeenCalledWith(STATUS_ID)
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
  })

  it('serializes archived detail statuses with an ISO deletedAt timestamp', async () => {
    const row = statusRow({ deletedAt: new Date('2026-02-03T00:00:00.000Z') })
    hoisted.getTicketStatusMock.mockResolvedValue(row)

    const response = await detailHandlers.GET(args({ statusId: STATUS_ID }))

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(serialized(row))
  })

  it('returns 404 when the status does not exist', async () => {
    hoisted.getTicketStatusMock.mockResolvedValue(null)

    const response = await detailHandlers.GET(args({ statusId: STATUS_ID }))
    expect(response.status).toBe(404)
  })

  it('returns 403 when the GET caller is not authorised', async () => {
    hoisted.withApiKeyAuthMock.mockRejectedValueOnce(new ForbiddenError('FORBIDDEN', 'nope'))

    const response = await detailHandlers.GET(args({ statusId: STATUS_ID }))
    expect(response.status).toBe(403)
    expect(hoisted.getTicketStatusMock).not.toHaveBeenCalled()
  })

  it('maps an invalid id (parseTypeId throws) to 400 on GET', async () => {
    hoisted.parseTypeIdMock.mockImplementationOnce(() => {
      throw new ValidationError('VALIDATION_ERROR', 'Invalid status ID format')
    })

    const response = await detailHandlers.GET(args({ statusId: 'not-an-id' }))
    expect(response.status).toBe(400)
    expect(hoisted.getTicketStatusMock).not.toHaveBeenCalled()
  })

  it('patches a status, gating on admin and passing the parsed body through', async () => {
    const row = statusRow({ name: 'Renamed', position: 5 })
    hoisted.updateTicketStatusMock.mockResolvedValue(row)

    const response = await detailHandlers.PATCH(
      args(
        { statusId: STATUS_ID },
        jsonRequest('http://test/api/v1/ticket-statuses/ticket_status_123', 'PATCH', {
          name: 'Renamed',
          color: '#445566',
          category: 'on_hold',
          position: 5,
          isDefault: true,
        })
      )
    )
    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(serialized(row))
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'admin' })
    expect(hoisted.updateTicketStatusMock).toHaveBeenCalledWith(
      STATUS_ID,
      {
        name: 'Renamed',
        color: '#445566',
        category: 'on_hold',
        position: 5,
        isDefault: true,
      },
      { principalId: PRINCIPAL }
    )
  })

  it('accepts an empty patch body (all fields optional)', async () => {
    const row = statusRow()
    hoisted.updateTicketStatusMock.mockResolvedValue(row)

    const response = await detailHandlers.PATCH(
      args(
        { statusId: STATUS_ID },
        jsonRequest('http://test/api/v1/ticket-statuses/ticket_status_123', 'PATCH', {})
      )
    )
    expect(response.status).toBe(200)
    expect(hoisted.updateTicketStatusMock).toHaveBeenCalledWith(
      STATUS_ID,
      {},
      {
        principalId: PRINCIPAL,
      }
    )
  })

  it('rejects an invalid patch body with 400 before calling the service', async () => {
    const response = await detailHandlers.PATCH(
      args(
        { statusId: STATUS_ID },
        jsonRequest('http://test/api/v1/ticket-statuses/ticket_status_123', 'PATCH', {
          color: 'red',
        })
      )
    )
    expect(response.status).toBe(400)
    expect(hoisted.updateTicketStatusMock).not.toHaveBeenCalled()
  })

  it('treats a non-JSON patch body as null and returns 400', async () => {
    const badRequest = new Request('http://test/api/v1/ticket-statuses/ticket_status_123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const response = await detailHandlers.PATCH(args({ statusId: STATUS_ID }, badRequest))
    expect(response.status).toBe(400)
    expect(hoisted.updateTicketStatusMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the patch caller is not an admin', async () => {
    hoisted.withApiKeyAuthMock.mockRejectedValueOnce(new ForbiddenError('FORBIDDEN', 'nope'))

    const response = await detailHandlers.PATCH(
      args(
        { statusId: STATUS_ID },
        jsonRequest('http://test/api/v1/ticket-statuses/ticket_status_123', 'PATCH', {
          name: 'Renamed',
        })
      )
    )
    expect(response.status).toBe(403)
    expect(hoisted.updateTicketStatusMock).not.toHaveBeenCalled()
  })

  it('routes a service not-found (STATUS_NOT_FOUND) to 404 on patch', async () => {
    hoisted.updateTicketStatusMock.mockRejectedValueOnce(
      new NotFoundError('STATUS_NOT_FOUND', 'missing')
    )

    const response = await detailHandlers.PATCH(
      args(
        { statusId: STATUS_ID },
        jsonRequest('http://test/api/v1/ticket-statuses/ticket_status_123', 'PATCH', {
          name: 'Renamed',
        })
      )
    )
    expect(response.status).toBe(404)
  })

  it('archives a status (204) when no active ticket references it', async () => {
    hoisted.dbSelectMock.mockReturnValueOnce(makeRefChain([{ count: 0 }]))
    hoisted.archiveTicketStatusMock.mockResolvedValue(undefined)

    const response = await detailHandlers.DELETE(args({ statusId: STATUS_ID }))
    expect(response.status).toBe(204)
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'admin' })
    expect(hoisted.archiveTicketStatusMock).toHaveBeenCalledWith(STATUS_ID, {
      principalId: PRINCIPAL,
    })
  })

  it('archives a status when the count row is absent (the ?? 0 nullish fallback)', async () => {
    // Empty result set → refRows[0] is undefined → referencedBy falls back to 0.
    hoisted.dbSelectMock.mockReturnValueOnce(makeRefChain([]))
    hoisted.archiveTicketStatusMock.mockResolvedValue(undefined)

    const response = await detailHandlers.DELETE(args({ statusId: STATUS_ID }))
    expect(response.status).toBe(204)
    expect(hoisted.archiveTicketStatusMock).toHaveBeenCalledWith(STATUS_ID, {
      principalId: PRINCIPAL,
    })
  })

  it('returns 409 (without archiving) when active tickets still reference the status', async () => {
    hoisted.dbSelectMock.mockReturnValueOnce(makeRefChain([{ count: 3 }]))

    const response = await detailHandlers.DELETE(args({ statusId: STATUS_ID }))
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.error.message).toContain('3 active ticket(s)')
    expect(hoisted.archiveTicketStatusMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the delete caller is not an admin (before the ref query)', async () => {
    hoisted.withApiKeyAuthMock.mockRejectedValueOnce(new ForbiddenError('FORBIDDEN', 'nope'))

    const response = await detailHandlers.DELETE(args({ statusId: STATUS_ID }))
    expect(response.status).toBe(403)
    expect(hoisted.dbSelectMock).not.toHaveBeenCalled()
    expect(hoisted.archiveTicketStatusMock).not.toHaveBeenCalled()
  })

  it('routes a service error during archive through handleDomainError', async () => {
    hoisted.dbSelectMock.mockReturnValueOnce(makeRefChain([{ count: 0 }]))
    hoisted.archiveTicketStatusMock.mockRejectedValueOnce(
      new NotFoundError('STATUS_NOT_FOUND', 'missing')
    )

    const response = await detailHandlers.DELETE(args({ statusId: STATUS_ID }))
    expect(response.status).toBe(404)
  })
})
