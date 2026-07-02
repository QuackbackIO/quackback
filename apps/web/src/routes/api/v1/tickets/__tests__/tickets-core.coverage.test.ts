/**
 * Request-level behaviour coverage for the core ticket REST routes:
 *   - tickets/index.ts                  (GET queue, POST create)
 *   - tickets/$ticketId.ts              (GET, PATCH, DELETE)
 *   - tickets/$ticketId.transition.ts   (POST)
 *   - tickets/$ticketId.activity.ts     (GET)
 *
 * Mirrors the canonical inboxes.test.ts pattern: every dependency is hoisted
 * and mocked, the Route objects are imported after the mocks, and the raw
 * handler map is pulled off `Route.options.server.handlers`.
 *
 * British spelling is used in comments per repo convention (behaviour,
 * organisation, authorise).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/server/domains/authz'

const hoisted = vi.hoisted(() => ({
  withApiKeyAuthMock: vi.fn(),
  assertScopeAllowedMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  // tickets domain service surface
  createTicketMock: vi.fn(),
  listTicketsMock: vi.fn(),
  getTicketMock: vi.fn(),
  updateTicketMock: vi.fn(),
  softDeleteTicketMock: vi.fn(),
  listSharesForTicketMock: vi.fn(),
  toResourceScopeMock: vi.fn(),
  canViewTicketMock: vi.fn(),
  canEditFieldsMock: vi.fn(),
  transitionStatusMock: vi.fn(),
  listTicketActivityMock: vi.fn(),
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

vi.mock('@/lib/server/domains/tickets', () => ({
  createTicket: (...args: unknown[]) => hoisted.createTicketMock(...args),
  listTickets: (...args: unknown[]) => hoisted.listTicketsMock(...args),
  getTicket: (...args: unknown[]) => hoisted.getTicketMock(...args),
  updateTicket: (...args: unknown[]) => hoisted.updateTicketMock(...args),
  softDeleteTicket: (...args: unknown[]) => hoisted.softDeleteTicketMock(...args),
  listSharesForTicket: (...args: unknown[]) => hoisted.listSharesForTicketMock(...args),
  toResourceScope: (...args: unknown[]) => hoisted.toResourceScopeMock(...args),
  canViewTicket: (...args: unknown[]) => hoisted.canViewTicketMock(...args),
  canEditFields: (...args: unknown[]) => hoisted.canEditFieldsMock(...args),
  transitionStatus: (...args: unknown[]) => hoisted.transitionStatusMock(...args),
  listTicketActivity: (...args: unknown[]) => hoisted.listTicketActivityMock(...args),
}))

vi.mock('@/lib/server/domains/audit', () => ({
  recordEvent: (...args: unknown[]) => hoisted.recordEventMock(...args),
}))

// Only the enum constants the routes import for their zod schemas.
vi.mock('@/lib/server/db', () => ({
  TICKET_PRIORITIES: ['low', 'normal', 'high', 'urgent'],
  TICKET_CHANNELS: ['portal', 'email', 'api', 'widget'],
  TICKET_VISIBILITY_SCOPES: ['team', 'org', 'shared', 'private'],
}))

import { Route as ActivityRoute } from '../$ticketId.activity'
import { Route as TransitionRoute } from '../$ticketId.transition'
import { Route as TicketDetailRoute } from '../$ticketId'
import { Route as TicketsRoute } from '../index'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const ticketsHandlers = (TicketsRoute as unknown as RouteWithHandlers).options.server.handlers
const detailHandlers = (TicketDetailRoute as unknown as RouteWithHandlers).options.server.handlers
const transitionHandlers = (TransitionRoute as unknown as RouteWithHandlers).options.server.handlers
const activityHandlers = (ActivityRoute as unknown as RouteWithHandlers).options.server.handlers

const PRINCIPAL = 'principal_admin'
const TICKET = 'ticket_123'
const NOW = '2026-06-19T10:00:00.000Z'

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function args(
  handlerParams: Record<string, string> = {},
  request = new Request('http://test/api/v1/tickets')
) {
  return { request, params: handlerParams }
}

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: TICKET,
    subject: 'Need help',
    priority: 'normal',
    primaryTeamId: 'team_1',
    assigneePrincipalId: null,
    assigneeTeamId: null,
    updatedAt: NOW,
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
  // Scope helpers default to permissive so success paths flow unless overridden.
  hoisted.listSharesForTicketMock.mockResolvedValue([])
  hoisted.toResourceScopeMock.mockReturnValue({ kind: 'team' })
  hoisted.canViewTicketMock.mockReturnValue(true)
  hoisted.canEditFieldsMock.mockReturnValue(true)
})

describe('GET /api/v1/tickets (queue)', () => {
  it('lists with default scope, applies hasMore slice and emits a nextCursor', async () => {
    // limit=2 + the extra probe row means listTickets is called with limit 3.
    const rows = [
      ticket({ id: 'ticket_a' }),
      ticket({ id: 'ticket_b' }),
      ticket({ id: 'ticket_c' }),
    ]
    hoisted.listTicketsMock.mockResolvedValue({ rows, total: 9 })

    const response = await ticketsHandlers.GET(
      args({}, new Request('http://test/api/v1/tickets?limit=2'))
    )

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.data).toHaveLength(2)
    expect(payload.data.map((r: { id: string }) => r.id)).toEqual(['ticket_a', 'ticket_b'])
    expect(payload.meta.pagination.hasMore).toBe(true)
    expect(payload.meta.pagination.total).toBe(9)
    expect(typeof payload.meta.pagination.cursor).toBe('string')

    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.listTicketsMock).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'my_team', limit: 3, offset: 0 })
    )
  })

  it('returns no nextCursor and the full set when the page is not full', async () => {
    const rows = [ticket({ id: 'ticket_a' })]
    hoisted.listTicketsMock.mockResolvedValue({ rows, total: 1 })

    const response = await ticketsHandlers.GET(
      args({}, new Request('http://test/api/v1/tickets?scope=all&limit=50'))
    )

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.data).toHaveLength(1)
    expect(payload.meta.pagination.hasMore).toBe(false)
    expect(payload.meta.pagination.cursor).toBeNull()
    expect(hoisted.listTicketsMock).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'all', limit: 51, offset: 0 })
    )
  })

  it('passes through search, statusCategory and resolves a real inboxId', async () => {
    hoisted.listTicketsMock.mockResolvedValue({ rows: [], total: 0 })

    await ticketsHandlers.GET(
      args(
        {},
        new Request(
          'http://test/api/v1/tickets?scope=inbox&statusCategory=open&search=printer&inboxId=inbox_77'
        )
      )
    )

    expect(hoisted.listTicketsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'inbox',
        statusCategory: 'open',
        search: 'printer',
        inboxId: 'inbox_77',
      })
    )
  })

  it('treats inboxId=null and inboxId="" as an explicit null (no inbox)', async () => {
    hoisted.listTicketsMock.mockResolvedValue({ rows: [], total: 0 })

    await ticketsHandlers.GET(args({}, new Request('http://test/api/v1/tickets?inboxId=null')))
    expect(hoisted.listTicketsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ inboxId: null })
    )

    await ticketsHandlers.GET(args({}, new Request('http://test/api/v1/tickets?inboxId=')))
    expect(hoisted.listTicketsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ inboxId: null })
    )
  })

  it('decodes a provided cursor into the offset and caps the limit at 200', async () => {
    hoisted.listTicketsMock.mockResolvedValue({ rows: [], total: 0 })
    // base64url of {"offset":40}
    const cursor = Buffer.from(JSON.stringify({ offset: 40 })).toString('base64url')

    await ticketsHandlers.GET(
      args({}, new Request(`http://test/api/v1/tickets?cursor=${cursor}&limit=999`))
    )

    expect(hoisted.listTicketsMock).toHaveBeenCalledWith(
      // limit clamps to 200, then +1 probe row = 201; offset from the cursor.
      expect.objectContaining({ limit: 201, offset: 40 })
    )
  })

  it('rejects an unknown scope with 400 before hitting the service', async () => {
    const response = await ticketsHandlers.GET(
      args({}, new Request('http://test/api/v1/tickets?scope=bogus'))
    )
    expect(response.status).toBe(400)
    expect(hoisted.listTicketsMock).not.toHaveBeenCalled()
  })

  it('rejects an unknown statusCategory with 400 before hitting the service', async () => {
    const response = await ticketsHandlers.GET(
      args({}, new Request('http://test/api/v1/tickets?statusCategory=bogus'))
    )
    expect(response.status).toBe(400)
    expect(hoisted.listTicketsMock).not.toHaveBeenCalled()
  })

  it('maps a thrown domain error to handleDomainError', async () => {
    hoisted.listTicketsMock.mockRejectedValue({ code: 'FORBIDDEN', message: 'nope' })
    const response = await ticketsHandlers.GET(args())
    expect(response.status).toBe(403)
  })
})

describe('POST /api/v1/tickets (create)', () => {
  it('creates a ticket, records the audit event and returns 201', async () => {
    const created = ticket({ id: 'ticket_new', subject: 'Broken login' })
    hoisted.createTicketMock.mockResolvedValue(created)
    hoisted.recordEventMock.mockResolvedValue(undefined)

    const response = await ticketsHandlers.POST(
      args(
        {},
        jsonRequest('http://test/api/v1/tickets', 'POST', {
          subject: 'Broken login',
          priority: 'high',
          channel: 'api',
          visibilityScope: 'team',
        })
      )
    )

    expect(response.status).toBe(201)
    expect(await expectJsonData(response)).toEqual(JSON.parse(JSON.stringify(created)))
    expect(hoisted.assertScopeAllowedMock).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.TICKET_EDIT_FIELDS
    )
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(
      expect.any(Set),
      PERMISSIONS.TICKET_EDIT_FIELDS
    )
    expect(hoisted.createTicketMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Broken login',
        priority: 'high',
        channel: 'api',
        createdByPrincipalId: PRINCIPAL,
      })
    )
    expect(hoisted.recordEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: PRINCIPAL,
        action: 'ticket.created',
        targetType: 'ticket',
        targetId: 'ticket_new',
        source: 'api',
      })
    )
  })

  it('returns 403 when the edit-fields permission is missing', async () => {
    hoisted.hasPermissionMock.mockReturnValue(false)
    const response = await ticketsHandlers.POST(
      args({}, jsonRequest('http://test/api/v1/tickets', 'POST', { subject: 'Hi' }))
    )
    expect(response.status).toBe(403)
    expect(hoisted.createTicketMock).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid body and does not create', async () => {
    const response = await ticketsHandlers.POST(
      // subject is required and must be non-empty.
      args({}, jsonRequest('http://test/api/v1/tickets', 'POST', { subject: '' }))
    )
    expect(response.status).toBe(400)
    expect(hoisted.createTicketMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the JSON body cannot be parsed', async () => {
    const badRequest = new Request('http://test/api/v1/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const response = await ticketsHandlers.POST(args({}, badRequest))
    expect(response.status).toBe(400)
    expect(hoisted.createTicketMock).not.toHaveBeenCalled()
  })

  it('routes a thrown service error through handleDomainError', async () => {
    hoisted.createTicketMock.mockRejectedValue({ code: 'CONFLICT', message: 'dup' })
    const response = await ticketsHandlers.POST(
      args({}, jsonRequest('http://test/api/v1/tickets', 'POST', { subject: 'Broken login' }))
    )
    expect(response.status).toBe(409)
  })
})

describe('GET /api/v1/tickets/:ticketId', () => {
  it('returns the ticket when viewable and maps ticket shares into the scope', async () => {
    const row = ticket()
    hoisted.getTicketMock.mockResolvedValue(row)
    // A non-empty shares list exercises the shares.map callback in loadScope.
    hoisted.listSharesForTicketMock.mockResolvedValue([
      { teamId: 'team_2', revokedAt: null },
      { teamId: 'team_3', revokedAt: NOW },
    ])

    const response = await detailHandlers.GET(args({ ticketId: TICKET }))
    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(JSON.parse(JSON.stringify(row)))
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(TICKET, 'ticket', 'ticket ID')
    expect(hoisted.getTicketMock).toHaveBeenCalledWith(TICKET)
    expect(hoisted.canViewTicketMock).toHaveBeenCalledWith(expect.any(Set), { kind: 'team' })
    // The mapped shares are forwarded to toResourceScope.
    expect(hoisted.toResourceScopeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        shares: [
          { teamId: 'team_2', revokedAt: null },
          { teamId: 'team_3', revokedAt: NOW },
        ],
      })
    )
  })

  it('returns 404 when the ticket does not exist', async () => {
    hoisted.getTicketMock.mockResolvedValue(null)
    const response = await detailHandlers.GET(args({ ticketId: TICKET }))
    expect(response.status).toBe(404)
    expect(hoisted.canViewTicketMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller cannot view the ticket', async () => {
    hoisted.getTicketMock.mockResolvedValue(ticket())
    hoisted.canViewTicketMock.mockReturnValue(false)
    const response = await detailHandlers.GET(args({ ticketId: TICKET }))
    expect(response.status).toBe(403)
  })

  it('maps a thrown error (e.g. invalid id) via handleDomainError', async () => {
    hoisted.parseTypeIdMock.mockImplementation(() => {
      throw { code: 'VALIDATION_ERROR', message: 'Invalid ticket ID format', statusCode: 400 }
    })
    const response = await detailHandlers.GET(args({ ticketId: 'bad' }))
    expect(response.status).toBe(400)
  })
})

describe('PATCH /api/v1/tickets/:ticketId', () => {
  it('updates the ticket and returns 200', async () => {
    const row = ticket()
    const updated = ticket({ subject: 'Renamed' })
    hoisted.getTicketMock.mockResolvedValue(row)
    hoisted.updateTicketMock.mockResolvedValue(updated)

    const response = await detailHandlers.PATCH(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123', 'PATCH', {
          expectedUpdatedAt: NOW,
          subject: 'Renamed',
          priority: 'urgent',
        })
      )
    )

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(JSON.parse(JSON.stringify(updated)))
    // expectedUpdatedAt is converted to a Date and the actor stitched in.
    const callArg = hoisted.updateTicketMock.mock.calls[0]
    expect(callArg[0]).toBe(TICKET)
    expect(callArg[1]).toMatchObject({
      subject: 'Renamed',
      priority: 'urgent',
      actorPrincipalId: PRINCIPAL,
    })
    expect(callArg[1].expectedUpdatedAt).toBeInstanceOf(Date)
    expect((callArg[1].expectedUpdatedAt as Date).toISOString()).toBe(NOW)
  })

  it('returns 400 for an invalid body before loading the ticket', async () => {
    const response = await detailHandlers.PATCH(
      // expectedUpdatedAt is required and must be a datetime.
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123', 'PATCH', { subject: 'x' })
      )
    )
    expect(response.status).toBe(400)
    expect(hoisted.getTicketMock).not.toHaveBeenCalled()
    expect(hoisted.updateTicketMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the JSON body cannot be parsed', async () => {
    // Malformed JSON exercises the request.json().catch(() => null) fallback.
    const badRequest = new Request('http://test/api/v1/tickets/ticket_123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const response = await detailHandlers.PATCH(args({ ticketId: TICKET }, badRequest))
    expect(response.status).toBe(400)
    expect(hoisted.getTicketMock).not.toHaveBeenCalled()
    expect(hoisted.updateTicketMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the ticket is missing', async () => {
    hoisted.getTicketMock.mockResolvedValue(null)
    const response = await detailHandlers.PATCH(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123', 'PATCH', {
          expectedUpdatedAt: NOW,
        })
      )
    )
    expect(response.status).toBe(404)
    expect(hoisted.updateTicketMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller cannot edit fields', async () => {
    hoisted.getTicketMock.mockResolvedValue(ticket())
    hoisted.canEditFieldsMock.mockReturnValue(false)
    const response = await detailHandlers.PATCH(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123', 'PATCH', {
          expectedUpdatedAt: NOW,
        })
      )
    )
    expect(response.status).toBe(403)
    expect(hoisted.updateTicketMock).not.toHaveBeenCalled()
  })

  it('routes a thrown service error through handleDomainError', async () => {
    hoisted.getTicketMock.mockResolvedValue(ticket())
    hoisted.updateTicketMock.mockRejectedValue({ code: 'CONFLICT', message: 'stale' })
    const response = await detailHandlers.PATCH(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123', 'PATCH', {
          expectedUpdatedAt: NOW,
        })
      )
    )
    expect(response.status).toBe(409)
  })
})

describe('DELETE /api/v1/tickets/:ticketId', () => {
  it('soft-deletes the ticket and returns 204', async () => {
    hoisted.getTicketMock.mockResolvedValue(ticket())
    hoisted.softDeleteTicketMock.mockResolvedValue(undefined)

    const response = await detailHandlers.DELETE(args({ ticketId: TICKET }))
    expect(response.status).toBe(204)
    expect(hoisted.softDeleteTicketMock).toHaveBeenCalledWith(TICKET, PRINCIPAL)
  })

  it('returns 404 when the ticket is missing', async () => {
    hoisted.getTicketMock.mockResolvedValue(null)
    const response = await detailHandlers.DELETE(args({ ticketId: TICKET }))
    expect(response.status).toBe(404)
    expect(hoisted.softDeleteTicketMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller cannot edit fields', async () => {
    hoisted.getTicketMock.mockResolvedValue(ticket())
    hoisted.canEditFieldsMock.mockReturnValue(false)
    const response = await detailHandlers.DELETE(args({ ticketId: TICKET }))
    expect(response.status).toBe(403)
    expect(hoisted.softDeleteTicketMock).not.toHaveBeenCalled()
  })

  it('routes a thrown service error through handleDomainError', async () => {
    hoisted.getTicketMock.mockResolvedValue(ticket())
    hoisted.softDeleteTicketMock.mockRejectedValue({ code: 'CONFLICT', message: 'locked' })
    const response = await detailHandlers.DELETE(args({ ticketId: TICKET }))
    expect(response.status).toBe(409)
  })
})

describe('POST /api/v1/tickets/:ticketId/transition', () => {
  it('transitions the status and returns 200', async () => {
    const row = ticket()
    const updated = ticket({ statusId: 'tstatus_solved' })
    hoisted.getTicketMock.mockResolvedValue(row)
    hoisted.transitionStatusMock.mockResolvedValue(updated)
    // A non-empty shares list exercises the inline shares.map callback.
    hoisted.listSharesForTicketMock.mockResolvedValue([{ teamId: 'team_2', revokedAt: null }])

    const response = await transitionHandlers.POST(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123/transition', 'POST', {
          expectedUpdatedAt: NOW,
          statusId: 'tstatus_solved',
        })
      )
    )

    expect(response.status).toBe(200)
    expect(await expectJsonData(response)).toEqual(JSON.parse(JSON.stringify(updated)))
    const callArg = hoisted.transitionStatusMock.mock.calls[0]
    expect(callArg[0]).toBe(TICKET)
    expect(callArg[1]).toMatchObject({
      actorPrincipalId: PRINCIPAL,
      statusId: 'tstatus_solved',
    })
    expect(callArg[1].expectedUpdatedAt).toBeInstanceOf(Date)
  })

  it('returns 400 for an invalid body before loading the ticket', async () => {
    const response = await transitionHandlers.POST(
      // statusId is required and must be non-empty.
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123/transition', 'POST', {
          expectedUpdatedAt: NOW,
          statusId: '',
        })
      )
    )
    expect(response.status).toBe(400)
    expect(hoisted.getTicketMock).not.toHaveBeenCalled()
    expect(hoisted.transitionStatusMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the ticket is missing', async () => {
    hoisted.getTicketMock.mockResolvedValue(null)
    const response = await transitionHandlers.POST(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123/transition', 'POST', {
          expectedUpdatedAt: NOW,
          statusId: 'tstatus_solved',
        })
      )
    )
    expect(response.status).toBe(404)
    expect(hoisted.transitionStatusMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller cannot edit fields', async () => {
    hoisted.getTicketMock.mockResolvedValue(ticket())
    hoisted.canEditFieldsMock.mockReturnValue(false)
    const response = await transitionHandlers.POST(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123/transition', 'POST', {
          expectedUpdatedAt: NOW,
          statusId: 'tstatus_solved',
        })
      )
    )
    expect(response.status).toBe(403)
    expect(hoisted.transitionStatusMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the JSON body cannot be parsed', async () => {
    // Malformed JSON exercises the request.json().catch(() => null) fallback.
    const badRequest = new Request('http://test/api/v1/tickets/ticket_123/transition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const response = await transitionHandlers.POST(args({ ticketId: TICKET }, badRequest))
    expect(response.status).toBe(400)
    expect(hoisted.getTicketMock).not.toHaveBeenCalled()
    expect(hoisted.transitionStatusMock).not.toHaveBeenCalled()
  })

  it('routes a thrown service error through handleDomainError', async () => {
    hoisted.getTicketMock.mockResolvedValue(ticket())
    hoisted.transitionStatusMock.mockRejectedValue({ code: 'CONFLICT', message: 'stale' })
    const response = await transitionHandlers.POST(
      args(
        { ticketId: TICKET },
        jsonRequest('http://test/api/v1/tickets/ticket_123/transition', 'POST', {
          expectedUpdatedAt: NOW,
          statusId: 'tstatus_solved',
        })
      )
    )
    expect(response.status).toBe(409)
  })
})

describe('GET /api/v1/tickets/:ticketId/activity', () => {
  function activityRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'tactivity_1',
      ticketId: TICKET,
      principalId: PRINCIPAL,
      type: 'status_changed',
      metadata: { from: 'open', to: 'solved' },
      createdAt: new Date(NOW),
      actorName: 'Demo Agent',
      actorAvatarUrl: null,
      ...overrides,
    }
  }

  it('returns the activity feed with a null cursor when the page is not full', async () => {
    hoisted.getTicketMock.mockResolvedValue(ticket())
    hoisted.listTicketActivityMock.mockResolvedValue([activityRow()])
    // A non-empty shares list exercises the inline shares.map callback.
    hoisted.listSharesForTicketMock.mockResolvedValue([{ teamId: 'team_2', revokedAt: null }])

    const response = await activityHandlers.GET(args({ ticketId: TICKET }))
    expect(response.status).toBe(200)
    const data = await expectJsonData(response)
    expect(data.activity).toHaveLength(1)
    expect(data.activity[0]).toMatchObject({
      id: 'tactivity_1',
      ticketId: TICKET,
      type: 'status_changed',
      createdAt: NOW,
    })
    expect(data.nextCursor).toBeNull()
    // Default limit of 50 is applied when no limit query param is present.
    expect(hoisted.listTicketActivityMock).toHaveBeenCalledWith(
      TICKET,
      expect.objectContaining({ before: undefined, limit: 50 })
    )
  })

  it('emits a nextCursor when the returned page is exactly the requested limit', async () => {
    hoisted.getTicketMock.mockResolvedValue(ticket())
    const older = '2026-06-18T08:00:00.000Z'
    hoisted.listTicketActivityMock.mockResolvedValue([
      activityRow({ id: 'tactivity_1' }),
      activityRow({ id: 'tactivity_2', createdAt: new Date(older) }),
    ])

    const response = await activityHandlers.GET(
      args(
        { ticketId: TICKET },
        new Request(`http://test/api/v1/tickets/ticket_123/activity?limit=2&before=${NOW}`)
      )
    )
    expect(response.status).toBe(200)
    const data = await expectJsonData(response)
    expect(data.nextCursor).toBe(older)
    expect(hoisted.listTicketActivityMock).toHaveBeenCalledWith(
      TICKET,
      expect.objectContaining({ limit: 2 })
    )
    // `before` is parsed into a Date.
    const beforeArg = hoisted.listTicketActivityMock.mock.calls[0][1] as { before: Date }
    expect(beforeArg.before).toBeInstanceOf(Date)
    expect(beforeArg.before.toISOString()).toBe(NOW)
  })

  it('returns 400 for invalid query params', async () => {
    const response = await activityHandlers.GET(
      args(
        { ticketId: TICKET },
        new Request('http://test/api/v1/tickets/ticket_123/activity?limit=0')
      )
    )
    expect(response.status).toBe(400)
    expect(hoisted.getTicketMock).not.toHaveBeenCalled()
    expect(hoisted.listTicketActivityMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the ticket is missing', async () => {
    hoisted.getTicketMock.mockResolvedValue(null)
    const response = await activityHandlers.GET(args({ ticketId: TICKET }))
    expect(response.status).toBe(404)
    expect(hoisted.listTicketActivityMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller cannot view the ticket', async () => {
    hoisted.getTicketMock.mockResolvedValue(ticket())
    hoisted.canViewTicketMock.mockReturnValue(false)
    const response = await activityHandlers.GET(args({ ticketId: TICKET }))
    expect(response.status).toBe(403)
    expect(hoisted.listTicketActivityMock).not.toHaveBeenCalled()
  })

  it('routes a thrown service error through handleDomainError', async () => {
    hoisted.getTicketMock.mockResolvedValue(ticket())
    hoisted.listTicketActivityMock.mockRejectedValue({ code: 'FORBIDDEN', message: 'nope' })
    const response = await activityHandlers.GET(args({ ticketId: TICKET }))
    expect(response.status).toBe(403)
  })
})
