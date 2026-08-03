/**
 * Unit tests for `POST /api/widget/tickets/:ticketId/resolve`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConflictError, NotFoundError } from '@/lib/shared/errors'
import { makeRequest, makeWidgetSession } from './widget-ticket-fixtures'

vi.mock('@/lib/server/functions/widget-auth', () => ({
  getWidgetSession: vi.fn(),
}))

const widgetTicketingGateMock = vi.fn(async () => null as Response | null)
vi.mock('@/lib/server/widget/ticketing-gate', () => ({
  widgetTicketingGate: () => widgetTicketingGateMock(),
}))

const getTicketForPortalUserMock = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket.portal-query', () => ({
  getTicketForPortalUser: (...args: unknown[]) => getTicketForPortalUserMock(...args),
}))

const transitionStatusMock = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  transitionStatus: (...args: unknown[]) => transitionStatusMock(...args),
}))

const findFirstStatusMock = vi.fn()
const findFirstPrincipalMock = vi.fn()
vi.mock('@/lib/server/db', () => ({
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  asc: vi.fn((arg: unknown) => ({ op: 'asc', arg })),
  db: {
    query: {
      ticketStatuses: { findFirst: (...args: unknown[]) => findFirstStatusMock(...args) },
      principal: { findFirst: (...args: unknown[]) => findFirstPrincipalMock(...args) },
    },
  },
  eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
  isNull: vi.fn((arg: unknown) => ({ op: 'isNull', arg })),
  principal: {
    userId: 'principal.userId',
  },
  ticketStatuses: {
    category: 'ticketStatuses.category',
    deletedAt: 'ticketStatuses.deletedAt',
    id: 'ticketStatuses.id',
    name: 'ticketStatuses.name',
    position: 'ticketStatuses.position',
  },
}))

import { getWidgetSession } from '@/lib/server/functions/widget-auth'
import { handleResolveWidgetTicket } from '../tickets.$ticketId.resolve'

const URL_BASE = 'http://localhost/api/widget/tickets/ticket_42/resolve'
const NOW = new Date('2026-04-02T00:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  findFirstPrincipalMock.mockResolvedValue({ id: 'principal_test1' })
})

describe('POST /api/widget/tickets/:ticketId/resolve', () => {
  it('returns 401 when no widget session', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(null)
    const res = await handleResolveWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when session is anonymous', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(
      makeWidgetSession({ principalType: 'anonymous' })
    )
    const res = await handleResolveWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(403)
  })

  it('returns 404 when ticket not visible (NotFoundError)', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    getTicketForPortalUserMock.mockRejectedValueOnce(
      new NotFoundError('TICKET_NOT_FOUND', 'not found')
    )
    const res = await handleResolveWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(404)
  })

  it('returns alreadyResolved=true without transition when status is already solved', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    getTicketForPortalUserMock.mockResolvedValueOnce({
      id: 'ticket_42',
      statusId: 'tstatus_solved',
      updatedAt: NOW,
    })
    findFirstStatusMock.mockResolvedValueOnce({
      id: 'tstatus_solved',
      name: 'Solved',
      category: 'solved',
    })

    const res = await handleResolveWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(200)
    expect(transitionStatusMock).not.toHaveBeenCalled()
    const json = (await res.json()) as {
      data: { alreadyResolved: boolean; statusCategory: string }
    }
    expect(json.data.alreadyResolved).toBe(true)
    expect(json.data.statusCategory).toBe('solved')
  })

  it('returns alreadyResolved=true without transition when status is closed', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    getTicketForPortalUserMock.mockResolvedValueOnce({
      id: 'ticket_42',
      statusId: 'tstatus_closed',
      updatedAt: NOW,
    })
    findFirstStatusMock.mockResolvedValueOnce({
      id: 'tstatus_closed',
      name: 'Closed',
      category: 'closed',
    })

    const res = await handleResolveWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(200)
    expect(transitionStatusMock).not.toHaveBeenCalled()
  })

  it('transitions to first solved status with optimistic concurrency', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    getTicketForPortalUserMock.mockResolvedValueOnce({
      id: 'ticket_42',
      statusId: 'tstatus_open',
      updatedAt: NOW,
    })
    findFirstStatusMock
      .mockResolvedValueOnce({ id: 'tstatus_open', name: 'Open', category: 'open' })
      .mockResolvedValueOnce({ id: 'tstatus_solved', name: 'Solved', category: 'solved' })
    transitionStatusMock.mockResolvedValueOnce({
      id: 'ticket_42',
      statusId: 'tstatus_solved',
      updatedAt: new Date('2026-04-02T00:01:00Z'),
    })

    const res = await handleResolveWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(200)
    expect(transitionStatusMock).toHaveBeenCalledWith('ticket_42', {
      expectedUpdatedAt: NOW,
      actorPrincipalId: 'principal_test1',
      statusId: 'tstatus_solved',
    })
    const json = (await res.json()) as {
      data: { alreadyResolved: boolean; statusCategory: string; statusId: string }
    }
    expect(json.data.alreadyResolved).toBe(false)
    expect(json.data.statusCategory).toBe('solved')
    expect(json.data.statusId).toBe('tstatus_solved')
  })

  it('returns 409 when no solved-category status is configured', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    getTicketForPortalUserMock.mockResolvedValueOnce({
      id: 'ticket_42',
      statusId: 'tstatus_open',
      updatedAt: NOW,
    })
    findFirstStatusMock
      .mockResolvedValueOnce({ id: 'tstatus_open', name: 'Open', category: 'open' })
      .mockResolvedValueOnce(null)

    const res = await handleResolveWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: { code: 'TICKET_NO_SOLVED_STATUS' } })
  })

  it('returns 409 on concurrent resolve race (ConflictError from stale updatedAt)', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    getTicketForPortalUserMock.mockResolvedValueOnce({
      id: 'ticket_42',
      statusId: 'tstatus_open',
      updatedAt: NOW,
    })
    findFirstStatusMock
      .mockResolvedValueOnce({ id: 'tstatus_open', name: 'Open', category: 'open' })
      .mockResolvedValueOnce({ id: 'tstatus_solved', name: 'Solved', category: 'solved' })
    transitionStatusMock.mockRejectedValueOnce(
      new ConflictError('TICKET_STALE', 'ticket was modified concurrently')
    )

    const res = await handleResolveWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: { code: 'TICKET_STALE' } })
  })
})

describe('ticketing gate', () => {
  it('returns 404 when ticketing is disabled (gate runs before auth)', async () => {
    widgetTicketingGateMock.mockResolvedValueOnce(
      Response.json({ error: { code: 'NOT_FOUND', message: 'disabled' } }, { status: 404 })
    )
    const res = await handleResolveWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(404)
    expect(getTicketForPortalUserMock).not.toHaveBeenCalled()
    expect(getWidgetSession).not.toHaveBeenCalled()
  })
})
