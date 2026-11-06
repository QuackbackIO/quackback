/**
 * deleteConversationMessage routing: a public message's deletion fans out to the visitor
 * via publishConversationEvent, but an internal note's deletion must stay on the agent
 * inbox channel (the visitor never saw the note, so its id must not surface).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ConversationMessageId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { ForbiddenError, NotFoundError } from '@/lib/shared/errors'
import { PERMISSIONS } from '@/lib/shared/permissions'

const publishConversationEvent = vi.fn()
const publishAgentConversationEvent = vi.fn()
const publishTicketEvent = vi.fn()
const emitTicketReplyDeleted = vi.fn()
// The customer ticket a conversation is paired with (set per test).
let pairTicketId: string | null = null
// Whether the soft-delete UPDATE matched a live row (false = already deleted).
let deleteMatched = true
// The message row the initial SELECT resolves to (set per test).
let messageRow: Record<string, unknown> | null = null

// Hoisted so the (also-hoisted) vi.mock factory can reference the spy bag.
const emit = vi.hoisted(() => ({
  emitConversationCreated: vi.fn(),
  emitMessageCreated: vi.fn(),
  emitMessageNoteCreated: vi.fn(),
  emitMessageDeleted: vi.fn(),
  emitConversationStatusChanged: vi.fn(),
  emitConversationAssigned: vi.fn(),
  emitConversationPriorityChanged: vi.fn(),
  emitConversationCsatSubmitted: vi.fn(),
  emitConversationCsatCommentAdded: vi.fn(),
}))
vi.mock('../conversation.webhooks', () => emit)

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: (...a: unknown[]) => publishConversationEvent(...a),
  publishAgentConversationEvent: (...a: unknown[]) => publishAgentConversationEvent(...a),
  publishConversationUpdate: vi.fn(),
  publishTicketEvent: (...a: unknown[]) => publishTicketEvent(...a),
}))

vi.mock('@/lib/server/domains/tickets/ticket.webhooks', () => ({
  emitTicketReplyDeleted: (...a: unknown[]) => emitTicketReplyDeleted(...a),
}))

vi.mock('@/lib/server/domains/tickets/pair-thread.service', () => ({
  resolvePairTicketIdForConversation: vi.fn(async () => pairTicketId),
}))

vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

vi.mock('../conversation.notify', () => ({
  notifyVisitorMessage: vi.fn(),
  notifyAgentReply: vi.fn(),
}))

vi.mock('../conversation.query', () => ({
  conversationToDTO: vi.fn(async (c: { id: string }) => ({ id: c.id })),
  toMessageDTO: vi.fn((m: Record<string, unknown>) => m),
  authorFromInput: vi.fn((a: { principalId: string }) => ({ principalId: a.principalId })),
  loadAuthors: vi.fn(async () => new Map()),
}))

vi.mock('@/lib/server/db', () => {
  const conversationRow = {
    id: 'conversation_1',
    visitorPrincipalId: 'principal_visitor',
    assignedAgentPrincipalId: null,
    status: 'open',
  }

  function chain(label: string): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    c.from = (t: { __name?: string }) => chain(t?.__name ?? label)
    c.set = () => c
    c.where = () => c
    c.limit = async () =>
      label === 'conversation_messages' ? (messageRow ? [messageRow] : []) : [conversationRow]
    c.returning = async () => (deleteMatched && messageRow ? [{ id: messageRow.id }] : [])
    return c
  }

  return {
    db: {
      select: () => chain('select'),
      update: (t: { __name?: string }) => chain(t?.__name ?? 'unknown'),
    },
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
    conversations: { __name: 'conversations', id: 'id' },
    conversationMessages: { __name: 'conversation_messages', id: 'id' },
  }
})

// Ticket-branch authorization (Task A): ticket.service.ts is a real module
// with a real db-hitting `assertTicketVisible`, so it's mocked here — this
// suite is about deleteConversationMessage's routing/branching, not
// ticketFilter's SQL, which has its own coverage in the tickets domain.
const mockAssertTicketVisible = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  assertTicketVisible: (...args: unknown[]) => mockAssertTicketVisible(...args),
}))

import { deleteConversationMessage } from '../conversation.service'

const agentActor: Actor = {
  principalId: 'principal_agent' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}

const nonAgentActor: Actor = {
  principalId: 'principal_visitor' as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
}

beforeEach(() => {
  messageRow = null
  pairTicketId = null
  deleteMatched = true
  vi.clearAllMocks()
  mockAssertTicketVisible.mockResolvedValue({ id: 'ticket_1' })
})

describe('deleteConversationMessage publish routing', () => {
  it('broadcasts a public message deletion to the visitor channel', async () => {
    messageRow = {
      id: 'conversation_msg_1',
      conversationId: 'conversation_1',
      senderType: 'agent',
      principalId: 'principal_agent',
      isInternal: false,
      deletedAt: null,
    }
    await deleteConversationMessage('conversation_msg_1' as ConversationMessageId, agentActor)
    expect(publishConversationEvent).toHaveBeenCalledTimes(1)
    expect(publishAgentConversationEvent).not.toHaveBeenCalled()
    // A public deletion fires the public message.deleted webhook.
    expect(emit.emitMessageDeleted).toHaveBeenCalledTimes(1)
  })

  it('keeps an internal-note deletion on the agent inbox channel only', async () => {
    messageRow = {
      id: 'conversation_msg_note',
      conversationId: 'conversation_1',
      senderType: 'agent',
      principalId: 'principal_agent',
      isInternal: true,
      deletedAt: null,
    }
    await deleteConversationMessage('conversation_msg_note' as ConversationMessageId, agentActor)
    expect(publishAgentConversationEvent).toHaveBeenCalledTimes(1)
    expect(publishConversationEvent).not.toHaveBeenCalled()
    // The note never reached the visitor, so its deletion fires no public webhook.
    expect(emit.emitMessageDeleted).not.toHaveBeenCalled()
  })
})

describe('deleteConversationMessage on a linked pair', () => {
  const pairMessage = {
    id: 'conversation_msg_1',
    conversationId: 'conversation_1',
    senderType: 'visitor',
    principalId: 'principal_visitor',
    isInternal: false,
    deletedAt: null,
  }

  it("also drops the reply from the paired ticket's thread and fires ticket.reply_deleted", async () => {
    pairTicketId = 'ticket_pair'
    messageRow = { ...pairMessage }
    await deleteConversationMessage('conversation_msg_1' as ConversationMessageId, agentActor)
    expect(emit.emitMessageDeleted).toHaveBeenCalledTimes(1)
    expect(publishTicketEvent).toHaveBeenCalledWith(
      'ticket_pair',
      expect.objectContaining({ kind: 'ticket_message_deleted', messageId: 'conversation_msg_1' })
    )
    expect(emitTicketReplyDeleted).toHaveBeenCalledWith(
      agentActor,
      'ticket_pair',
      'conversation_msg_1',
      'visitor'
    )
  })

  it('touches no ticket for an unpaired conversation', async () => {
    messageRow = { ...pairMessage }
    await deleteConversationMessage('conversation_msg_1' as ConversationMessageId, agentActor)
    expect(publishTicketEvent).not.toHaveBeenCalled()
    expect(emitTicketReplyDeleted).not.toHaveBeenCalled()
  })
})

describe('deleteConversationMessage ticket branch', () => {
  const ticketMessage = {
    id: 'conversation_msg_ticket',
    conversationId: null,
    ticketId: 'ticket_1',
    senderType: 'agent' as const,
    principalId: 'principal_agent',
    isInternal: false,
    deletedAt: null,
  }

  it('deletes a ticket-parented reply, drops it from open ticket threads and fires ticket.reply_deleted', async () => {
    messageRow = { ...ticketMessage }
    await deleteConversationMessage('conversation_msg_ticket' as ConversationMessageId, agentActor)
    expect(mockAssertTicketVisible).toHaveBeenCalledWith('ticket_1', agentActor)
    expect(publishTicketEvent).toHaveBeenCalledWith('ticket_1', {
      kind: 'ticket_message_deleted',
      ticketId: 'ticket_1',
      messageId: 'conversation_msg_ticket',
    })
    expect(emitTicketReplyDeleted).toHaveBeenCalledWith(
      agentActor,
      'ticket_1',
      'conversation_msg_ticket',
      'agent'
    )
    // The conversation channels and message.deleted belong to conversations.
    expect(publishAgentConversationEvent).not.toHaveBeenCalled()
    expect(publishConversationEvent).not.toHaveBeenCalled()
    expect(emit.emitMessageDeleted).not.toHaveBeenCalled()
  })

  it('removes a deleted ticket note from open threads without telling integrations', async () => {
    messageRow = { ...ticketMessage, isInternal: true }
    await deleteConversationMessage('conversation_msg_ticket' as ConversationMessageId, agentActor)
    expect(publishTicketEvent).toHaveBeenCalledTimes(1)
    expect(emitTicketReplyDeleted).not.toHaveBeenCalled()
  })

  it('announces nothing when the message was already deleted', async () => {
    messageRow = { ...ticketMessage }
    deleteMatched = false
    await deleteConversationMessage('conversation_msg_ticket' as ConversationMessageId, agentActor)
    expect(publishTicketEvent).not.toHaveBeenCalled()
    expect(emitTicketReplyDeleted).not.toHaveBeenCalled()
  })

  it('404s when the ticket is not visible to the actor', async () => {
    messageRow = { ...ticketMessage }
    mockAssertTicketVisible.mockRejectedValue(
      new NotFoundError('TICKET_NOT_FOUND', 'Ticket not found')
    )
    await expect(
      deleteConversationMessage('conversation_msg_ticket' as ConversationMessageId, agentActor)
    ).rejects.toThrow(NotFoundError)
  })

  it('refuses a non-agent actor even when the ticket is visible', async () => {
    messageRow = { ...ticketMessage }
    await expect(
      deleteConversationMessage('conversation_msg_ticket' as ConversationMessageId, nonAgentActor)
    ).rejects.toThrow()
    expect(publishAgentConversationEvent).not.toHaveBeenCalled()
  })

  it("lets a teammate without manage delete their own ticket reply, not someone else's", async () => {
    const replier: Actor = {
      ...agentActor,
      role: 'member',
      permissions: new Set([PERMISSIONS.TICKET_REPLY]),
    }
    messageRow = { ...ticketMessage }
    await deleteConversationMessage('conversation_msg_ticket' as ConversationMessageId, replier)

    messageRow = { ...ticketMessage, principalId: 'principal_other' }
    await expect(
      deleteConversationMessage('conversation_msg_ticket' as ConversationMessageId, replier)
    ).rejects.toThrow(ForbiddenError)
  })

  it('refuses deleting a ticket-parented system message', async () => {
    messageRow = { ...ticketMessage, senderType: 'system', principalId: null }
    await expect(
      deleteConversationMessage('conversation_msg_ticket' as ConversationMessageId, agentActor)
    ).rejects.toThrow(ForbiddenError)
  })
})
