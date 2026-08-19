/**
 * Reaction + flag publish routing (LEAK GUARD): every agent-only message action
 * must fan out on the inbox channel via publishAgentConversationEvent ONLY — never via
 * publishConversationEvent (which also reaches the visitor's conversation channel). The
 * agent gate and the system/deleted-message guards are exercised too.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ConversationMessageId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { NotFoundError } from '@/lib/shared/errors'

const publishConversationEvent = vi.fn()
const publishAgentConversationEvent = vi.fn()

// The row the message-load SELECT resolves to (set per test).
let messageRow: Record<string, unknown> | null = null

// Ticket-branch authorization (Task B): a ticket-parented message additionally
// requires assertTicketVisible to allow the actor through before the
// reaction/flag write proceeds. Mocked here (real db-hitting implementation
// has its own coverage in the tickets domain); this suite is only about
// message.actions.ts's routing/gating.
const mockAssertTicketVisible = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  assertTicketVisible: (...args: unknown[]) => mockAssertTicketVisible(...args),
}))

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: (...a: unknown[]) => publishConversationEvent(...a),
  publishAgentConversationEvent: (...a: unknown[]) => publishAgentConversationEvent(...a),
  publishConversationUpdate: vi.fn(),
}))

// Enrichment is exercised elsewhere; here we only care about routing, so stub it.
vi.mock('../conversation.query', () => ({
  toMessageDTO: (m: Record<string, unknown>) => m,
  loadAuthors: vi.fn(async () => new Map()),
  fallbackAuthor: (principalId: string) => ({ principalId, displayName: null, avatarUrl: null }),
  enrichMessageForAgent: vi.fn(async (m: Record<string, unknown>) => ({
    ...m,
    reactions: [],
    flaggedAt: null,
  })),
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  function chain(): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.where = () => c
    c.values = () => c
    c.set = () => c
    c.onConflictDoNothing = async () => []
    c.limit = async () => (messageRow ? [messageRow] : [])
    // Make `await db.delete(...).where(...)` resolve.
    c.then = (resolve: (v: unknown) => unknown) => resolve(undefined)
    return c
  }
  // Spread the real db module so tables/operators stay current; override only what this suite drives.
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: {
      select: () => chain(),
      insert: () => chain(),
      delete: () => chain(),
    },
    eq: vi.fn(),
    and: vi.fn(),
  }
})

import { addMessageReaction, removeMessageReaction, setMessageFlag } from '../message.actions'

const agent: Actor = {
  principalId: 'principal_agent' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}
const visitor: Actor = {
  principalId: 'principal_visitor' as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
}

const publicMessage = {
  id: 'conversation_msg_1',
  conversationId: 'conversation_1',
  senderType: 'visitor',
  principalId: 'principal_visitor',
  isInternal: false,
  deletedAt: null,
  // setMessageFlag re-reads the flag row after writing; give the chain mock a
  // timestamp so its toISOString() doesn't throw.
  flaggedAt: new Date(),
}

beforeEach(() => {
  messageRow = { ...publicMessage }
  vi.clearAllMocks()
  mockAssertTicketVisible.mockResolvedValue({ id: 'ticket_1' })
})

describe('message reaction/flag publish routing', () => {
  it('adds a reaction on the inbox channel only', async () => {
    await addMessageReaction('conversation_msg_1' as ConversationMessageId, '👍', agent)
    expect(publishAgentConversationEvent).toHaveBeenCalledTimes(1)
    expect(publishAgentConversationEvent.mock.calls[0][0]).toMatchObject({
      kind: 'message_updated',
    })
    expect(publishConversationEvent).not.toHaveBeenCalled()
  })

  it('removes a reaction on the inbox channel only', async () => {
    await removeMessageReaction('conversation_msg_1' as ConversationMessageId, '👍', agent)
    expect(publishAgentConversationEvent).toHaveBeenCalledTimes(1)
    expect(publishConversationEvent).not.toHaveBeenCalled()
  })

  it('flags and unflags without broadcasting (a flag is personal)', async () => {
    await setMessageFlag('conversation_msg_1' as ConversationMessageId, true, agent)
    await setMessageFlag('conversation_msg_1' as ConversationMessageId, false, agent)
    expect(publishAgentConversationEvent).not.toHaveBeenCalled()
    expect(publishConversationEvent).not.toHaveBeenCalled()
  })
})

describe('message reaction/flag guards', () => {
  it('refuses a non-team actor and publishes nothing', async () => {
    await expect(
      addMessageReaction('conversation_msg_1' as ConversationMessageId, '👍', visitor)
    ).rejects.toThrow()
    expect(publishAgentConversationEvent).not.toHaveBeenCalled()
    expect(publishConversationEvent).not.toHaveBeenCalled()
  })

  it('refuses reacting to a system message', async () => {
    messageRow = { ...publicMessage, senderType: 'system', principalId: null }
    await expect(
      setMessageFlag('conversation_msg_1' as ConversationMessageId, true, agent)
    ).rejects.toThrow()
    expect(publishAgentConversationEvent).not.toHaveBeenCalled()
  })

  it('refuses reacting to a soft-deleted message', async () => {
    messageRow = { ...publicMessage, deletedAt: new Date() }
    await expect(
      addMessageReaction('conversation_msg_1' as ConversationMessageId, '👍', agent)
    ).rejects.toThrow()
    expect(publishAgentConversationEvent).not.toHaveBeenCalled()
  })
})

describe('ticket-parented message reaction/flag authorization', () => {
  const ticketMessage = {
    id: 'conversation_msg_ticket',
    conversationId: null,
    ticketId: 'ticket_1',
    senderType: 'agent',
    principalId: 'principal_agent',
    isInternal: false,
    deletedAt: null,
    flaggedAt: new Date(),
  }

  it('reacts to a ticket-parented message when the ticket is visible to the actor', async () => {
    messageRow = { ...ticketMessage }
    const { reactions } = await addMessageReaction(
      'conversation_msg_ticket' as ConversationMessageId,
      '👍',
      agent
    )
    expect(mockAssertTicketVisible).toHaveBeenCalledWith('ticket_1', agent)
    expect(reactions).toEqual([])
    // No broadcast for ticket-parented messages yet (deferred to the customer loop).
    expect(publishAgentConversationEvent).not.toHaveBeenCalled()
  })

  it('flags a ticket-parented message when the ticket is visible to the actor', async () => {
    messageRow = { ...ticketMessage }
    const { flaggedAt } = await setMessageFlag(
      'conversation_msg_ticket' as ConversationMessageId,
      true,
      agent
    )
    expect(mockAssertTicketVisible).toHaveBeenCalledWith('ticket_1', agent)
    expect(flaggedAt).not.toBeNull()
  })

  it('404s reacting to a ticket-parented message the actor cannot see', async () => {
    messageRow = { ...ticketMessage }
    mockAssertTicketVisible.mockRejectedValue(
      new NotFoundError('TICKET_NOT_FOUND', 'Ticket not found')
    )
    await expect(
      addMessageReaction('conversation_msg_ticket' as ConversationMessageId, '👍', agent)
    ).rejects.toThrow(NotFoundError)
    expect(publishAgentConversationEvent).not.toHaveBeenCalled()
  })

  it('404s flagging a ticket-parented message the actor cannot see (e.g. assigned to another team)', async () => {
    messageRow = { ...ticketMessage }
    mockAssertTicketVisible.mockRejectedValue(
      new NotFoundError('TICKET_NOT_FOUND', 'Ticket not found')
    )
    await expect(
      setMessageFlag('conversation_msg_ticket' as ConversationMessageId, true, agent)
    ).rejects.toThrow(NotFoundError)
  })

  it('never consults ticket visibility for a conversation-parented message', async () => {
    messageRow = { ...publicMessage }
    await addMessageReaction('conversation_msg_1' as ConversationMessageId, '👍', agent)
    expect(mockAssertTicketVisible).not.toHaveBeenCalled()
  })
})
