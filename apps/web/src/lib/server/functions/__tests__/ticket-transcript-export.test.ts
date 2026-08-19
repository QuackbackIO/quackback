/**
 * Tests for exportTicketTranscriptFn (Phase 7 parity: transcript export for
 * tickets, which reuse conversation_messages polymorphically). Pins the
 * agent-only gate and the oldest-first paging — where the ticket path differs
 * from conversations: listTicketMessages has no nextCursor, so the loop must
 * derive the before-cursor from the oldest message of each page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = (args: { data: unknown }) => {
      if (!handler) throw new Error('handler not registered')
      return handler(args)
    }
    fn.validator = () => fn
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      handler = h
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  policyActorFromAuth: vi.fn(),
  isTeamMember: vi.fn(),
  getTicket: vi.fn(),
  listTicketMessages: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
  policyActorFromAuth: hoisted.policyActorFromAuth,
}))
vi.mock('@/lib/shared/roles', () => ({ isTeamMember: hoisted.isTeamMember }))
vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({ getTicket: hoisted.getTicket }))
vi.mock('@/lib/server/domains/tickets/ticket-message.service', () => ({
  listTicketMessages: hoisted.listTicketMessages,
}))

import { exportTicketTranscriptFn } from '../tickets'

type Msg = {
  id: string
  senderType: string
  content: string
  createdAt: string
  author: { displayName: string } | null
  isInternal: boolean
  isAssistant: boolean
  attachments: unknown[]
}
const message = (over: Partial<Msg>): Msg => ({
  id: 'message_1',
  senderType: 'visitor',
  content: 'hi',
  createdAt: '2026-07-04T09:15:30.000Z',
  author: { displayName: 'Alice' },
  isInternal: false,
  isAssistant: false,
  attachments: [],
  ...over,
})

const ticket = {
  id: 'ticket_1',
  number: 142,
  reference: '#142',
  title: 'Cannot log in',
  status: { name: 'In progress' },
  createdAt: '2026-07-04T09:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_agent', role: 'admin' } })
  hoisted.isTeamMember.mockReturnValue(true)
  hoisted.getTicket.mockResolvedValue(ticket)
  hoisted.listTicketMessages.mockResolvedValue({ messages: [message({})], hasMore: false })
})

describe('exportTicketTranscriptFn', () => {
  it('renders the transcript with a ticket heading and download filename', async () => {
    const res = (await exportTicketTranscriptFn({ data: { ticketId: 'ticket_1' } })) as {
      filename: string
      content: string
    }
    expect(res.filename).toBe('ticket-142.md')
    expect(res.content).toContain('# Ticket #142')
    expect(res.content).toContain('- Subject: Cannot log in')
    expect(res.content).toContain('- Status: In progress')
    expect(hoisted.listTicketMessages).toHaveBeenCalledWith(
      'ticket_1',
      expect.objectContaining({ includeInternal: true })
    )
  })

  it('refuses a non-team principal so internal notes cannot leak', async () => {
    hoisted.isTeamMember.mockReturnValue(false)
    await expect(exportTicketTranscriptFn({ data: { ticketId: 'ticket_1' } })).rejects.toThrow(
      /team members/i
    )
    expect(hoisted.listTicketMessages).not.toHaveBeenCalled()
  })

  it('pages oldest-first, deriving the cursor from the oldest message (no nextCursor)', async () => {
    hoisted.listTicketMessages
      .mockResolvedValueOnce({
        messages: [message({ id: 'message_newer', content: 'newer' })],
        hasMore: true,
      })
      .mockResolvedValueOnce({
        messages: [message({ id: 'message_older', content: 'older' })],
        hasMore: false,
      })

    const res = (await exportTicketTranscriptFn({ data: { ticketId: 'ticket_1' } })) as {
      content: string
    }
    expect(hoisted.listTicketMessages).toHaveBeenCalledTimes(2)
    // Second page walks back before the first page's (only, hence oldest) message.
    expect(hoisted.listTicketMessages).toHaveBeenNthCalledWith(
      2,
      'ticket_1',
      expect.objectContaining({ before: 'message_newer' })
    )
    expect(res.content.indexOf('older')).toBeLessThan(res.content.indexOf('newer'))
  })
})
