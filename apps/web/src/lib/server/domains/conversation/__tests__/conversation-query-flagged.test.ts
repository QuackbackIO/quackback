/**
 * `listFlaggedMessages` (UNIFIED-INBOX-SPEC.md §2.5/M4): the "Saved for later"
 * feed unions two branches — a conversation-parented flag (unchanged) and a
 * ticket-parented one (new), the latter gated by `ticketFilter(actor)` so a
 * flag on a ticket the viewer can no longer see quietly drops out. The db
 * chain mock below routes rows by which second table (`conversations` vs
 * `tickets`) a query's `innerJoin` names, since both branches otherwise start
 * from the same `conversationMessageFlags`/`conversationMessages` join.
 *
 * Names come from the shared author loader (stubbed here by id; the real one
 * runs in tickets/__tests__/personal-key-author.db.test.ts).
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

const authors: Record<string, { displayName: string | null; viaApi?: boolean }> = {
  principal_visitor: { displayName: 'Vic Visitor' },
  principal_agent_smith: { displayName: 'Agent Smith' },
  principal_ops_bot: { displayName: 'ops-bot', viaApi: true },
}
const loadAuthors = vi.hoisted(() => vi.fn())
vi.mock('../../principals/principal-display', () => ({
  loadAuthors,
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
  loadAuthors.mockReset().mockImplementation(async (ids: Array<string | null>) => {
    const map = new Map()
    for (const id of ids)
      if (id && authors[id]) map.set(id, { principalId: id, avatarUrl: null, ...authors[id] })
    return map
  })
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
        authorPrincipalId: null,
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
        authorPrincipalId: 'principal_agent_smith',
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
        authorPrincipalId: null,
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
        authorPrincipalId: 'principal_agent_smith',
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

describe('listFlaggedMessages — authors', () => {
  const flaggedRow = (over: Record<string, unknown>) => ({
    messageId: 'conversation_msg_2',
    conversationId: 'conversation_1',
    content: 'Here is how',
    senderType: 'agent',
    authorPrincipalId: 'principal_agent_smith',
    visitorPrincipalId: 'principal_visitor',
    flaggedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...over,
  })

  it('names every author and visitor with one batched read, as the inbox does', async () => {
    conversationRows = [flaggedRow({})]
    ticketRows = [
      {
        messageId: 'conversation_msg_3',
        ticketId: 'ticket_1',
        content: 'Synced',
        senderType: 'agent',
        authorPrincipalId: 'principal_ops_bot',
        ticketTitle: 'Ticket',
        ticketNumber: 1,
        flaggedAt: new Date('2026-07-02T00:00:00.000Z'),
      },
    ]
    await listFlaggedMessages(agent)
    expect(loadAuthors).toHaveBeenCalledExactlyOnceWith(
      ['principal_visitor', 'principal_agent_smith', 'principal_ops_bot'],
      { preferAccountName: true }
    )
  })

  it('marks an author that shows as an API key, and only that one', async () => {
    conversationRows = [
      flaggedRow({ messageId: 'conversation_msg_bot', authorPrincipalId: 'principal_ops_bot' }),
      flaggedRow({ messageId: 'conversation_msg_person' }),
    ]
    const flags = await listFlaggedMessages(agent)
    const byId = Object.fromEntries(flags.map((f) => [f.messageId, f]))
    expect(byId.conversation_msg_bot).toMatchObject({ authorName: 'ops-bot', authorViaApi: true })
    expect(byId.conversation_msg_person.authorName).toBe('Agent Smith')
    expect(byId.conversation_msg_person).not.toHaveProperty('authorViaApi')
  })

  it('falls back to the sender type for a message with no author', async () => {
    conversationRows = [flaggedRow({ authorPrincipalId: null })]
    const [flag] = await listFlaggedMessages(agent)
    expect(flag.authorName).toBe('Agent')
  })
})
