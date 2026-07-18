import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuth = vi.fn()
const mockCreateTicket = vi.fn()
const mockSetStatus = vi.fn()
const mockAssign = vi.fn()
const mockSetPriority = vi.fn()
const mockSendMessage = vi.fn()
const mockAddNote = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...a: unknown[]) => mockAuth(...a),
}))
vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  createTicket: (...a: unknown[]) => mockCreateTicket(...a),
  setTicketStatus: (...a: unknown[]) => mockSetStatus(...a),
  assignTicket: (...a: unknown[]) => mockAssign(...a),
  setTicketPriority: (...a: unknown[]) => mockSetPriority(...a),
}))
vi.mock('@/lib/server/domains/tickets/ticket-message.service', () => ({
  sendTicketMessage: (...a: unknown[]) => mockSendMessage(...a),
  addTicketNote: (...a: unknown[]) => mockAddNote(...a),
}))
// Markdown → sanitized doc derivation used by -validation's markdownToSanitizedJson.
vi.mock('@/lib/server/markdown-tiptap', () => ({
  markdownToTiptapJson: (md: string) => ({ doc: md }),
  contentJsonToMarkdown: (_json: unknown, content: string) => content,
}))
vi.mock('@/lib/server/sanitize-tiptap', () => ({
  sanitizeTiptapContent: (json: unknown) => json,
}))

import { Route as ListRoute } from '../index'
import { Route as ReplyRoute } from '../$ticketId.reply'
import { Route as NoteRoute } from '../$ticketId.note'
import { Route as StatusRoute } from '../$ticketId.status'
import { Route as AssignRoute } from '../$ticketId.assign'
import { Route as PriorityRoute } from '../$ticketId.priority'

type Handler = (a: { request: Request; params: Record<string, string> }) => Promise<Response>
const post = (route: unknown): Handler =>
  (route as { options: { server: { handlers: { POST: Handler } } } }).options.server.handlers.POST

const TICKET_ID = 'ticket_01h455vb4pex5vsknk084sn02q'
const STATUS_ID = 'ticket_status_01h455vb4pex5vsknk084sn02q'
const PRINCIPAL_ID = 'principal_01h455vb4pex5vsknk084sn02q'

const ticketDTO = {
  id: TICKET_ID,
  number: 42,
  reference: '#42',
  type: 'customer',
  title: 'Cannot log in',
  status: { id: 's1', name: 'In Progress', color: '#000', category: 'open' },
  stage: { slot: 'in_progress', label: 'In progress' },
  priority: 'high',
  requester: { principalId: PRINCIPAL_ID, displayName: 'Ada', avatarUrl: null },
  assignee: { principalId: null, displayName: null, teamId: null, teamName: null },
  company: null,
  firstResponseAt: null,
  dueAt: null,
  resolvedAt: null,
  createdAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z',
  reopenedCount: 0,
}

const messageDTO = {
  id: 'conversation_msg_01h455vb4pex5vsknk084sn02q',
  ticketId: TICKET_ID,
  senderType: 'agent',
  isInternal: false,
  author: { principalId: PRINCIPAL_ID, displayName: 'Grace' },
  contentJson: null,
  content: 'On it.',
  attachments: null,
  createdAt: '2026-07-04T00:01:00.000Z',
}

const jsonReq = (url: string, body: unknown, method = 'POST') =>
  new Request(url, { method, body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({
    principalId: 'principal_key',
    role: 'admin',
    principal: { displayName: 'Key', user: { email: 'k@x' } },
    apiKey: { id: 'api_key_1', scopes: null },
  })
})

describe('POST /api/v1/tickets (create)', () => {
  it('creates a ticket with a service actor and derives descriptionJson from markdown', async () => {
    mockCreateTicket.mockResolvedValue(ticketDTO)
    const res = await post(ListRoute)({
      request: jsonReq('https://x.test/api/v1/tickets', {
        type: 'customer',
        title: 'Cannot log in',
        description: 'Steps here',
      }),
      params: {},
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data).toMatchObject({ id: TICKET_ID, reference: '#42' })
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { permission: 'ticket.create' })
    const [input, actor] = mockCreateTicket.mock.calls[0]
    expect(input).toMatchObject({
      type: 'customer',
      title: 'Cannot log in',
      description: 'Steps here',
    })
    // markdown → sanitized doc (mocked to { doc: md })
    expect(input.descriptionJson).toEqual({ doc: 'Steps here' })
    expect(actor.principalType).toBe('service')
  })

  it('omits descriptionJson when no description is given', async () => {
    mockCreateTicket.mockResolvedValue(ticketDTO)
    await post(ListRoute)({
      request: jsonReq('https://x.test/api/v1/tickets', { type: 'customer', title: 'Hi' }),
      params: {},
    })
    expect(mockCreateTicket.mock.calls[0][0].descriptionJson).toBeUndefined()
  })

  it('400s an invalid body without calling the service', async () => {
    const res = await post(ListRoute)({
      request: jsonReq('https://x.test/api/v1/tickets', { title: 'no type' }),
      params: {},
    })
    expect(res.status).toBe(400)
    expect(mockCreateTicket).not.toHaveBeenCalled()
  })

  it('400s a malformed requesterPrincipalId', async () => {
    const res = await post(ListRoute)({
      request: jsonReq('https://x.test/api/v1/tickets', {
        type: 'customer',
        title: 'x',
        requesterPrincipalId: 'not-a-typeid',
      }),
      params: {},
    })
    expect(res.status).toBe(400)
    expect(mockCreateTicket).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/tickets/:id/reply', () => {
  it('sends a customer-visible reply gated ticket.reply', async () => {
    mockSendMessage.mockResolvedValue({ message: messageDTO })
    const res = await post(ReplyRoute)({
      request: jsonReq(`https://x.test/api/v1/tickets/${TICKET_ID}/reply`, { content: 'On it.' }),
      params: { ticketId: TICKET_ID },
    })
    expect(res.status).toBe(201)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { permission: 'ticket.reply' })
    const [actor, input] = mockSendMessage.mock.calls[0]
    expect(actor.principalType).toBe('service')
    expect(input).toMatchObject({ ticketId: TICKET_ID, content: 'On it.' })
    // Markdown is derived into a sanitized rich doc (D3), like the MCP tool.
    expect(input.contentJson).toEqual({ doc: 'On it.' })
  })

  it('400s an empty content body', async () => {
    const res = await post(ReplyRoute)({
      request: jsonReq(`https://x.test/api/v1/tickets/${TICKET_ID}/reply`, { content: '' }),
      params: { ticketId: TICKET_ID },
    })
    expect(res.status).toBe(400)
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('400s a malformed ticket id', async () => {
    const res = await post(ReplyRoute)({
      request: jsonReq('https://x.test/api/v1/tickets/nope/reply', { content: 'hi' }),
      params: { ticketId: 'nope' },
    })
    expect(res.status).toBe(400)
    expect(mockSendMessage).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/tickets/:id/note', () => {
  it('adds an internal note gated ticket.note', async () => {
    mockAddNote.mockResolvedValue({ message: { ...messageDTO, isInternal: true } })
    const res = await post(NoteRoute)({
      request: jsonReq(`https://x.test/api/v1/tickets/${TICKET_ID}/note`, { content: 'note' }),
      params: { ticketId: TICKET_ID },
    })
    expect(res.status).toBe(201)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { permission: 'ticket.note' })
    expect(mockAddNote.mock.calls[0][1]).toMatchObject({ ticketId: TICKET_ID, content: 'note' })
    expect(mockAddNote.mock.calls[0][1].contentJson).toEqual({ doc: 'note' })
  })
})

describe('POST /api/v1/tickets/:id/status', () => {
  it('sets status gated ticket.set_status', async () => {
    mockSetStatus.mockResolvedValue(ticketDTO)
    const res = await post(StatusRoute)({
      request: jsonReq(`https://x.test/api/v1/tickets/${TICKET_ID}/status`, {
        statusId: STATUS_ID,
      }),
      params: { ticketId: TICKET_ID },
    })
    expect(res.status).toBe(200)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { permission: 'ticket.set_status' })
    expect(mockSetStatus).toHaveBeenCalledWith(TICKET_ID, STATUS_ID, expect.anything())
  })

  it('400s a malformed statusId without calling the service', async () => {
    const res = await post(StatusRoute)({
      request: jsonReq(`https://x.test/api/v1/tickets/${TICKET_ID}/status`, { statusId: 'nope' }),
      params: { ticketId: TICKET_ID },
    })
    expect(res.status).toBe(400)
    expect(mockSetStatus).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/tickets/:id/assign', () => {
  it('preserves the null-vs-absent distinction', async () => {
    mockAssign.mockResolvedValue(ticketDTO)
    // explicit null clears the agent side; team side absent
    await post(AssignRoute)({
      request: jsonReq(`https://x.test/api/v1/tickets/${TICKET_ID}/assign`, {
        assigneePrincipalId: null,
      }),
      params: { ticketId: TICKET_ID },
    })
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { permission: 'ticket.assign' })
    const [, input] = mockAssign.mock.calls[0]
    expect(input).toEqual({ assigneePrincipalId: null })
    expect('assigneeTeamId' in input).toBe(false)
  })

  it('parses a concrete assignee principal id', async () => {
    mockAssign.mockResolvedValue(ticketDTO)
    await post(AssignRoute)({
      request: jsonReq(`https://x.test/api/v1/tickets/${TICKET_ID}/assign`, {
        assigneePrincipalId: PRINCIPAL_ID,
      }),
      params: { ticketId: TICKET_ID },
    })
    expect(mockAssign.mock.calls[0][1]).toEqual({ assigneePrincipalId: PRINCIPAL_ID })
  })
})

describe('POST /api/v1/tickets/:id/priority', () => {
  it('sets priority gated ticket.set_status', async () => {
    mockSetPriority.mockResolvedValue(ticketDTO)
    const res = await post(PriorityRoute)({
      request: jsonReq(`https://x.test/api/v1/tickets/${TICKET_ID}/priority`, { priority: 'high' }),
      params: { ticketId: TICKET_ID },
    })
    expect(res.status).toBe(200)
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), { permission: 'ticket.set_status' })
    expect(mockSetPriority).toHaveBeenCalledWith(TICKET_ID, 'high', expect.anything())
  })

  it('400s an invalid priority', async () => {
    const res = await post(PriorityRoute)({
      request: jsonReq(`https://x.test/api/v1/tickets/${TICKET_ID}/priority`, { priority: 'nope' }),
      params: { ticketId: TICKET_ID },
    })
    expect(res.status).toBe(400)
    expect(mockSetPriority).not.toHaveBeenCalled()
  })
})

describe('auth propagation', () => {
  it('propagates an auth failure without calling the service', async () => {
    mockAuth.mockRejectedValue(Object.assign(new Error('nope'), { status: 401 }))
    const res = await post(ReplyRoute)({
      request: jsonReq(`https://x.test/api/v1/tickets/${TICKET_ID}/reply`, { content: 'hi' }),
      params: { ticketId: TICKET_ID },
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(mockSendMessage).not.toHaveBeenCalled()
  })
})
