/**
 * deleteConversationMessage: who may delete, and what the removal tells the
 * world. A delete is soft: the customer loses the message, the team keeps a
 * placeholder. `publishRemoval` (conversation.history) does the fan-out and has
 * its own suite; here we check it is told whether the customer ever saw the
 * message, and that the list preview is refreshed only when they did.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ConversationMessageId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { ForbiddenError, NotFoundError } from '@/lib/shared/errors'
import { PERMISSIONS } from '@/lib/shared/permissions'

const publishConversationEvent = vi.fn()
const publishAgentConversationEvent = vi.fn()
// The message row the initial SELECT resolves to (set per test).
let messageRow: Record<string, unknown> | null = null
const softDeletes: Array<Record<string, unknown>> = []

const history = vi.hoisted(() => ({
  agentMessageDto: vi.fn(async (m: Record<string, unknown>) => ({ ...m, dto: true })),
  publishRemoval: vi.fn(async () => {}),
  refreshConversationPreview: vi.fn(async () => {}),
}))
vi.mock('../conversation.history', () => history)

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
    let values: Record<string, unknown> = {}
    c.from = (t: { __name?: string }) => chain(t?.__name ?? label)
    c.set = (v: Record<string, unknown>) => {
      values = v
      return c
    }
    c.where = () => c
    c.limit = async () =>
      label === 'conversation_messages' ? (messageRow ? [messageRow] : []) : [conversationRow]
    c.returning = async () => {
      softDeletes.push(values)
      return messageRow ? [{ ...messageRow, ...values }] : []
    }
    return c
  }

  const db = {
    select: () => chain('select'),
    update: (t: { __name?: string }) => chain(t?.__name ?? 'unknown'),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  }
  return {
    db,
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
  softDeletes.length = 0
  vi.clearAllMocks()
  mockAssertTicketVisible.mockResolvedValue({ id: 'ticket_1' })
})

describe('deleteConversationMessage', () => {
  const reply = {
    id: 'conversation_msg_1',
    conversationId: 'conversation_1',
    ticketId: null,
    senderType: 'agent',
    principalId: 'principal_agent',
    isInternal: false,
    deletedAt: null,
    metadata: null,
  }

  it('soft-deletes a public message, refreshes the preview, and tells the customer', async () => {
    messageRow = { ...reply }
    await deleteConversationMessage('conversation_msg_1' as ConversationMessageId, agentActor)
    expect(softDeletes[0]).toMatchObject({ deletedByPrincipalId: 'principal_agent' })
    expect(softDeletes[0]?.deletedAt).toBeInstanceOf(Date)
    // The body is untouched: only a redaction wipes content.
    expect(softDeletes[0]).not.toHaveProperty('content')
    expect(history.refreshConversationPreview).toHaveBeenCalledWith(
      expect.anything(),
      'conversation_1'
    )
    expect(history.publishRemoval).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conversation_msg_1' }),
      expect.objectContaining({ dto: true }),
      agentActor,
      true
    )
  })

  it('keeps an internal note deletion away from the customer and the preview', async () => {
    messageRow = { ...reply, id: 'conversation_msg_note', isInternal: true }
    await deleteConversationMessage('conversation_msg_note' as ConversationMessageId, agentActor)
    expect(history.refreshConversationPreview).not.toHaveBeenCalled()
    expect(history.publishRemoval).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      agentActor,
      false
    )
  })

  it('lets the customer delete their own message, but not an answer to a block', async () => {
    const own = {
      ...reply,
      senderType: 'visitor',
      principalId: 'principal_visitor',
    }
    messageRow = { ...own }
    await deleteConversationMessage('conversation_msg_1' as ConversationMessageId, nonAgentActor)
    expect(history.publishRemoval).toHaveBeenCalledTimes(1)

    messageRow = { ...own, metadata: { blockReply: { kind: 'buttons' } } }
    await expect(
      deleteConversationMessage('conversation_msg_1' as ConversationMessageId, nonAgentActor)
    ).rejects.toThrow(ForbiddenError)
  })

  it('404s a message that is already deleted', async () => {
    messageRow = { ...reply, deletedAt: new Date() }
    await expect(
      deleteConversationMessage('conversation_msg_1' as ConversationMessageId, agentActor)
    ).rejects.toThrow(NotFoundError)
    expect(history.publishRemoval).not.toHaveBeenCalled()
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

  it('deletes a ticket-parented message for an agent who can see the ticket', async () => {
    messageRow = { ...ticketMessage }
    await deleteConversationMessage('conversation_msg_ticket' as ConversationMessageId, agentActor)
    expect(mockAssertTicketVisible).toHaveBeenCalledWith('ticket_1', agentActor)
    // No conversation, so no customer channel and no preview to refresh.
    expect(history.refreshConversationPreview).not.toHaveBeenCalled()
    expect(history.publishRemoval).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: 'ticket_1' }),
      expect.anything(),
      agentActor,
      false
    )
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
    expect(history.publishRemoval).not.toHaveBeenCalled()
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
