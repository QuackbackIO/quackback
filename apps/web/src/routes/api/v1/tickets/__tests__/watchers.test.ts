import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuth = vi.fn()
const mockList = vi.fn()
const mockAdd = vi.fn()
const mockRemove = vi.fn()
const mockListTickets = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...a: unknown[]) => mockAuth(...a),
}))
vi.mock('@/lib/server/domains/tickets/ticket-watchers.service', () => ({
  listWatchersOfTicket: (...a: unknown[]) => mockList(...a),
  addTicketWatcher: (...a: unknown[]) => mockAdd(...a),
  removeTicketWatcher: (...a: unknown[]) => mockRemove(...a),
}))
vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  listTickets: (...a: unknown[]) => mockListTickets(...a),
}))

import { ValidationError, NotFoundError } from '@/lib/shared/errors'
import { Route as WatchersRoute } from '../$ticketId.watchers'
import { Route as WatcherRoute } from '../$ticketId.watchers.$principalId'
import { Route as ListRoute } from '../index'

type Handler = (a: { request: Request; params: Record<string, string> }) => Promise<Response>
const handler = (route: unknown, method: 'GET' | 'POST' | 'DELETE'): Handler =>
  (route as { options: { server: { handlers: Record<string, Handler> } } }).options.server.handlers[
    method
  ]

const TICKET_ID = 'ticket_01h455vb4pex5vsknk084sn02q'
const MATE_ID = 'principal_01h455vb4pex5vsknk084sn02q'
const BASE = `https://x.test/api/v1/tickets/${TICKET_ID}/watchers`

const watcher = {
  principalId: MATE_ID,
  reason: 'manual',
  mutedUntil: null,
  displayName: 'Max Mate',
  avatarUrl: null,
  role: 'member',
  isTeamMember: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({
    principalId: 'principal_key',
    role: 'admin',
    permissions: new Set(['ticket.view', 'ticket.assign']),
  })
  mockList.mockResolvedValue([watcher])
})

describe('GET /api/v1/tickets/:id/watchers', () => {
  it('lists watchers on ticket.view, names and avatars only', async () => {
    const res = await handler(
      WatchersRoute,
      'GET'
    )({
      request: new Request(BASE),
      params: { ticketId: TICKET_ID },
    })
    expect(res.status).toBe(200)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { permission: 'ticket.view' })
    expect((await res.json()).data).toEqual([
      {
        principalId: MATE_ID,
        displayName: 'Max Mate',
        avatarUrl: null,
        isTeamMember: true,
        reason: 'manual',
        mutedUntil: null,
      },
    ])
    expect(mockList.mock.calls[0][1].principalType).toBe('service')
  })

  it('404s a ticket the service cannot find', async () => {
    mockList.mockRejectedValue(new NotFoundError('TICKET_NOT_FOUND', 'Ticket not found'))
    const res = await handler(
      WatchersRoute,
      'GET'
    )({
      request: new Request(BASE),
      params: { ticketId: TICKET_ID },
    })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/v1/tickets/:id/watchers', () => {
  const post = (body: unknown) =>
    handler(
      WatchersRoute,
      'POST'
    )({
      request: new Request(BASE, { method: 'POST', body: JSON.stringify(body) }),
      params: { ticketId: TICKET_ID },
    })

  it('adds a teammate on ticket.assign: 201 when added, 200 when already watching', async () => {
    mockAdd.mockResolvedValueOnce({ added: true })
    const created = await post({ principalId: MATE_ID })
    expect(created.status).toBe(201)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { permission: 'ticket.assign' })
    expect(mockAdd).toHaveBeenCalledWith(TICKET_ID, MATE_ID, expect.anything())

    mockAdd.mockResolvedValueOnce({ added: false })
    expect((await post({ principalId: MATE_ID })).status).toBe(200)
  })

  it('400s a missing or malformed principal id before reaching the service', async () => {
    expect((await post({})).status).toBe(400)
    expect((await post({ principalId: 'not-a-typeid' })).status).toBe(400)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('400s a teammate the ticket is hidden from', async () => {
    mockAdd.mockRejectedValue(
      new ValidationError('WATCHER_CANNOT_SEE_TICKET', 'This teammate cannot see this ticket')
    )
    const res = await post({ principalId: MATE_ID })
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toContain('cannot see this ticket')
  })
})

describe('DELETE /api/v1/tickets/:id/watchers/:principalId', () => {
  it('removes on ticket.assign and answers 204', async () => {
    mockRemove.mockResolvedValue({ removed: true })
    const res = await handler(
      WatcherRoute,
      'DELETE'
    )({
      request: new Request(`${BASE}/${MATE_ID}`, { method: 'DELETE' }),
      params: { ticketId: TICKET_ID, principalId: MATE_ID },
    })
    expect(res.status).toBe(204)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { permission: 'ticket.assign' })
    expect(mockRemove).toHaveBeenCalledWith(TICKET_ID, MATE_ID, expect.anything())
  })
})

describe('GET /api/v1/tickets?watcherPrincipalId=', () => {
  it('passes the watcher filter through, and 400s a malformed id', async () => {
    mockListTickets.mockResolvedValue({ tickets: [], hasMore: false })
    const ok = await handler(
      ListRoute,
      'GET'
    )({
      request: new Request(`https://x.test/api/v1/tickets?watcherPrincipalId=${MATE_ID}`),
      params: {},
    })
    expect(ok.status).toBe(200)
    expect(mockListTickets.mock.calls[0][0]).toMatchObject({ watcherPrincipalId: MATE_ID })

    const bad = await handler(
      ListRoute,
      'GET'
    )({
      request: new Request('https://x.test/api/v1/tickets?watcherPrincipalId=nope'),
      params: {},
    })
    expect(bad.status).toBe(400)
  })
})
