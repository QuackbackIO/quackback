import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const mockListTickets = vi.fn()
const mockGetTicket = vi.fn()
const mockCreateTicket = vi.fn()
const mockListMessages = vi.fn()
const mockSendMessage = vi.fn()
const mockAddNote = vi.fn()

vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  listTickets: (...a: unknown[]) => mockListTickets(...a),
  getTicket: (...a: unknown[]) => mockGetTicket(...a),
  createTicket: (...a: unknown[]) => mockCreateTicket(...a),
}))
vi.mock('@/lib/server/domains/tickets/ticket-message.service', () => ({
  listTicketMessages: (...a: unknown[]) => mockListMessages(...a),
  sendTicketMessage: (...a: unknown[]) => mockSendMessage(...a),
  addTicketNote: (...a: unknown[]) => mockAddNote(...a),
}))
const mockLink = vi.fn()
const mockUnlink = vi.fn()
const mockListLinked = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket-links.service', () => ({
  linkTicketToTracker: (...a: unknown[]) => mockLink(...a),
  unlinkTicketFromTracker: (...a: unknown[]) => mockUnlink(...a),
  listLinkedTicketIds: (...a: unknown[]) => mockListLinked(...a),
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
  scopes: ['read:chat', 'write:chat'],
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
  it('registers the read + write ticket tools', () => {
    const handlers = collect(teamAuth)
    expect([...handlers.keys()].sort()).toEqual([
      'add_ticket_note',
      'create_ticket',
      'get_ticket',
      'link_ticket',
      'list_tickets',
      'reply_to_ticket',
      'unlink_ticket',
    ])
  })

  it('list_tickets maps filters, passes an actor, and returns a compact shape', async () => {
    mockListTickets.mockResolvedValue({ tickets: [ticketDTO], hasMore: false })
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
          contentJson: null,
          attachments: [],
          createdAt: '2026-07-04T00:00:00.000Z',
        },
        {
          id: 'm_new',
          senderType: 'agent',
          isInternal: false,
          author: { displayName: 'Grace' },
          content: 'reply',
          contentJson: null,
          attachments: [],
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
    expect(body.messages.map((m: { content: string }) => m.content)).toEqual(['first', 'reply'])
    expect(body.hasMore).toBe(true)
    expect(body.nextCursor).toBe('m_old')
  })

  it('get_ticket renders an image-bearing message as markdown, never empty', async () => {
    mockGetTicket.mockResolvedValue(ticketDTO)
    mockListMessages.mockResolvedValue({
      messages: [
        {
          id: 'm_img',
          senderType: 'visitor',
          isInternal: false,
          author: null,
          // The rich composer stored contentJson but no plaintext mirror.
          content: '',
          contentJson: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'image',
                    attrs: { src: 'https://cdn.example.com/pic.png', alt: null, title: null },
                  },
                ],
              },
            ],
          },
          attachments: [],
          createdAt: '2026-07-04T00:00:00.000Z',
        },
      ],
      hasMore: false,
    })
    const out = await collect(teamAuth).get('get_ticket')!({ ticketId: 'ticket_1' })
    const body = parse(out)
    expect(body.messages[0].content).toBe('![](https://cdn.example.com/pic.png)')
    expect(body.messages[0].content).not.toBe('')
  })

  it('get_ticket appends an attachments summary when a message carries attachments', async () => {
    mockGetTicket.mockResolvedValue(ticketDTO)
    mockListMessages.mockResolvedValue({
      messages: [
        {
          id: 'm_att',
          senderType: 'agent',
          isInternal: false,
          author: { displayName: 'Grace' },
          content: 'See attached invoice.',
          contentJson: null,
          attachments: [
            {
              name: 'invoice.pdf',
              url: 'https://cdn.example.com/invoice.pdf',
              contentType: 'application/pdf',
              size: 1024,
            },
          ],
          createdAt: '2026-07-04T00:01:00.000Z',
        },
      ],
      hasMore: false,
    })
    const out = await collect(teamAuth).get('get_ticket')!({ ticketId: 'ticket_1' })
    const body = parse(out)
    expect(body.messages[0].content).toBe(
      'See attached invoice.\n\nAttachments:\n- invoice.pdf: https://cdn.example.com/invoice.pdf'
    )
  })

  it('create_ticket maps the input and returns the created ticket', async () => {
    mockCreateTicket.mockResolvedValue(ticketDTO)
    const out = await collect(teamAuth).get('create_ticket')!({
      type: 'customer',
      title: 'Refund not received',
      description: 'Missing refund',
    })
    const [input, actor] = mockCreateTicket.mock.calls[0]
    expect(input).toMatchObject({
      type: 'customer',
      title: 'Refund not received',
      description: 'Missing refund',
    })
    // A plain single-line description still produces a minimal valid doc
    // (consistent with createPost's unconditional contentJson derivation).
    expect(input.descriptionJson).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Missing refund' }] }],
    })
    expect(actor.principalId).toBe('principal_key')
    expect(parse(out)).toMatchObject({ id: 'ticket_1', reference: '#42' })
  })

  it('create_ticket omits descriptionJson when no description is given', async () => {
    mockCreateTicket.mockResolvedValue(ticketDTO)
    await collect(teamAuth).get('create_ticket')!({
      type: 'customer',
      title: 'Refund not received',
    })
    const [input] = mockCreateTicket.mock.calls[0]
    expect(input.description).toBeUndefined()
    expect(input.descriptionJson).toBeUndefined()
  })

  it('reply_to_ticket sends a visitor-visible message with a minimal contentJson doc for plain text', async () => {
    mockSendMessage.mockResolvedValue({
      message: { id: 'm_1', ticketId: 'ticket_1', createdAt: '2026-07-04T00:02:00.000Z' },
    })
    const out = await collect(teamAuth).get('reply_to_ticket')!({
      ticketId: 'ticket_1',
      content: 'On it.',
    })
    const [actor, input] = mockSendMessage.mock.calls[0]
    expect(actor.principalId).toBe('principal_key')
    expect(input).toEqual({
      ticketId: 'ticket_1',
      content: 'On it.',
      contentJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'On it.' }] }],
      },
    })
    expect(parse(out)).toEqual({
      id: 'm_1',
      ticketId: 'ticket_1',
      createdAt: '2026-07-04T00:02:00.000Z',
    })
  })

  it('reply_to_ticket converts markdown structure (bold + list) into contentJson', async () => {
    mockSendMessage.mockResolvedValue({
      message: { id: 'm_1', ticketId: 'ticket_1', createdAt: '2026-07-04T00:02:00.000Z' },
    })
    await collect(teamAuth).get('reply_to_ticket')!({
      ticketId: 'ticket_1',
      content: '**bold** plus a list\n\n- one\n- two',
    })
    const [, input] = mockSendMessage.mock.calls[0]
    expect(input.content).toBe('**bold** plus a list\n\n- one\n- two')
    const nodeTypes = JSON.stringify(input.contentJson)
    expect(nodeTypes).toContain('"bold"')
    expect(nodeTypes).toContain('"bulletList"')
    expect(input.contentJson.content[0].content[0]).toEqual({
      type: 'text',
      text: 'bold',
      marks: [{ type: 'bold' }],
    })
  })

  it('reply_to_ticket neutralizes hostile markdown (raw script text, javascript: link)', async () => {
    mockSendMessage.mockResolvedValue({
      message: { id: 'm_1', ticketId: 'ticket_1', createdAt: '2026-07-04T00:02:00.000Z' },
    })
    await collect(teamAuth).get('reply_to_ticket')!({
      ticketId: 'ticket_1',
      content: '<script>alert(1)</script>\n\n[click me](javascript:alert(1))',
    })
    const [, input] = mockSendMessage.mock.calls[0]
    const serialized = JSON.stringify(input.contentJson)
    // sanitizeTiptapContent strips the javascript: link mark entirely.
    expect(serialized).not.toContain('javascript:')
    expect(serialized).not.toContain('"link"')
    // The raw <script> tag was never parsed as an executable node — it only
    // ever exists as inert text content.
    for (const node of input.contentJson.content) {
      for (const child of node.content ?? []) {
        expect(child.type === 'text' || child.type === 'hardBreak').toBe(true)
      }
    }
  })

  it('add_ticket_note routes to the note path, not the reply path, with contentJson', async () => {
    mockAddNote.mockResolvedValue({
      message: { id: 'm_2', ticketId: 'ticket_1', createdAt: '2026-07-04T00:03:00.000Z' },
    })
    await collect(teamAuth).get('add_ticket_note')!({ ticketId: 'ticket_1', content: 'internal' })
    expect(mockAddNote).toHaveBeenCalledTimes(1)
    expect(mockSendMessage).not.toHaveBeenCalled()
    const [, input] = mockAddNote.mock.calls[0]
    expect(input).toEqual({
      ticketId: 'ticket_1',
      content: 'internal',
      contentJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'internal' }] }],
      },
    })
  })

  it('link_ticket links a customer ticket to a tracker and returns the linked ids', async () => {
    mockLink.mockResolvedValue(undefined)
    mockListLinked.mockResolvedValue(['ticket_customer'])
    const out = await collect(teamAuth).get('link_ticket')!({
      trackerTicketId: 'ticket_tracker',
      ticketId: 'ticket_customer',
    })
    expect(mockLink).toHaveBeenCalledWith(
      'ticket_tracker',
      'ticket_customer',
      expect.objectContaining({ principalId: 'principal_key' })
    )
    expect(parse(out)).toEqual({
      trackerTicketId: 'ticket_tracker',
      linkedTicketIds: ['ticket_customer'],
    })
  })

  it('unlink_ticket removes the link', async () => {
    mockUnlink.mockResolvedValue(undefined)
    mockListLinked.mockResolvedValue([])
    const out = await collect(teamAuth).get('unlink_ticket')!({
      trackerTicketId: 'ticket_tracker',
      ticketId: 'ticket_customer',
    })
    expect(mockUnlink).toHaveBeenCalledTimes(1)
    expect(parse(out).linkedTicketIds).toEqual([])
  })

  it('write tools require the write:chat scope, not just read:chat', async () => {
    const readOnly = { ...teamAuth, scopes: ['read:chat'] } as unknown as McpAuthContext
    const out = await collect(readOnly).get('reply_to_ticket')!({
      ticketId: 'ticket_1',
      content: 'x',
    })
    expect(out.isError).toBe(true)
    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('denies a caller lacking the read:chat scope', async () => {
    const noScope = { ...teamAuth, scopes: [] } as unknown as McpAuthContext
    const out = await collect(noScope).get('list_tickets')!({})
    expect(out.isError).toBe(true)
    expect(mockListTickets).not.toHaveBeenCalled()
  })
})
