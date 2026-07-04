import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuth = vi.fn()
const mockListTickets = vi.fn()
const mockGetTicket = vi.fn()
const mockLoadTicket = vi.fn()
const mockListMessages = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...a: unknown[]) => mockAuth(...a),
}))
vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  listTickets: (...a: unknown[]) => mockListTickets(...a),
  getTicket: (...a: unknown[]) => mockGetTicket(...a),
  loadTicketOr404: (...a: unknown[]) => mockLoadTicket(...a),
}))
vi.mock('@/lib/server/domains/tickets/ticket-message.service', () => ({
  listTicketMessages: (...a: unknown[]) => mockListMessages(...a),
}))

import { Route as ListRoute } from '../index'
import { Route as DetailRoute } from '../$ticketId'
import { Route as MessagesRoute } from '../$ticketId.messages'

type Handler = (a: { request: Request; params: Record<string, string> }) => Promise<Response>
const getHandler = (route: unknown): Handler =>
  (route as { options: { server: { handlers: { GET: Handler } } } }).options.server.handlers.GET

const TICKET_ID = 'ticket_01h455vb4pex5vsknk084sn02q'

const ticketDTO = {
  id: TICKET_ID,
  number: 42,
  reference: '#42',
  type: 'customer',
  title: 'Cannot log in',
  status: { id: 's1', name: 'In Progress', color: '#000', category: 'open' },
  stage: { slot: 'in_progress', label: 'In progress' },
  priority: 'high',
  requester: { principalId: 'principal_r', displayName: 'Ada', avatarUrl: null },
  assignee: { principalId: 'principal_a', displayName: 'Grace', teamId: null, teamName: null },
  company: { id: 'company_1', name: 'Acme' },
  firstResponseAt: null,
  dueAt: null,
  resolvedAt: null,
  createdAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z',
  reopenedCount: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ principalId: 'principal_key', role: 'admin' })
})

describe('GET /api/v1/tickets', () => {
  it('lists serialized tickets scoped to a service actor', async () => {
    mockListTickets.mockResolvedValue([ticketDTO])
    const res = await getHandler(ListRoute)({
      request: new Request('https://x.test/api/v1/tickets?type=customer&limit=5'),
      params: {},
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({
      id: TICKET_ID,
      reference: '#42',
      status: { name: 'In Progress', category: 'open' },
      stage: 'in_progress',
      requesterPrincipalId: 'principal_r',
      assigneePrincipalId: 'principal_a',
      companyId: 'company_1',
    })
    // gated on ticket.view; the filter + a service actor reach the domain
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { permission: 'ticket.view' })
    const [filter, actor] = mockListTickets.mock.calls[0]
    expect(filter).toMatchObject({ type: 'customer', limit: 5 })
    expect(actor.principalType).toBe('service')
  })

  it('propagates an auth failure as an error response', async () => {
    mockAuth.mockRejectedValue(Object.assign(new Error('nope'), { status: 401 }))
    const res = await getHandler(ListRoute)({
      request: new Request('https://x.test/api/v1/tickets'),
      params: {},
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(mockListTickets).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/tickets/:id', () => {
  it('returns the serialized ticket', async () => {
    mockGetTicket.mockResolvedValue(ticketDTO)
    const res = await getHandler(DetailRoute)({
      request: new Request(`https://x.test/api/v1/tickets/${TICKET_ID}`),
      params: { ticketId: TICKET_ID },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toMatchObject({ id: TICKET_ID, reference: '#42' })
  })

  it('rejects a malformed ticket id before hitting the domain', async () => {
    const res = await getHandler(DetailRoute)({
      request: new Request('https://x.test/api/v1/tickets/not-a-typeid'),
      params: { ticketId: 'not-a-typeid' },
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(mockGetTicket).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/tickets/:id/messages', () => {
  it('excludes internal notes by default and derives the older-page cursor', async () => {
    mockLoadTicket.mockResolvedValue({ id: TICKET_ID })
    mockListMessages.mockResolvedValue({
      messages: [
        {
          id: 'm_old',
          ticketId: TICKET_ID,
          senderType: 'visitor',
          isInternal: false,
          author: null,
          content: 'first',
          createdAt: '2026-07-04T00:00:00.000Z',
        },
        {
          id: 'm_new',
          ticketId: TICKET_ID,
          senderType: 'agent',
          isInternal: false,
          author: { principalId: 'principal_a', displayName: 'Grace' },
          content: 'reply',
          createdAt: '2026-07-04T00:01:00.000Z',
        },
      ],
      hasMore: true,
    })
    const res = await getHandler(MessagesRoute)({
      request: new Request(`https://x.test/api/v1/tickets/${TICKET_ID}/messages`),
      params: { ticketId: TICKET_ID },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(mockListMessages).toHaveBeenCalledWith(TICKET_ID, {
      before: undefined,
      includeInternal: false,
    })
    expect(body.data.map((m: { id: string }) => m.id)).toEqual(['m_old', 'm_new'])
    // cursor for the next older page = the oldest (first) loaded message
    expect(body.meta.pagination).toEqual({ cursor: 'm_old', hasMore: true })
  })

  it('opts into internal notes with includeInternal=true', async () => {
    mockLoadTicket.mockResolvedValue({ id: TICKET_ID })
    mockListMessages.mockResolvedValue({ messages: [], hasMore: false })
    await getHandler(MessagesRoute)({
      request: new Request(
        `https://x.test/api/v1/tickets/${TICKET_ID}/messages?includeInternal=true`
      ),
      params: { ticketId: TICKET_ID },
    })
    expect(mockListMessages).toHaveBeenCalledWith(TICKET_ID, {
      before: undefined,
      includeInternal: true,
    })
  })
})
