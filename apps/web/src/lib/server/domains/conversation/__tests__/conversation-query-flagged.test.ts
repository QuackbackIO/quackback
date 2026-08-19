/**
 * `listFlaggedMessages` (UNIFIED-INBOX-SPEC.md §2.5/M4): the "Saved for later"
 * feed unions two branches — a conversation-parented flag (unchanged) and a
 * ticket-parented one (new), the latter gated by `ticketFilter(actor)` so a
 * flag on a ticket the viewer can no longer see quietly drops out. The db
 * chain mock below routes rows by which second table (`conversations` vs
 * `tickets`) a query's `innerJoin` names, since both branches otherwise start
 * from the same `conversationMessageFlags`/`conversationMessages` join.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

let conversationRows: Record<string, unknown>[] = []
let ticketRows: Record<string, unknown>[] = []
const ticketFilterCalls: unknown[] = []

vi.mock('@/lib/server/policy/tickets', () => ({
  ticketFilter: (actor: unknown) => {
    ticketFilterCalls.push(actor)
    return 'TICKET_FILTER_SENTINEL'
  },
}))

vi.mock('../../principals/principal-display', () => ({
  loadAuthors: vi.fn(async (ids: string[]) => {
    const map = new Map()
    for (const id of ids)
      map.set(id, { principalId: id, displayName: 'Vic Visitor', avatarUrl: null })
    return map
  }),
  fallbackAuthor: (principalId: string) => ({ principalId, displayName: null, avatarUrl: null }),
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  function chain() {
    let joinedTicket = false
    const c: Record<string, unknown> = {}
    c.select = () => c
    c.from = () => c
    c.innerJoin = (table: { __name?: string }) => {
      if (table?.__name === 'tickets') joinedTicket = true
      return c
    }
    c.leftJoin = () => c
    c.where = () => c
    c.orderBy = () => c
    c.limit = async () => (joinedTicket ? ticketRows : conversationRows)
    return c
  }
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: { select: () => chain() },
    tickets: { __name: 'tickets' },
  }
})

import { listFlaggedMessages } from '../conversation.query'

const agent: Actor = {
  principalId: 'principal_agent' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}

beforeEach(() => {
  conversationRows = []
  ticketRows = []
  ticketFilterCalls.length = 0
})

describe('listFlaggedMessages', () => {
  it('returns [] for an actor with no principalId (service-scoped callers)', async () => {
    const result = await listFlaggedMessages({
      principalId: null,
      role: 'admin',
      principalType: 'service',
      segmentIds: new Set(),
    })
    expect(result).toEqual([])
  })

  it('includes a conversation-parented flag, unchanged', async () => {
    conversationRows = [
      {
        messageId: 'conversation_msg_1',
        conversationId: 'conversation_1',
        content: 'Help please',
        senderType: 'visitor',
        authorName: null,
        visitorPrincipalId: 'principal_visitor',
        flaggedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]
    const result = await listFlaggedMessages(agent)
    expect(result).toEqual([
      expect.objectContaining({
        messageId: 'conversation_msg_1',
        conversationId: 'conversation_1',
        ticketId: null,
        conversationLabel: 'Vic Visitor',
      }),
    ])
  })

  it('includes a ticket-parented flag, scoped by ticketFilter(actor)', async () => {
    ticketRows = [
      {
        messageId: 'conversation_msg_2',
        ticketId: 'ticket_1',
        content: 'Cannot log in',
        senderType: 'agent',
        authorName: 'Agent Smith',
        ticketTitle: 'Cannot log in',
        ticketNumber: 1,
        flaggedAt: new Date('2026-07-02T00:00:00.000Z'),
      },
    ]
    const result = await listFlaggedMessages(agent)
    expect(result).toEqual([
      expect.objectContaining({
        messageId: 'conversation_msg_2',
        conversationId: null,
        ticketId: 'ticket_1',
        authorName: 'Agent Smith',
        conversationLabel: '#1 · Cannot log in',
      }),
    ])
    expect(ticketFilterCalls).toEqual([agent])
  })

  it('merges both branches, newest flag first', async () => {
    conversationRows = [
      {
        messageId: 'conversation_msg_older',
        conversationId: 'conversation_1',
        content: 'older',
        senderType: 'visitor',
        authorName: null,
        visitorPrincipalId: 'principal_visitor',
        flaggedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]
    ticketRows = [
      {
        messageId: 'conversation_msg_newer',
        ticketId: 'ticket_1',
        content: 'newer',
        senderType: 'agent',
        authorName: 'Agent Smith',
        ticketTitle: 'Ticket',
        ticketNumber: 1,
        flaggedAt: new Date('2026-07-03T00:00:00.000Z'),
      },
    ]
    const result = await listFlaggedMessages(agent)
    expect(result.map((r) => r.messageId)).toEqual([
      'conversation_msg_newer',
      'conversation_msg_older',
    ])
  })
})
