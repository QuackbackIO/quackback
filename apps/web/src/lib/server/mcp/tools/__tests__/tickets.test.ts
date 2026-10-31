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
const mockSetDueAt = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket-due.service', () => ({
  setTicketDueAt: (...a: unknown[]) => mockSetDueAt(...a),
}))
const mockLink = vi.fn()
const mockUnlink = vi.fn()
const mockListLinked = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket-links.service', () => ({
  linkTicketToTracker: (...a: unknown[]) => mockLink(...a),
  unlinkTicketFromTracker: (...a: unknown[]) => mockUnlink(...a),
  listLinkedTicketIds: (...a: unknown[]) => mockListLinked(...a),
}))

const mockListWatchers = vi.fn()
const mockWatchSelf = vi.fn()
const mockUnwatchSelf = vi.fn()
const mockAddWatcher = vi.fn()
const mockRemoveWatcher = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket-watchers.service', () => ({
  listWatchersOfTicket: (...a: unknown[]) => mockListWatchers(...a),
  watchTicketForSelf: (...a: unknown[]) => mockWatchSelf(...a),
  unwatchTicketForSelf: (...a: unknown[]) => mockUnwatchSelf(...a),
  addTicketWatcher: (...a: unknown[]) => mockAddWatcher(...a),
  removeTicketWatcher: (...a: unknown[]) => mockRemoveWatcher(...a),
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
  ticketType: null,
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
      'add_ticket_watcher',
      'create_ticket',
      'get_ticket',
      'link_ticket',
      'list_ticket_watchers',
      'list_tickets',
      'remove_ticket_watcher',
      'reply_to_ticket',
      'set_ticket_due_date',
      'unlink_ticket',
      'unwatch_ticket',
      'watch_ticket',
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
      url: '/admin/inbox?i=ticket_1',
      number: 42,
      reference: '#42',
      type: 'customer',
      ticketType: null,
      title: 'Cannot log in',
      status: 'In progress',
      statusCategory: 'open',
      stage: 'in_progress',
      priority: 'high',
      requesterPrincipalId: 'principal_r',
      assigneePrincipalId: 'principal_a',
      assigneeTeamId: null,
      dueAt: null,
      updatedAt: '2026-07-04T00:00:00.000Z',
    })
  })

  it('list_tickets passes the due filter and the due sort, and returns dueAt', async () => {
    mockListTickets.mockResolvedValue({
      tickets: [{ ...ticketDTO, dueAt: '2026-11-03T17:00:00.000Z' }],
      hasMore: false,
    })
    const out = await collect(teamAuth).get('list_tickets')!({ due: 'overdue', sort: 'due' })
    const [filter] = mockListTickets.mock.calls[0]
    expect(filter).toMatchObject({ due: 'overdue', sort: 'due', limit: 20 })
    expect(parse(out).tickets[0].dueAt).toBe('2026-11-03T17:00:00.000Z')
  })

  it('list_tickets passes the registry ticketTypeId filter and maps the type ref (Phase 4)', async () => {
    const typed = {
      ...ticketDTO,
      ticketType: { id: 'ticket_type_bug', name: 'Bug report', slug: 'bug_report' },
    }
    mockListTickets.mockResolvedValue({ tickets: [typed], hasMore: false })
    const out = await collect(teamAuth).get('list_tickets')!({ ticketTypeId: 'ticket_type_bug' })
    const [filter] = mockListTickets.mock.calls[0]
    expect(filter).toMatchObject({ ticketTypeId: 'ticket_type_bug' })
    expect(parse(out).tickets[0].ticketType).toEqual({
      id: 'ticket_type_bug',
      name: 'Bug report',
      slug: 'bug_report',
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
      preferAccountName: true,
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

  it('create_ticket passes dueAt to the service as a Date and returns it', async () => {
    mockCreateTicket.mockResolvedValue({ ...ticketDTO, dueAt: '2026-11-03T17:00:00.000Z' })
    const out = await collect(teamAuth).get('create_ticket')!({
      type: 'customer',
      title: 'Refund not received',
      dueAt: '2026-11-03T18:00:00+01:00',
    })
    const [input] = mockCreateTicket.mock.calls[0]
    expect(input.dueAt).toBeInstanceOf(Date)
    expect(input.dueAt.toISOString()).toBe('2026-11-03T17:00:00.000Z')
    expect(parse(out).dueAt).toBe('2026-11-03T17:00:00.000Z')
  })

  it('create_ticket leaves dueAt unset when none is given', async () => {
    mockCreateTicket.mockResolvedValue(ticketDTO)
    await collect(teamAuth).get('create_ticket')!({ title: 'Refund not received' })
    expect(mockCreateTicket.mock.calls[0][0].dueAt).toBeUndefined()
  })

  it('create_ticket passes a registry ticketTypeId through (Phase 4; category derived)', async () => {
    mockCreateTicket.mockResolvedValue(ticketDTO)
    await collect(teamAuth).get('create_ticket')!({
      ticketTypeId: 'ticket_type_bug',
      title: 'Refund not received',
    })
    const [input] = mockCreateTicket.mock.calls[0]
    expect(input).toMatchObject({ ticketTypeId: 'ticket_type_bug', title: 'Refund not received' })
    // No bare category is required alongside a registry type.
    expect(input.type).toBeUndefined()
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

  it('reply_to_ticket passes fileIds through as attachment refs the service resolves', async () => {
    mockSendMessage.mockResolvedValue({
      message: { id: 'm_1', ticketId: 'ticket_1', createdAt: '2026-07-04T00:02:00.000Z' },
    })
    await collect(teamAuth).get('reply_to_ticket')!({
      ticketId: 'ticket_1',
      content: 'See attached',
      fileIds: ['file_1', 'file_2'],
    })
    const [, input] = mockSendMessage.mock.calls[0]
    expect(input.attachments).toEqual([{ fileId: 'file_1' }, { fileId: 'file_2' }])
  })

  it('add_ticket_note passes fileIds through as attachment refs the service resolves', async () => {
    mockAddNote.mockResolvedValue({
      message: { id: 'm_2', ticketId: 'ticket_1', createdAt: '2026-07-04T00:03:00.000Z' },
    })
    await collect(teamAuth).get('add_ticket_note')!({
      ticketId: 'ticket_1',
      content: 'internal',
      fileIds: ['file_3'],
    })
    const [, input] = mockAddNote.mock.calls[0]
    expect(input.attachments).toEqual([{ fileId: 'file_3' }])
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

  it('set_ticket_due_date sets the date as a Date with the caller as actor', async () => {
    mockSetDueAt.mockResolvedValue({ ...ticketDTO, dueAt: '2026-11-03T17:00:00.000Z' })
    const out = await collect(teamAuth).get('set_ticket_due_date')!({
      ticketId: 'ticket_1',
      dueAt: '2026-11-03T17:00:00Z',
    })
    const [id, dueAt, actor] = mockSetDueAt.mock.calls[0]
    expect(id).toBe('ticket_1')
    expect(dueAt).toBeInstanceOf(Date)
    expect(dueAt.toISOString()).toBe('2026-11-03T17:00:00.000Z')
    expect(actor.principalId).toBe('principal_key')
    expect(parse(out)).toEqual({
      id: 'ticket_1',
      reference: '#42',
      dueAt: '2026-11-03T17:00:00.000Z',
    })
  })

  it('set_ticket_due_date clears the date with null', async () => {
    mockSetDueAt.mockResolvedValue(ticketDTO)
    const out = await collect(teamAuth).get('set_ticket_due_date')!({
      ticketId: 'ticket_1',
      dueAt: null,
    })
    expect(mockSetDueAt.mock.calls[0][1]).toBeNull()
    expect(parse(out).dueAt).toBeNull()
  })

  it('set_ticket_due_date requires the write:chat scope', async () => {
    const readOnly = { ...teamAuth, scopes: ['read:chat'] } as unknown as McpAuthContext
    const out = await collect(readOnly).get('set_ticket_due_date')!({
      ticketId: 'ticket_1',
      dueAt: null,
    })
    expect(out.isError).toBe(true)
    expect(mockSetDueAt).not.toHaveBeenCalled()
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

  describe('watchers', () => {
    const watchers = [
      {
        principalId: 'principal_r',
        reason: 'requester',
        mutedUntil: null,
        displayName: 'Ada',
        avatarUrl: null,
        role: 'user',
        isTeamMember: false,
      },
      {
        principalId: 'principal_key',
        reason: 'manual',
        mutedUntil: new Date('2026-07-11T00:00:00.000Z'),
        displayName: 'Agent',
        avatarUrl: null,
        role: 'admin',
        isTeamMember: true,
      },
    ]
    beforeEach(() => mockListWatchers.mockResolvedValue(watchers))

    it('list_ticket_watchers returns who watches, why and until when, no emails', async () => {
      const out = await collect(teamAuth).get('list_ticket_watchers')!({ ticketId: 'ticket_1' })
      expect(mockListWatchers).toHaveBeenCalledWith(
        'ticket_1',
        expect.objectContaining({ principalId: 'principal_key' })
      )
      const body = parse(out)
      // The requester chose their own name, so it is marked as outside text.
      expect(JSON.stringify(body)).toContain('watchers[0].displayName')
      expect(body).toMatchObject({
        ticketId: 'ticket_1',
        watchers: [
          {
            principalId: 'principal_r',
            displayName: 'Ada',
            isTeamMember: false,
            reason: 'requester',
            mutedUntil: null,
          },
          {
            principalId: 'principal_key',
            displayName: 'Agent',
            isTeamMember: true,
            reason: 'manual',
            mutedUntil: '2026-07-11T00:00:00.000Z',
          },
        ],
      })
    })

    it('watch_ticket and unwatch_ticket act for the signed-in person', async () => {
      mockWatchSelf.mockResolvedValue({ added: true })
      mockUnwatchSelf.mockResolvedValue({ removed: true })
      const handlers = collect(teamAuth)
      await handlers.get('watch_ticket')!({ ticketId: 'ticket_1' })
      await handlers.get('unwatch_ticket')!({ ticketId: 'ticket_1' })
      expect(mockWatchSelf).toHaveBeenCalledWith(
        'ticket_1',
        expect.objectContaining({ principalId: 'principal_key', principalType: 'user' })
      )
      expect(mockUnwatchSelf).toHaveBeenCalledTimes(1)
    })

    it('refuses a self watch from an API key, which has no watch of its own', async () => {
      const keyAuth = { ...teamAuth, userId: undefined } as unknown as McpAuthContext
      const handlers = collect(keyAuth)
      expect((await handlers.get('watch_ticket')!({ ticketId: 'ticket_1' })).isError).toBe(true)
      expect((await handlers.get('list_tickets')!({ watching: true })).isError).toBe(true)
      expect(mockWatchSelf).not.toHaveBeenCalled()
      expect(mockListTickets).not.toHaveBeenCalled()
    })

    it('add_ticket_watcher and remove_ticket_watcher pass the teammate and the caller', async () => {
      mockAddWatcher.mockResolvedValue({ added: true })
      mockRemoveWatcher.mockResolvedValue({ removed: true })
      const handlers = collect(teamAuth)
      await handlers.get('add_ticket_watcher')!({
        ticketId: 'ticket_1',
        principalId: 'principal_m',
      })
      await handlers.get('remove_ticket_watcher')!({
        ticketId: 'ticket_1',
        principalId: 'principal_m',
      })
      expect(mockAddWatcher).toHaveBeenCalledWith(
        'ticket_1',
        'principal_m',
        expect.objectContaining({ principalId: 'principal_key' })
      )
      expect(mockRemoveWatcher).toHaveBeenCalledWith('ticket_1', 'principal_m', expect.anything())
    })

    it('surfaces a refused add as a tool error', async () => {
      const { ValidationError } = await import('@/lib/shared/errors')
      mockAddWatcher.mockRejectedValue(
        new ValidationError('WATCHER_CANNOT_SEE_TICKET', 'This teammate cannot see this ticket')
      )
      const out = await collect(teamAuth).get('add_ticket_watcher')!({
        ticketId: 'ticket_1',
        principalId: 'principal_m',
      })
      expect(out.isError).toBe(true)
      expect((out.content[0] as { text: string }).text).toContain('WATCHER_CANNOT_SEE_TICKET')
    })

    it('list_tickets narrows to the caller when watching', async () => {
      mockListTickets.mockResolvedValue({ tickets: [], hasMore: false })
      await collect(teamAuth).get('list_tickets')!({ watching: true })
      expect(mockListTickets.mock.calls[0][0]).toMatchObject({
        watcherPrincipalId: 'principal_key',
      })
    })
  })
})
