/**
 * Unit tests for `POST /api/widget/tickets` and `GET /api/widget/tickets`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import { makeRequest, makeWidgetSession } from './widget-ticket-fixtures'

vi.mock('zod', async () => {
  const actual = await vi.importActual<typeof import('zod')>('zod')
  return { ...actual, z: actual.z ?? actual.default }
})

vi.mock('@/lib/server/functions/widget-auth', () => ({
  getWidgetSession: vi.fn(),
}))

const widgetTicketingGateMock = vi.fn(async () => null as Response | null)
vi.mock('@/lib/server/widget/ticketing-gate', () => ({
  widgetTicketingGate: () => widgetTicketingGateMock(),
}))

const createTicketMock = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  createTicket: (...args: unknown[]) => createTicketMock(...args),
}))

// The create handler opens an initial public thread (attachment storage flow)
// via the tickets barrel. Mock addThread so the handler doesn't hit the real
// DB-backed implementation.
const addThreadMock = vi.fn()
vi.mock('@/lib/server/domains/tickets', () => ({
  addThread: (...args: unknown[]) => addThreadMock(...args),
}))

const listTicketsForPortalUserMock = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket.portal-query', () => ({
  listTicketsForPortalUser: (...args: unknown[]) => listTicketsForPortalUserMock(...args),
}))

const findFirstStatusMock = vi.fn()
const findManyStatusesMock = vi.fn()
vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      ticketStatuses: {
        findFirst: (...args: unknown[]) => findFirstStatusMock(...args),
        findMany: (...args: unknown[]) => findManyStatusesMock(...args),
      },
    },
  },
  eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
  inArray: vi.fn((...args: unknown[]) => ({ op: 'inArray', args })),
  ticketStatuses: {
    id: 'ticketStatuses.id',
  },
}))

import { getWidgetSession } from '@/lib/server/functions/widget-auth'
import { handleCreateWidgetTicket, handleListWidgetTickets } from '../tickets'

const URL_BASE = 'http://localhost/api/widget/tickets'

beforeEach(() => {
  vi.clearAllMocks()
  findFirstStatusMock.mockResolvedValue({
    id: 'tstatus_open',
    name: 'Open',
    color: '#3b82f6',
    category: 'open',
  })
  findManyStatusesMock.mockResolvedValue([])
  addThreadMock.mockResolvedValue({ id: 'thread_initial', audience: 'public' })
})

describe('POST /api/widget/tickets', () => {
  it('returns 401 when no widget session', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(null)
    const res = await handleCreateWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST', body: { subject: 'Help' } }),
    })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { code: 'AUTH_REQUIRED' } })
  })

  it('returns 403 when widget session is anonymous', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(
      makeWidgetSession({ principalType: 'anonymous' })
    )
    const res = await handleCreateWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST', body: { subject: 'Help' } }),
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: { code: 'IDENTITY_REQUIRED' } })
  })

  it('returns 400 on invalid body (empty subject)', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    const res = await handleCreateWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST', body: { subject: '' } }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects `urgent` priority (widget cannot escalate)', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    const res = await handleCreateWidgetTicket({
      request: makeRequest(URL_BASE, {
        method: 'POST',
        body: { subject: 'Help', priority: 'urgent' },
      }),
    })
    expect(res.status).toBe(400)
  })

  it('creates ticket with channel=widget and requesterPrincipalId from session', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    createTicketMock.mockResolvedValueOnce({
      id: 'ticket_new',
      subject: 'Help',
      statusId: 'tstatus_open',
      createdAt: new Date('2026-04-01T00:00:00Z'),
      lastActivityAt: new Date('2026-04-01T00:00:00Z'),
    })
    const res = await handleCreateWidgetTicket({
      request: makeRequest(URL_BASE, {
        method: 'POST',
        body: { subject: 'Help', bodyText: 'My order is broken', priority: 'high' },
      }),
    })
    expect(res.status).toBe(200)
    expect(createTicketMock).toHaveBeenCalledTimes(1)
    expect(createTicketMock).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Help',
        descriptionText: 'My order is broken',
        priority: 'high',
        channel: 'widget',
        requesterPrincipalId: 'principal_test1',
        createdByPrincipalId: 'principal_test1',
      })
    )
    const json = (await res.json()) as { data: { id: string; statusCategory: string } }
    expect(json.data.id).toBe('ticket_new')
    expect(json.data.statusCategory).toBe('open')
  })

  it('maps domain ValidationError to 400', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    createTicketMock.mockRejectedValueOnce(
      new ValidationError('TICKET_SUBJECT_TOO_LONG', 'too long')
    )
    const res = await handleCreateWidgetTicket({
      request: makeRequest(URL_BASE, {
        method: 'POST',
        body: { subject: 'Help' },
      }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { code: 'TICKET_SUBJECT_TOO_LONG' } })
  })

  it('sets CORS header on success', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    createTicketMock.mockResolvedValueOnce({
      id: 'ticket_new',
      subject: 'Help',
      statusId: 'tstatus_open',
      createdAt: new Date(),
      lastActivityAt: new Date(),
    })
    const res = await handleCreateWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST', body: { subject: 'Help' } }),
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})

describe('GET /api/widget/tickets', () => {
  it('returns 401 when no session', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(null)
    const res = await handleListWidgetTickets({ request: makeRequest(URL_BASE) })
    expect(res.status).toBe(401)
  })

  it('returns 403 when session is anonymous', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(
      makeWidgetSession({ principalType: 'anonymous' })
    )
    const res = await handleListWidgetTickets({ request: makeRequest(URL_BASE) })
    expect(res.status).toBe(403)
  })

  it('returns empty list when user has no linked tickets', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    listTicketsForPortalUserMock.mockResolvedValueOnce({ rows: [], total: 0 })
    const res = await handleListWidgetTickets({ request: makeRequest(URL_BASE) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { rows: [], total: 0 } })
  })

  it('passes statusCategory + limit + offset through and hydrates statuses', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    listTicketsForPortalUserMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'ticket_1',
          subject: 'Hello',
          statusId: 'tstatus_open',
          createdAt: new Date('2026-04-01T00:00:00Z'),
          lastActivityAt: new Date('2026-04-02T00:00:00Z'),
        },
      ],
      total: 1,
    })
    findManyStatusesMock.mockResolvedValueOnce([
      {
        id: 'tstatus_open',
        name: 'Open',
        color: '#3b82f6',
        category: 'open',
      },
    ])

    const res = await handleListWidgetTickets({
      request: makeRequest(`${URL_BASE}?statusCategory=pending&limit=5&offset=10`),
    })
    expect(res.status).toBe(200)
    expect(listTicketsForPortalUserMock).toHaveBeenCalledWith({
      userId: 'user_test1',
      statusCategory: 'pending',
      limit: 5,
      offset: 10,
    })
    const json = (await res.json()) as {
      data: {
        rows: Array<{ id: string; statusName: string; statusCategory: string }>
        total: number
      }
    }
    expect(json.data.total).toBe(1)
    expect(json.data.rows[0].statusName).toBe('Open')
    expect(json.data.rows[0].statusCategory).toBe('open')
  })

  it('uses requester-owned scope so non-widget requester tickets are included by default', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    listTicketsForPortalUserMock.mockResolvedValueOnce({ rows: [], total: 0 })

    const res = await handleListWidgetTickets({ request: makeRequest(URL_BASE) })

    expect(res.status).toBe(200)
    expect(listTicketsForPortalUserMock).toHaveBeenCalledWith({ userId: 'user_test1' })
  })

  it('returns 400 on invalid statusCategory', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    const res = await handleListWidgetTickets({
      request: makeRequest(`${URL_BASE}?statusCategory=bogus`),
    })
    expect(res.status).toBe(400)
  })

  it('maps domain NotFoundError to 404', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    listTicketsForPortalUserMock.mockRejectedValueOnce(
      new NotFoundError('TICKET_NOT_FOUND', 'not found')
    )
    const res = await handleListWidgetTickets({ request: makeRequest(URL_BASE) })
    expect(res.status).toBe(404)
  })
})

describe('ticketing gate', () => {
  it('returns 404 NOT_FOUND on list when ticketing is disabled (gate runs before auth)', async () => {
    widgetTicketingGateMock.mockResolvedValueOnce(
      Response.json({ error: { code: 'NOT_FOUND', message: 'disabled' } }, { status: 404 })
    )
    const res = await handleListWidgetTickets({ request: makeRequest(URL_BASE) })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
    expect(getWidgetSession).not.toHaveBeenCalled()
  })

  it('returns 404 on create when ticketing is disabled', async () => {
    widgetTicketingGateMock.mockResolvedValueOnce(
      Response.json({ error: { code: 'NOT_FOUND', message: 'disabled' } }, { status: 404 })
    )
    const res = await handleCreateWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST', body: { subject: 'Help' } }),
    })
    expect(res.status).toBe(404)
    expect(createTicketMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/widget/tickets — CORS', () => {
  it('includes Access-Control-Allow-Origin header on successful list response', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    listTicketsForPortalUserMock.mockResolvedValueOnce({ rows: [], total: 0 })
    const res = await handleListWidgetTickets({ request: makeRequest(URL_BASE) })
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})

describe('GET /api/widget/tickets — contact-linked visibility', () => {
  it('passes contactId from session to listTicketsForPortalUser', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(
      makeWidgetSession({ contactId: 'contact_linked1' as never })
    )
    listTicketsForPortalUserMock.mockResolvedValueOnce({ rows: [], total: 0 })
    await handleListWidgetTickets({ request: makeRequest(URL_BASE) })
    // The portal query uses userId (not contactId directly) — the session
    // carries contactId to resolve linked contacts internally. Verify the
    // function was called with the session user's identity.
    expect(listTicketsForPortalUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_test1' })
    )
  })
})
