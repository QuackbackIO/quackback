/**
 * Unit tests for `GET /api/widget/tickets/:ticketId`.
 *
 * Critical assertion: the response NEVER includes `requesterPrincipalId`
 * (one less identifier exposed across the host page CORS boundary), and
 * threads are public-only (delegated to `listPublicThreadsForTicket`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotFoundError } from '@/lib/shared/errors'
import { makeRequest, makeWidgetSession } from './widget-ticket-fixtures'

vi.mock('@/lib/server/functions/widget-auth', () => ({
  getWidgetSession: vi.fn(),
}))

const widgetTicketingGateMock = vi.fn(async () => null as Response | null)
vi.mock('@/lib/server/widget/ticketing-gate', () => ({
  widgetTicketingGate: () => widgetTicketingGateMock(),
}))

const getTicketForPortalUserMock = vi.fn()
const updatePortalTicketDescriptionMock = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket.portal-query', () => ({
  getTicketForPortalUser: (...args: unknown[]) => getTicketForPortalUserMock(...args),
  updatePortalTicketDescription: (...args: unknown[]) => updatePortalTicketDescriptionMock(...args),
}))

const listPublicThreadsForTicketMock = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket.threads', () => ({
  listPublicThreadsForTicket: (...args: unknown[]) => listPublicThreadsForTicketMock(...args),
}))

const findFirstStatusMock = vi.fn()
const findFirstPrincipalMock = vi.fn()
const selectMock = vi.fn()
vi.mock('@/lib/server/db', () => ({
  eq: (...args: unknown[]) => ({ op: 'eq', args }),
  inArray: (...args: unknown[]) => ({ op: 'inArray', args }),
  principal: { id: 'principal.id', userId: 'principal.userId' },
  ticketStatuses: { id: 'ticketStatuses.id' },
  user: { name: 'user.name' },
  db: {
    query: {
      ticketStatuses: { findFirst: (...args: unknown[]) => findFirstStatusMock(...args) },
      principal: { findFirst: (...args: unknown[]) => findFirstPrincipalMock(...args) },
    },
    select: (...args: unknown[]) => selectMock(...args),
  },
}))

import { getWidgetSession } from '@/lib/server/functions/widget-auth'
import { handleGetWidgetTicket, handlePatchWidgetTicket } from '../tickets.$ticketId'

const URL_BASE = 'http://localhost/api/widget/tickets/ticket_42'
const getWidgetSessionMock = getWidgetSession as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  findFirstStatusMock.mockResolvedValue({
    id: 'tstatus_open',
    name: 'Open',
    color: '#3b82f6',
    category: 'open',
  })
  findFirstPrincipalMock.mockResolvedValue({ id: 'principal_test1' })
  // Default: empty thread author list -> no select() call needed.
  selectMock.mockReturnValue({
    from: () => ({
      leftJoin: () => ({ where: () => Promise.resolve([]) }),
    }),
  })
})

describe('GET /api/widget/tickets/:ticketId', () => {
  it('returns 401 when no widget session', async () => {
    getWidgetSessionMock.mockResolvedValueOnce(null)
    const res = await handleGetWidgetTicket({
      request: makeRequest(URL_BASE),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when session is anonymous', async () => {
    getWidgetSessionMock.mockResolvedValueOnce(makeWidgetSession({ principalType: 'anonymous' }))
    const res = await handleGetWidgetTicket({
      request: makeRequest(URL_BASE),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(403)
  })

  it('returns 404 when ownership predicate yields no row (NotFoundError)', async () => {
    getWidgetSessionMock.mockResolvedValueOnce(makeWidgetSession())
    getTicketForPortalUserMock.mockRejectedValueOnce(
      new NotFoundError('TICKET_NOT_FOUND', 'ticket ticket_42 not found')
    )
    const res = await handleGetWidgetTicket({
      request: makeRequest(URL_BASE),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: { code: 'TICKET_NOT_FOUND' } })
  })

  it('returns ticket + public threads, strips requesterPrincipalId from response', async () => {
    getWidgetSessionMock.mockResolvedValueOnce(makeWidgetSession())
    getTicketForPortalUserMock.mockResolvedValueOnce({
      id: 'ticket_42',
      subject: 'Help',
      descriptionJson: null,
      descriptionText: 'My order is broken',
      statusId: 'tstatus_open',
      requesterPrincipalId: 'principal_test1',
      createdAt: new Date('2026-04-01T00:00:00Z'),
      lastActivityAt: new Date('2026-04-02T00:00:00Z'),
      updatedAt: new Date('2026-04-02T00:00:00Z'),
    })
    listPublicThreadsForTicketMock.mockResolvedValueOnce([
      {
        id: 'thread_1',
        principalId: 'principal_test1',
        audience: 'public',
        bodyJson: null,
        bodyText: 'Reply text',
        createdAt: new Date('2026-04-02T00:00:00Z'),
        editedAt: null,
      },
    ])
    selectMock.mockReturnValueOnce({
      from: () => ({
        leftJoin: () => ({
          where: () => Promise.resolve([{ id: 'principal_test1', userName: 'Jane' }]),
        }),
      }),
    })

    const res = await handleGetWidgetTicket({
      request: makeRequest(URL_BASE),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      data: {
        ticket: Record<string, unknown>
        threads: Array<{ audience: string }>
        principalNames: Record<string, string>
      }
    }
    // Critical: requesterPrincipalId must NOT leak across the widget boundary.
    expect(json.data.ticket).not.toHaveProperty('requesterPrincipalId')
    expect(json.data.ticket.statusName).toBe('Open')
    expect(json.data.threads).toHaveLength(1)
    expect(json.data.threads[0].audience).toBe('public')
    expect(json.data.principalNames['principal_test1']).toBe('Jane')
  })

  it('sets CORS header on success', async () => {
    getWidgetSessionMock.mockResolvedValueOnce(makeWidgetSession())
    getTicketForPortalUserMock.mockResolvedValueOnce({
      id: 'ticket_42',
      subject: 'Help',
      descriptionJson: null,
      descriptionText: null,
      statusId: 'tstatus_open',
      requesterPrincipalId: 'principal_test1',
      createdAt: new Date(),
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    })
    listPublicThreadsForTicketMock.mockResolvedValueOnce([])

    const res = await handleGetWidgetTicket({
      request: makeRequest(URL_BASE),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})

describe('PATCH /api/widget/tickets/:ticketId', () => {
  it('updates the description through the portal access-managed helper', async () => {
    getWidgetSessionMock.mockResolvedValueOnce(makeWidgetSession())
    getTicketForPortalUserMock.mockResolvedValueOnce({
      id: 'ticket_42',
      sourceWidgetProfileId: null,
      inboxId: 'inbox_1',
    })
    updatePortalTicketDescriptionMock.mockResolvedValueOnce({
      id: 'ticket_42',
      updatedAt: new Date('2026-04-02T00:00:01Z'),
    })

    const res = await handlePatchWidgetTicket({
      request: makeRequest(URL_BASE, {
        method: 'PATCH',
        body: {
          expectedUpdatedAt: '2026-04-02T00:00:00.000Z',
          descriptionJson: { type: 'doc', content: [] },
          descriptionText: 'Updated description',
        },
      }),
      params: { ticketId: 'ticket_42' },
    })

    expect(res.status).toBe(200)
    expect(updatePortalTicketDescriptionMock).toHaveBeenCalledWith({
      userId: 'user_test1',
      ticketId: 'ticket_42',
      expectedUpdatedAt: new Date('2026-04-02T00:00:00.000Z'),
      descriptionJson: { type: 'doc', content: [] },
      descriptionText: 'Updated description',
    })
    await expect(res.json()).resolves.toMatchObject({
      data: { id: 'ticket_42', updatedAt: '2026-04-02T00:00:01.000Z' },
    })
  })
})

describe('ticketing gate', () => {
  it('returns 404 when ticketing is disabled (gate runs before auth)', async () => {
    widgetTicketingGateMock.mockResolvedValueOnce(
      Response.json({ error: { code: 'NOT_FOUND', message: 'disabled' } }, { status: 404 })
    )
    const res = await handleGetWidgetTicket({
      request: makeRequest(URL_BASE),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(404)
    expect(getTicketForPortalUserMock).not.toHaveBeenCalled()
    expect(getWidgetSession).not.toHaveBeenCalled()
  })
})
