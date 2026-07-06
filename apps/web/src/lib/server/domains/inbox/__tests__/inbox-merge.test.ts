/**
 * DB-free unit tests for `mergeInboxBranches` (UNIFIED-INBOX-SPEC.md §3.1): the
 * pure merge-sort of the conversation + ticket branches into one
 * activity-ordered page, and its cursor derivation. Every case is exercised
 * against fabricated DTOs — no db import, no mocks.
 */
import { describe, it, expect } from 'vitest'
import type { ConversationId, TicketId } from '@quackback/ids'
import type { ConversationDTO } from '@/lib/shared/conversation/types'
import type { TicketDTO } from '@/lib/server/domains/tickets/ticket.types'
import type { InboxItemDTO } from '@/lib/shared/inbox/items'
import { mergeInboxBranches, type InboxBranchFetch, type InboxSort } from '../inbox.query'

function conversationItem(over: {
  id: string
  priority?: ConversationDTO['priority']
  createdAt?: string
  lastMessageAt?: string | null
}): InboxItemDTO {
  const conversation = {
    id: over.id as ConversationId,
    status: 'open',
    priority: over.priority ?? 'none',
    channel: 'messenger',
    subject: null,
    lastMessagePreview: null,
    lastMessageAt: over.lastMessageAt !== undefined ? over.lastMessageAt : over.createdAt,
    createdAt: over.createdAt ?? '2026-01-01T00:00:00.000Z',
    visitor: { principalId: 'principal_visitor', displayName: null, avatarUrl: null },
    assignedAgent: null,
    unreadCount: 0,
    visitorLastReadAt: null,
    agentLastReadAt: null,
    csatRating: null,
    visitorEmail: null,
    resolvedAt: null,
    endReason: null,
    endNote: null,
    snoozedUntil: null,
    assignedTeamId: null,
    tags: [],
    sla: null,
    customAttributes: {},
    translation: null,
  } as unknown as ConversationDTO
  return { kind: 'conversation', conversation, linkedTicket: null }
}

function ticketItem(over: {
  id: string
  priority?: TicketDTO['priority']
  createdAt?: string
  updatedAt?: string
}): InboxItemDTO {
  const ticket = {
    id: over.id as TicketId,
    number: 1,
    reference: '#1',
    type: 'customer',
    title: 'A ticket',
    status: { id: 'ticket_status_1', name: 'Open', color: '#000', category: 'open' },
    stage: { slot: null, label: null },
    priority: over.priority ?? 'none',
    requester: null,
    assignee: { principalId: null, displayName: null, teamId: null, teamName: null },
    company: null,
    firstResponseAt: null,
    dueAt: null,
    resolvedAt: null,
    createdAt: over.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: over.updatedAt ?? over.createdAt ?? '2026-01-01T00:00:00.000Z',
    reopenedCount: 0,
    lastMessagePreview: null,
    lastMessageAt: null,
  } as unknown as TicketDTO
  return { kind: 'ticket', ticket, unreadCount: 0 }
}

function branch(items: InboxItemDTO[], over: Partial<InboxBranchFetch> = {}): InboxBranchFetch {
  return { items, hasMore: false, cursor: null, ...over }
}

function ids(items: InboxItemDTO[]): string[] {
  return items.map((i) => (i.kind === 'conversation' ? i.conversation.id : i.ticket.id))
}

describe('mergeInboxBranches', () => {
  it('interleaves both branches by activity (recent, desc)', () => {
    const conv = conversationItem({
      id: 'conversation_a',
      lastMessageAt: '2026-01-03T00:00:00.000Z',
    })
    const ticket1 = ticketItem({ id: 'ticket_a', updatedAt: '2026-01-04T00:00:00.000Z' })
    const ticket2 = ticketItem({ id: 'ticket_b', updatedAt: '2026-01-01T00:00:00.000Z' })

    const result = mergeInboxBranches({
      conversation: branch([conv]),
      ticket: branch([ticket1, ticket2]),
      sort: 'recent',
      limit: 10,
    })
    expect(ids(result.items)).toEqual(['ticket_a', 'conversation_a', 'ticket_b'])
    expect(result.cursor).toBeNull() // neither branch has more
  })

  it('a conversation with no lastMessageAt falls back to createdAt for the activity key', () => {
    const conv = conversationItem({
      id: 'conversation_a',
      lastMessageAt: null,
      createdAt: '2026-01-05T00:00:00.000Z',
    })
    const ticket1 = ticketItem({ id: 'ticket_a', updatedAt: '2026-01-02T00:00:00.000Z' })

    const result = mergeInboxBranches({
      conversation: branch([conv]),
      ticket: branch([ticket1]),
      sort: 'recent',
      limit: 10,
    })
    // conversation's fallback activity (2026-01-05) beats the ticket's (2026-01-02).
    expect(ids(result.items)).toEqual(['conversation_a', 'ticket_a'])
  })

  it('reverses the order for the oldest sort', () => {
    const conv = conversationItem({
      id: 'conversation_a',
      lastMessageAt: '2026-01-03T00:00:00.000Z',
    })
    const ticket1 = ticketItem({ id: 'ticket_a', updatedAt: '2026-01-01T00:00:00.000Z' })

    const result = mergeInboxBranches({
      conversation: branch([conv]),
      ticket: branch([ticket1]),
      sort: 'oldest',
      limit: 10,
    })
    expect(ids(result.items)).toEqual(['ticket_a', 'conversation_a'])
  })

  it('the created sort orders by createdAt, not the activity (lastMessageAt/updatedAt) key', () => {
    // Ticket created earlier but updated later; conversation created later but
    // with no recent message activity. 'created' must ignore the activity gap.
    const conv = conversationItem({
      id: 'conversation_a',
      createdAt: '2026-01-05T00:00:00.000Z',
      lastMessageAt: '2026-01-05T00:00:00.000Z',
    })
    const ticket1 = ticketItem({
      id: 'ticket_a',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-09T00:00:00.000Z',
    })
    const result = mergeInboxBranches({
      conversation: branch([conv]),
      ticket: branch([ticket1]),
      sort: 'created',
      limit: 10,
    })
    // Newest-created first: conversation (Jan 5) before ticket (Jan 1), despite
    // the ticket's later updatedAt.
    expect(ids(result.items)).toEqual(['conversation_a', 'ticket_a'])
  })

  it('the priority sort merges on (priorityRank desc, id) across kinds', () => {
    const low = conversationItem({ id: 'conversation_low', priority: 'low' })
    const urgent = ticketItem({ id: 'ticket_urgent', priority: 'urgent' })
    const high = conversationItem({ id: 'conversation_high', priority: 'high' })

    const result = mergeInboxBranches({
      conversation: branch([low, high]),
      ticket: branch([urgent]),
      sort: 'priority',
      limit: 10,
    })
    expect(ids(result.items)).toEqual(['ticket_urgent', 'conversation_high', 'conversation_low'])
  })

  it('breaks an exact-tie on activity by kind then id (deterministic, not insertion order)', () => {
    const sameInstant = '2026-01-01T00:00:00.000Z'
    const ticket = ticketItem({ id: 'ticket_z', updatedAt: sameInstant })
    const conv = conversationItem({ id: 'conversation_a', lastMessageAt: sameInstant })

    const result = mergeInboxBranches({
      conversation: branch([conv]),
      ticket: branch([ticket]),
      sort: 'recent',
      limit: 10,
    })
    // 'conversation' < 'ticket' lexically, so the conversation wins the tie
    // regardless of which branch's array it came from.
    expect(ids(result.items)).toEqual(['conversation_a', 'ticket_z'])
  })

  describe('truncation + hasMore/cursor derivation', () => {
    const sort: InboxSort = 'recent'

    it('truncates to the limit and reports hasMore + a cursor when candidates overflow', () => {
      const c1 = conversationItem({
        id: 'conversation_1',
        lastMessageAt: '2026-01-05T00:00:00.000Z',
      })
      const c2 = conversationItem({
        id: 'conversation_2',
        lastMessageAt: '2026-01-03T00:00:00.000Z',
      })
      const t1 = ticketItem({ id: 'ticket_1', updatedAt: '2026-01-04T00:00:00.000Z' })

      const result = mergeInboxBranches({
        conversation: branch([c1, c2]),
        ticket: branch([t1]),
        sort,
        limit: 2,
      })
      expect(ids(result.items)).toEqual(['conversation_1', 'ticket_1'])
      expect(result.cursor).not.toBeNull()
    })

    it('reports no cursor when both branches are fully consumed and neither has more', () => {
      const c1 = conversationItem({
        id: 'conversation_1',
        lastMessageAt: '2026-01-02T00:00:00.000Z',
      })
      const t1 = ticketItem({ id: 'ticket_1', updatedAt: '2026-01-01T00:00:00.000Z' })
      const result = mergeInboxBranches({
        conversation: branch([c1], { hasMore: false }),
        ticket: branch([t1], { hasMore: false }),
        sort,
        limit: 10,
      })
      expect(result.cursor).toBeNull()
    })

    it('emits a cursor when a branch itself flags hasMore, even without local overflow', () => {
      const c1 = conversationItem({
        id: 'conversation_1',
        lastMessageAt: '2026-01-02T00:00:00.000Z',
      })
      const result = mergeInboxBranches({
        conversation: branch([c1], { hasMore: true }),
        ticket: branch([], { hasMore: false }),
        sort,
        limit: 10,
      })
      expect(result.cursor).not.toBeNull()
    })

    it('a branch that contributed zero items to this page carries its previous cursor forward', () => {
      // The ticket branch's own candidates are all older than the cut, so none
      // make this page — its cursor must stay put (echoed), not advance past
      // rows it never showed the caller.
      const c1 = conversationItem({
        id: 'conversation_1',
        lastMessageAt: '2026-01-10T00:00:00.000Z',
      })
      const t1 = ticketItem({ id: 'ticket_1', updatedAt: '2026-01-01T00:00:00.000Z' })

      const result = mergeInboxBranches({
        conversation: branch([c1], { hasMore: true, cursor: null }),
        ticket: branch([t1], { hasMore: false, cursor: 'ticket_prev' as unknown as TicketId }),
        sort,
        limit: 1,
      })
      expect(ids(result.items)).toEqual(['conversation_1'])
      expect(result.cursor).not.toBeNull()
      const decoded = JSON.parse(Buffer.from(result.cursor as string, 'base64url').toString('utf8'))
      expect(decoded).toEqual({ c: 'conversation_1', t: 'ticket_prev' })
    })

    it('advances only the branch(es) that actually contributed to the emitted page', () => {
      const c1 = conversationItem({
        id: 'conversation_1',
        lastMessageAt: '2026-01-05T00:00:00.000Z',
      })
      const c2 = conversationItem({
        id: 'conversation_2',
        lastMessageAt: '2026-01-04T00:00:00.000Z',
      })
      const t1 = ticketItem({ id: 'ticket_1', updatedAt: '2026-01-03T00:00:00.000Z' })

      const result = mergeInboxBranches({
        conversation: branch([c1, c2], { hasMore: true }),
        ticket: branch([t1], { hasMore: false }),
        sort,
        limit: 2,
      })
      expect(ids(result.items)).toEqual(['conversation_1', 'conversation_2'])
      const decoded = JSON.parse(Buffer.from(result.cursor as string, 'base64url').toString('utf8'))
      // Conversation cursor advanced to the last emitted conversation; ticket
      // cursor stayed at its input (null — it never got to emit t1).
      expect(decoded).toEqual({ c: 'conversation_2', t: null })
    })
  })

  it('treats an empty branch (RBAC-skipped or kind-excluded) as permanently exhausted', () => {
    const t1 = ticketItem({ id: 'ticket_1', updatedAt: '2026-01-01T00:00:00.000Z' })
    const result = mergeInboxBranches({
      conversation: branch([], { hasMore: false, cursor: null }),
      ticket: branch([t1], { hasMore: false }),
      sort: 'recent',
      limit: 10,
    })
    expect(ids(result.items)).toEqual(['ticket_1'])
    expect(result.cursor).toBeNull()
  })
})
