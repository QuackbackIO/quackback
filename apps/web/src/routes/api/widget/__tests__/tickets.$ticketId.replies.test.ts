/**
 * Unit tests for `POST /api/widget/tickets/:ticketId/replies`.
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

const addPortalReplyMock = vi.fn()
// The handler re-checks ownership via getTicketForPortalUser before replying,
// then scopes the ticket against the widget context.
const getTicketForPortalUserMock = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket.portal-query', () => ({
  addPortalReply: (...args: unknown[]) => addPortalReplyMock(...args),
  getTicketForPortalUser: (...args: unknown[]) => getTicketForPortalUserMock(...args),
}))

import { getWidgetSession } from '@/lib/server/functions/widget-auth'
import { handleReplyToWidgetTicket } from '../tickets.$ticketId.replies'

const URL_BASE = 'http://localhost/api/widget/tickets/ticket_42/replies'

beforeEach(() => {
  vi.clearAllMocks()
  // Ownership re-check succeeds by default; individual tests drive behaviour
  // through addPortalReplyMock. The widget context carries no profileId in
  // these requests, so assertTicketMatchesWidgetContext is a no-op.
  getTicketForPortalUserMock.mockResolvedValue({
    id: 'ticket_42',
    sourceWidgetProfileId: null,
    inboxId: null,
  })
})

describe('POST /api/widget/tickets/:ticketId/replies', () => {
  it('returns 401 when no widget session', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(null)
    const res = await handleReplyToWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST', body: { bodyText: 'hi' } }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 403 when session is anonymous', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(
      makeWidgetSession({ principalType: 'anonymous' })
    )
    const res = await handleReplyToWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST', body: { bodyText: 'hi' } }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(403)
  })

  it('returns 404 when ticket not visible to user (NotFoundError)', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    addPortalReplyMock.mockRejectedValueOnce(
      new NotFoundError('TICKET_NOT_FOUND', 'ticket ticket_42 not found')
    )
    const res = await handleReplyToWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST', body: { bodyText: 'hi' } }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(404)
  })

  it('returns 409 when ticket is closed (ConflictError)', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    addPortalReplyMock.mockRejectedValueOnce(
      new ConflictError('TICKET_CLOSED', 'cannot reply to a closed ticket')
    )
    const res = await handleReplyToWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST', body: { bodyText: 'hi' } }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: { code: 'TICKET_CLOSED' } })
  })

  it('posts reply with audience=public hard-coded by addPortalReply', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    addPortalReplyMock.mockResolvedValueOnce({
      id: 'thread_new',
      ticketId: 'ticket_42',
      audience: 'public',
      createdAt: new Date('2026-04-02T00:00:00Z'),
    })
    const res = await handleReplyToWidgetTicket({
      request: makeRequest(URL_BASE, {
        method: 'POST',
        body: { bodyText: 'Thanks for the update!' },
      }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(200)
    expect(addPortalReplyMock).toHaveBeenCalledWith({
      userId: 'user_test1',
      ticketId: 'ticket_42',
      bodyJson: null,
      bodyText: 'Thanks for the update!',
    })
    const json = (await res.json()) as { data: { audience: string; id: string } }
    expect(json.data.audience).toBe('public')
    expect(json.data.id).toBe('thread_new')
  })

  it('returns 400 on invalid body', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    const req = new Request(URL_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const res = await handleReplyToWidgetTicket({ request: req, params: { ticketId: 'ticket_42' } })
    expect(res.status).toBe(400)
  })

  it('passes bodyJson when provided alongside bodyText', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(makeWidgetSession())
    const bodyJson = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    }
    addPortalReplyMock.mockResolvedValueOnce({
      id: 'thread_rich',
      ticketId: 'ticket_42',
      audience: 'public',
      createdAt: new Date('2026-04-02T00:00:00Z'),
    })
    const res = await handleReplyToWidgetTicket({
      request: makeRequest(URL_BASE, {
        method: 'POST',
        body: { bodyText: 'Hello', bodyJson },
      }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(200)
    expect(addPortalReplyMock).toHaveBeenCalledWith({
      userId: 'user_test1',
      ticketId: 'ticket_42',
      bodyJson,
      bodyText: 'Hello',
    })
  })
})

describe('ticketing gate', () => {
  it('returns 404 when ticketing is disabled (gate runs before auth)', async () => {
    widgetTicketingGateMock.mockResolvedValueOnce(
      Response.json({ error: { code: 'NOT_FOUND', message: 'disabled' } }, { status: 404 })
    )
    const res = await handleReplyToWidgetTicket({
      request: makeRequest(URL_BASE, { method: 'POST', body: { bodyText: 'hi' } }),
      params: { ticketId: 'ticket_42' },
    })
    expect(res.status).toBe(404)
    expect(addPortalReplyMock).not.toHaveBeenCalled()
    expect(getWidgetSession).not.toHaveBeenCalled()
  })
})
