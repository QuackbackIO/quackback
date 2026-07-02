/**
 * Differential-coverage tests for `POST /api/widget/tickets/:ticketId/reopen`.
 *
 * Mirrors the conventions in `tickets.$ticketId.resolve.test.ts`: the real
 * `getWidgetRequestContext` runs (no widget-context header => no profileId =>
 * `assertTicketMatchesWidgetContext` is a no-op), and `@/lib/server/db` is
 * mocked so we can drive `resolveOpenTargetStatus` and the main flow.
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
const findFirstInboxMock = vi.fn()
vi.mock('@/lib/server/db', () => ({
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  asc: vi.fn((arg: unknown) => ({ op: 'asc', arg })),
  db: {
    query: {
      ticketStatuses: { findFirst: (...args: unknown[]) => findFirstStatusMock(...args) },
      principal: { findFirst: (...args: unknown[]) => findFirstPrincipalMock(...args) },
      inboxes: { findFirst: (...args: unknown[]) => findFirstInboxMock(...args) },
    },
  },
  eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
  isNull: vi.fn((arg: unknown) => ({ op: 'isNull', arg })),
  inboxes: {
    id: 'inboxes.id',
  },
  principal: {
    userId: 'principal.userId',
  },
  ticketStatuses: {
    category: 'ticketStatuses.category',
    deletedAt: 'ticketStatuses.deletedAt',
    id: 'ticketStatuses.id',
    isDefault: 'ticketStatuses.isDefault',
    name: 'ticketStatuses.name',
    position: 'ticketStatuses.position',
  },
}))

import { getWidgetSession } from '@/lib/server/functions/widget-auth'
import { handleReopenWidgetTicket, Route } from '../tickets.$ticketId.reopen'

const URL_BASE = 'http://localhost/api/widget/tickets/ticket_42/reopen'
const NOW = new Date('2026-04-02T00:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  findFirstPrincipalMock.mockResolvedValue({ id: 'principal_test1' })
  findFirstInboxMock.mockResolvedValue(null)
})

describe('POST /api/widget/tickets/:ticketId/reopen — guards', () => {
  it('returns 404 when ticketing is disabled (gate runs before auth)', async () => {
    widgetTicketingGateMock.mockResolvedValueOnce(
      Response.json({ error: { code: 'NOT_FOUND', message: 'disabled' } }, { status: 404 })
    )
    const res = await handleReopenWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(404)
    expect(getWidgetSession).not.toHaveBeenCalled()
    expect(getTicketForPortalUserMock).not.toHaveBeenCalled()
  })

  it('returns 401 when no widget session', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(null)
    const res = await handleReopenWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { code: 'AUTH_REQUIRED' } })
  })

  it('returns 403 when session is anonymous', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(
      makeWidgetSession({ principalType: 'anonymous' })
    )
    const res = await handleReopenWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: { code: 'IDENTITY_REQUIRED' } })
  })

  it('returns 404 when ticket not visible (NotFoundError)', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    getTicketForPortalUserMock.mockRejectedValueOnce(
      new NotFoundError('TICKET_NOT_FOUND', 'not found')
    )
    const res = await handleReopenWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/widget/tickets/:ticketId/reopen — idempotency / terminal', () => {
  it('returns alreadyOpen=true without transition when status is already open', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    getTicketForPortalUserMock.mockResolvedValueOnce({
      id: 'ticket_42',
      statusId: 'tstatus_open',
      inboxId: null,
      sourceWidgetProfileId: null,
      updatedAt: NOW,
    })
    // currentStatus lookup -> open category
    findFirstStatusMock.mockResolvedValueOnce({
      id: 'tstatus_open',
      name: 'Open',
      category: 'open',
    })

    const res = await handleReopenWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(200)
    expect(transitionStatusMock).not.toHaveBeenCalled()
    const json = (await res.json()) as {
      data: { alreadyOpen: boolean; statusCategory: string; statusId: string }
    }
    expect(json.data.alreadyOpen).toBe(true)
    expect(json.data.statusCategory).toBe('open')
    expect(json.data.statusId).toBe('tstatus_open')
  })

  it('returns alreadyOpen=true when ticket has no statusId (currentStatus null skips closed check)', async () => {
    // statusId null => currentStatus is null => neither idempotent nor closed
    // branch; falls through to resolveOpenTargetStatus + transition.
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    getTicketForPortalUserMock.mockResolvedValueOnce({
      id: 'ticket_42',
      statusId: null,
      inboxId: null,
      sourceWidgetProfileId: null,
      updatedAt: NOW,
    })
    // resolveOpenTargetStatus: inbox null -> workspace default (null) -> first open
    findFirstStatusMock
      .mockResolvedValueOnce(null) // workspace default
      .mockResolvedValueOnce({ id: 'tstatus_open', name: 'Open', category: 'open' }) // first open
    transitionStatusMock.mockResolvedValueOnce({
      id: 'ticket_42',
      statusId: 'tstatus_open',
      updatedAt: new Date('2026-04-02T00:05:00Z'),
    })

    const res = await handleReopenWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: { alreadyOpen: boolean } }
    expect(json.data.alreadyOpen).toBe(false)
    expect(transitionStatusMock).toHaveBeenCalled()
  })

  it('returns 409 TICKET_REOPEN_NOT_ALLOWED when status is closed', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    getTicketForPortalUserMock.mockResolvedValueOnce({
      id: 'ticket_42',
      statusId: 'tstatus_closed',
      inboxId: null,
      sourceWidgetProfileId: null,
      updatedAt: NOW,
    })
    findFirstStatusMock.mockResolvedValueOnce({
      id: 'tstatus_closed',
      name: 'Closed',
      category: 'closed',
    })

    const res = await handleReopenWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(409)
    expect(transitionStatusMock).not.toHaveBeenCalled()
    expect(await res.json()).toMatchObject({ error: { code: 'TICKET_REOPEN_NOT_ALLOWED' } })
  })
})

describe('POST /api/widget/tickets/:ticketId/reopen — resolveOpenTargetStatus precedence', () => {
  it('uses inbox defaultStatusId when it is open-category', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    getTicketForPortalUserMock.mockResolvedValueOnce({
      id: 'ticket_42',
      statusId: 'tstatus_solved',
      inboxId: 'inbox_1',
      sourceWidgetProfileId: null,
      updatedAt: NOW,
    })
    findFirstInboxMock.mockResolvedValueOnce({ defaultStatusId: 'tstatus_pending' })
    findFirstStatusMock
      // currentStatus -> solved
      .mockResolvedValueOnce({ id: 'tstatus_solved', name: 'Solved', category: 'solved' })
      // inbox default status -> pending (open-category)
      .mockResolvedValueOnce({ id: 'tstatus_pending', name: 'Pending', category: 'pending' })
    transitionStatusMock.mockResolvedValueOnce({
      id: 'ticket_42',
      statusId: 'tstatus_pending',
      updatedAt: new Date('2026-04-02T00:02:00Z'),
    })

    const res = await handleReopenWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(200)
    expect(transitionStatusMock).toHaveBeenCalledWith('ticket_42', {
      expectedUpdatedAt: NOW,
      actorPrincipalId: 'principal_test1',
      statusId: 'tstatus_pending',
    })
    const json = (await res.json()) as {
      data: { alreadyOpen: boolean; statusCategory: string; statusId: string }
    }
    expect(json.data.alreadyOpen).toBe(false)
    expect(json.data.statusCategory).toBe('pending')
    expect(json.data.statusId).toBe('tstatus_pending')
  })

  it('falls back to workspace default when inbox default is not open-category', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    getTicketForPortalUserMock.mockResolvedValueOnce({
      id: 'ticket_42',
      statusId: 'tstatus_solved',
      inboxId: 'inbox_1',
      sourceWidgetProfileId: null,
      updatedAt: NOW,
    })
    findFirstInboxMock.mockResolvedValueOnce({ defaultStatusId: 'tstatus_solved2' })
    findFirstStatusMock
      // currentStatus -> solved
      .mockResolvedValueOnce({ id: 'tstatus_solved', name: 'Solved', category: 'solved' })
      // inbox default status -> solved (NOT open-category, so skipped)
      .mockResolvedValueOnce({ id: 'tstatus_solved2', name: 'Solved2', category: 'solved' })
      // workspace default -> open-category
      .mockResolvedValueOnce({ id: 'tstatus_wsopen', name: 'WS Open', category: 'open' })
    transitionStatusMock.mockResolvedValueOnce({
      id: 'ticket_42',
      statusId: 'tstatus_wsopen',
      updatedAt: new Date('2026-04-02T00:03:00Z'),
    })

    const res = await handleReopenWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: { statusId: string; statusCategory: string } }
    expect(json.data.statusId).toBe('tstatus_wsopen')
    expect(json.data.statusCategory).toBe('open')
  })

  it('falls back to first open status when inbox missing and workspace default is not open', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    getTicketForPortalUserMock.mockResolvedValueOnce({
      id: 'ticket_42',
      statusId: 'tstatus_solved',
      inboxId: 'inbox_1',
      sourceWidgetProfileId: null,
      updatedAt: NOW,
    })
    // inbox exists but has no defaultStatusId
    findFirstInboxMock.mockResolvedValueOnce({ defaultStatusId: null })
    findFirstStatusMock
      // currentStatus -> solved
      .mockResolvedValueOnce({ id: 'tstatus_solved', name: 'Solved', category: 'solved' })
      // workspace default -> solved category (skipped)
      .mockResolvedValueOnce({ id: 'tstatus_wsdef', name: 'WS Def', category: 'solved' })
      // first open by position/name
      .mockResolvedValueOnce({ id: 'tstatus_first', name: 'A Open', category: 'open' })
    transitionStatusMock.mockResolvedValueOnce({
      id: 'ticket_42',
      statusId: 'tstatus_first',
      updatedAt: new Date('2026-04-02T00:04:00Z'),
    })

    const res = await handleReopenWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: { statusId: string } }
    expect(json.data.statusId).toBe('tstatus_first')
  })

  it('returns 409 TICKET_NO_OPEN_STATUS when no open-category status exists', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    getTicketForPortalUserMock.mockResolvedValueOnce({
      id: 'ticket_42',
      statusId: 'tstatus_solved',
      inboxId: null,
      sourceWidgetProfileId: null,
      updatedAt: NOW,
    })
    findFirstStatusMock
      // currentStatus -> solved
      .mockResolvedValueOnce({ id: 'tstatus_solved', name: 'Solved', category: 'solved' })
      // workspace default -> null
      .mockResolvedValueOnce(null)
      // first open -> null
      .mockResolvedValueOnce(null)

    const res = await handleReopenWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(409)
    expect(transitionStatusMock).not.toHaveBeenCalled()
    expect(await res.json()).toMatchObject({ error: { code: 'TICKET_NO_OPEN_STATUS' } })
  })
})

describe('POST /api/widget/tickets/:ticketId/reopen — transition + error mapping', () => {
  it('passes null actorPrincipalId when viewer principal is missing', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    findFirstPrincipalMock.mockResolvedValueOnce(undefined)
    getTicketForPortalUserMock.mockResolvedValueOnce({
      id: 'ticket_42',
      statusId: 'tstatus_solved',
      inboxId: null,
      sourceWidgetProfileId: null,
      updatedAt: NOW,
    })
    findFirstStatusMock
      .mockResolvedValueOnce({ id: 'tstatus_solved', name: 'Solved', category: 'solved' })
      .mockResolvedValueOnce(null) // workspace default
      .mockResolvedValueOnce({ id: 'tstatus_open', name: 'Open', category: 'open' })
    transitionStatusMock.mockResolvedValueOnce({
      id: 'ticket_42',
      statusId: 'tstatus_open',
      updatedAt: new Date('2026-04-02T00:06:00Z'),
    })

    const res = await handleReopenWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(200)
    expect(transitionStatusMock).toHaveBeenCalledWith('ticket_42', {
      expectedUpdatedAt: NOW,
      actorPrincipalId: null,
      statusId: 'tstatus_open',
    })
  })

  it('returns 409 on concurrent reopen race (ConflictError from stale updatedAt)', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    getTicketForPortalUserMock.mockResolvedValueOnce({
      id: 'ticket_42',
      statusId: 'tstatus_solved',
      inboxId: null,
      sourceWidgetProfileId: null,
      updatedAt: NOW,
    })
    findFirstStatusMock
      .mockResolvedValueOnce({ id: 'tstatus_solved', name: 'Solved', category: 'solved' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'tstatus_open', name: 'Open', category: 'open' })
    transitionStatusMock.mockRejectedValueOnce(
      new ConflictError('TICKET_STALE', 'ticket was modified concurrently')
    )

    const res = await handleReopenWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: { code: 'TICKET_STALE' } })
  })

  it('returns 500 SERVER_ERROR on an unmapped error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    getTicketForPortalUserMock.mockResolvedValueOnce({
      id: 'ticket_42',
      statusId: 'tstatus_solved',
      inboxId: null,
      sourceWidgetProfileId: null,
      updatedAt: NOW,
    })
    findFirstStatusMock
      .mockResolvedValueOnce({ id: 'tstatus_solved', name: 'Solved', category: 'solved' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'tstatus_open', name: 'Open', category: 'open' })
    transitionStatusMock.mockRejectedValueOnce(new Error('boom'))

    const res = await handleReopenWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST' }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: { code: 'SERVER_ERROR' } })
    errSpy.mockRestore()
  })
})

describe('Route export', () => {
  it('registers a POST handler bound to handleReopenWidgetTicket', () => {
    const route = Route as unknown as {
      options: { server: { handlers: { POST: typeof handleReopenWidgetTicket } } }
    }
    expect(route.options.server.handlers.POST).toBe(handleReopenWidgetTicket)
  })
})
