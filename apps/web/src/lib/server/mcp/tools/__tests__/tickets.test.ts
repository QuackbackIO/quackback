import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const mockListTickets = vi.fn()
const mockGetTicket = vi.fn()
const mockListMessages = vi.fn()

vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  listTickets: (...a: unknown[]) => mockListTickets(...a),
  getTicket: (...a: unknown[]) => mockGetTicket(...a),
}))
vi.mock('@/lib/server/domains/tickets/ticket-message.service', () => ({
  listTicketMessages: (...a: unknown[]) => mockListMessages(...a),
}))

import { registerTicketTools } from '../tickets'
import type { McpAuthContext } from '../../types'

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>

/** Register the ticket tools against a fake server, capturing each wrapped handler. */
function collect(auth: McpAuthContext): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const fakeServer = {
    tool: (name: string, _d: string, _s: unknown, _a: unknown, handler: Handler) => {
      handlers.set(name, handler)
    },
  }
  registerTicketTools(fakeServer as never, auth)
  return handlers
}

const teamAuth = {
  principalId: 'principal_key',
  userId: 'user_1',
  name: 'Agent',
  email: 'agent@acme.com',
  role: 'admin' as const,
  authMethod: 'api-key' as const,
  scopes: ['read:chat'],
} as unknown as McpAuthContext

const parse = (r: CallToolResult) => JSON.parse((r.content[0] as { text: string }).text)

const ticketDTO = {
  id: 'ticket_1',
  number: 42,
  reference: '#42',
  type: 'customer',
  title: 'Cannot log in',
  status: { id: 's1', name: 'In progress', color: '#000', category: 'open' },
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

beforeEach(() => vi.clearAllMocks())

describe('ticket MCP tools', () => {
  it('registers list_tickets and get_ticket', () => {
    const handlers = collect(teamAuth)
    expect([...handlers.keys()].sort()).toEqual(['get_ticket', 'list_tickets'])
  })

  it('list_tickets maps filters, passes an actor, and returns a compact shape', async () => {
    mockListTickets.mockResolvedValue([ticketDTO])
    const out = await collect(teamAuth).get('list_tickets')!({
      type: 'customer',
      statusCategory: 'open',
      limit: 5,
    })
    const [filter, actor] = mockListTickets.mock.calls[0]
    expect(filter).toMatchObject({ type: 'customer', statusCategory: 'open', limit: 5 })
    expect(actor.principalId).toBe('principal_key')
    const body = parse(out)
    expect(body.tickets[0]).toEqual({
      id: 'ticket_1',
      number: 42,
      reference: '#42',
      type: 'customer',
      title: 'Cannot log in',
      status: 'In progress',
      statusCategory: 'open',
      stage: 'in_progress',
      priority: 'high',
      requesterPrincipalId: 'principal_r',
      assigneePrincipalId: 'principal_a',
      assigneeTeamId: null,
      updatedAt: '2026-07-04T00:00:00.000Z',
    })
  })

  it('get_ticket returns the ticket, its thread, and derives the older-page cursor', async () => {
    mockGetTicket.mockResolvedValue(ticketDTO)
    mockListMessages.mockResolvedValue({
      messages: [
        {
          id: 'm_old',
          senderType: 'visitor',
          isInternal: false,
          author: null,
          content: 'first',
          createdAt: '2026-07-04T00:00:00.000Z',
        },
        {
          id: 'm_new',
          senderType: 'agent',
          isInternal: false,
          author: { displayName: 'Grace' },
          content: 'reply',
          createdAt: '2026-07-04T00:01:00.000Z',
        },
      ],
      hasMore: true,
    })
    const out = await collect(teamAuth).get('get_ticket')!({ ticketId: 'ticket_1' })
    expect(mockGetTicket).toHaveBeenCalledWith('ticket_1')
    expect(mockListMessages).toHaveBeenCalledWith('ticket_1', {
      before: undefined,
      includeInternal: false,
    })
    const body = parse(out)
    expect(body.ticket).toMatchObject({ id: 'ticket_1', reference: '#42', stage: 'in_progress' })
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual(['m_old', 'm_new'])
    expect(body.hasMore).toBe(true)
    expect(body.nextCursor).toBe('m_old')
  })

  it('denies a caller lacking the read:chat scope', async () => {
    const noScope = { ...teamAuth, scopes: [] } as unknown as McpAuthContext
    const out = await collect(noScope).get('list_tickets')!({})
    expect(out.isError).toBe(true)
    expect(mockListTickets).not.toHaveBeenCalled()
  })
})
