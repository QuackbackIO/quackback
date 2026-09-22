/**
 * editConversationMessage: only the author can rewrite a message, a public edit
 * reaches the visitor, and an internal note stays on the inbox channel.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId, ConversationMessageId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'

const publishConversationOnlyEvent = vi.fn()
const publishAgentConversationEvent = vi.fn()
const publishConversationUpdate = vi.fn()
const emitMessageUpdated = vi.fn()
const updateGitHubIssueComment = vi.fn()
const publishTicketEvent = vi.fn()
let pairTicketId: string | null = null

let messageRow: Record<string, unknown> | null = null
let latestId = 'conversation_msg_1'
const updates: Array<{ table: string; values: Record<string, unknown> }> = []

const emit = vi.hoisted(() => ({
  emitMessageUpdated: (...a: unknown[]) => emitMessageUpdated(...a),
}))

vi.mock('../conversation.webhooks', () => emit)

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationOnlyEvent: (...a: unknown[]) => publishConversationOnlyEvent(...a),
  publishAgentConversationEvent: (...a: unknown[]) => publishAgentConversationEvent(...a),
  publishConversationUpdate: (...a: unknown[]) => publishConversationUpdate(...a),
  publishTicketEvent: (...a: unknown[]) => publishTicketEvent(...a),
}))

vi.mock('@/lib/server/domains/tickets/pair-thread.service', () => ({
  resolvePairTicketIdForConversation: vi.fn(async () => pairTicketId),
}))

vi.mock('@/lib/server/messages/assistant-principal', () => ({
  assistantPrincipalIdOnce: vi.fn(async () => null),
}))

vi.mock('@/lib/server/sanitize-tiptap', () => ({
  sanitizeTiptapContent: (doc: unknown) => doc,
}))

vi.mock('@/lib/server/domains/posts/extract-mentions', () => ({
  extractMentions: () => new Set(),
}))

vi.mock('./sync-conversation-mentions', () => ({
  syncConversationMessageMentions: vi.fn(),
}))

vi.mock('../message-parent', () => ({
  resolveMessageParent: vi.fn(async () => ({ kind: 'ticket', ticketId: 'ticket_1' })),
}))

vi.mock('@/lib/server/domains/channels/github-deliver', () => ({
  updateGitHubIssueComment: (...a: unknown[]) => updateGitHubIssueComment(...a),
}))

vi.mock('../conversation.query', () => ({
  conversationToDTO: vi.fn(async (c: { id: string }) => ({ id: c.id })),
  toMessageDTO: vi.fn((m: Record<string, unknown>) => ({
    id: m.id,
    conversationId: m.conversationId,
    content: m.content,
    contentJson: m.contentJson ?? null,
    editedAt: m.editedAt instanceof Date ? m.editedAt.toISOString() : null,
    isInternal: m.isInternal,
    attachments: m.attachments ?? [],
    senderType: m.senderType,
    author: { principalId: m.principalId, displayName: 'Agent' },
  })),
  loadAuthors: vi.fn(
    async () => new Map([['principal_agent', { displayName: 'Agent', avatarUrl: null }]])
  ),
  fallbackAuthor: vi.fn((id: string) => ({
    principalId: id,
    displayName: 'Agent',
    avatarUrl: null,
  })),
  enrichMessagesForAgent: vi.fn(async (messages: Array<Record<string, unknown>>) =>
    messages.map((m) => ({
      ...m,
      reactions: [],
      flaggedAt: null,
      postSuggestion: null,
      translatedFrom: null,
    }))
  ),
}))

vi.mock('@/lib/server/db', () => {
  const conversationRow = {
    id: 'conversation_1',
    visitorPrincipalId: 'principal_visitor',
    status: 'open',
  }

  function chain(op: string, table = 'select'): Record<string, unknown> {
    const state = { op, table, values: {} as Record<string, unknown> }
    const c: Record<string, unknown> = {}
    c.from = (t: { __name?: string }) => {
      state.table = t?.__name ?? state.table
      return c
    }
    c.set = (values: Record<string, unknown>) => {
      state.values = values
      return c
    }
    c.where = () => c
    c.orderBy = () => c
    c.limit = async () => {
      if (state.table === 'conversation_messages') {
        if (state.op === 'select' && updates.length === 0) return messageRow ? [messageRow] : []
        return [{ id: latestId }]
      }
      return [conversationRow]
    }
    c.returning = async () => {
      updates.push({ table: state.table, values: state.values })
      if (!messageRow) return []
      return [{ ...messageRow, ...state.values }]
    }
    c.delete = () => c
    return c
  }

  return {
    db: {
      select: () => chain('select'),
      update: (t: { __name?: string }) => chain('update', t?.__name ?? 'unknown'),
      delete: () => chain('delete', 'conversation_message_mentions'),
      transaction: async (fn: (tx: Record<string, unknown>) => Promise<unknown>) =>
        fn({
          select: () => chain('select'),
          update: (t: { __name?: string }) => chain('update', t?.__name ?? 'unknown'),
          delete: () => chain('delete', 'conversation_message_mentions'),
        }),
    },
    eq: vi.fn(),
    and: vi.fn((...args: unknown[]) => args),
    isNull: vi.fn(),
    desc: vi.fn(),
    notInArray: vi.fn(),
    conversations: { __name: 'conversations', id: 'id' },
    conversationMessages: { __name: 'conversation_messages', id: 'id' },
    conversationMessageMentions: { __name: 'conversation_message_mentions', id: 'id' },
  }
})

import { editConversationMessage } from '../conversation.edit'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

const agentActor: Actor = {
  principalId: 'principal_agent' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}

const otherActor: Actor = {
  principalId: 'principal_other' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}

function message(over: Record<string, unknown> = {}) {
  return {
    id: 'conversation_msg_1',
    conversationId: 'conversation_1',
    ticketId: null,
    senderType: 'agent',
    principalId: 'principal_agent',
    isInternal: false,
    content: 'Hello',
    contentJson: null,
    attachments: null,
    metadata: null,
    deletedAt: null,
    editedAt: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    ...over,
  }
}

function agentWith(...keys: PermissionKey[]): Actor {
  return {
    ...agentActor,
    role: 'member',
    permissions: new Set([PERMISSIONS.CONVERSATION_VIEW, ...keys]),
  }
}

beforeEach(() => {
  pairTicketId = null
  messageRow = null
  latestId = 'conversation_msg_1'
  updates.length = 0
  vi.clearAllMocks()
})

describe('editConversationMessage', () => {
  it("refuses a teammate editing someone else's message", async () => {
    messageRow = message()
    await expect(
      editConversationMessage(
        'conversation_msg_1' as ConversationMessageId,
        'Nope',
        null,
        otherActor
      )
    ).rejects.toThrow(ForbiddenError)
    expect(publishAgentConversationEvent).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it('refuses a system message', async () => {
    messageRow = message({ senderType: 'system', principalId: null })
    await expect(
      editConversationMessage(
        'conversation_msg_1' as ConversationMessageId,
        'Nope',
        null,
        agentActor
      )
    ).rejects.toThrow(ForbiddenError)
  })

  it('publishes a public edit to the visitor and stamps editedAt', async () => {
    messageRow = message()
    const dto = await editConversationMessage(
      'conversation_msg_1' as ConversationMessageId,
      'Hello there',
      null,
      agentActor
    )
    expect(dto.content).toBe('Hello there')
    expect(updates[0]?.values.editedAt).toBeInstanceOf(Date)
    expect(updates[0]?.values.content).toBe('Hello there')
    expect(publishAgentConversationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'message_updated' })
    )
    expect(publishConversationOnlyEvent).toHaveBeenCalledWith(
      'conversation_1',
      expect.objectContaining({ kind: 'message_edited' })
    )
    expect(emitMessageUpdated).toHaveBeenCalledTimes(1)
  })

  it('keeps an internal-note edit off the visitor channel', async () => {
    messageRow = message({ isInternal: true })
    await editConversationMessage(
      'conversation_msg_1' as ConversationMessageId,
      'Note, fixed',
      null,
      agentActor
    )
    expect(publishAgentConversationEvent).toHaveBeenCalledTimes(1)
    expect(publishConversationOnlyEvent).not.toHaveBeenCalled()
    expect(emitMessageUpdated).not.toHaveBeenCalled()
  })

  it('refuses an edit while the message is still sending', async () => {
    messageRow = message({
      metadata: { channelDelivery: { status: 'pending', channel: 'github' } },
    })
    await expect(
      editConversationMessage(
        'conversation_msg_1' as ConversationMessageId,
        'Hello there',
        null,
        agentActor
      )
    ).rejects.toThrow(ValidationError)
    expect(updates).toHaveLength(0)
  })

  it('does not mark a message edited when the text is unchanged', async () => {
    messageRow = message()
    await editConversationMessage(
      'conversation_msg_1' as ConversationMessageId,
      'Hello',
      null,
      agentActor
    )
    expect(updates).toHaveLength(0)
    expect(publishAgentConversationEvent).not.toHaveBeenCalled()
  })

  it('checks the permission for the kind of message being edited', async () => {
    messageRow = message({ isInternal: true })
    await expect(
      editConversationMessage(
        'conversation_msg_1' as ConversationMessageId,
        'Note, fixed',
        null,
        agentWith(PERMISSIONS.CONVERSATION_REPLY)
      )
    ).rejects.toThrow(ForbiddenError)
    expect(updates).toHaveLength(0)

    messageRow = message({ conversationId: null, ticketId: 'ticket_1' })
    await expect(
      editConversationMessage(
        'conversation_msg_1' as ConversationMessageId,
        'Hello there',
        null,
        agentWith(PERMISSIONS.CONVERSATION_REPLY)
      )
    ).rejects.toThrow(ForbiddenError)
    const dto = await editConversationMessage(
      'conversation_msg_1' as ConversationMessageId,
      'Hello there',
      null,
      agentWith(PERMISSIONS.TICKET_REPLY)
    )
    expect(dto.content).toBe('Hello there')
  })

  it('pushes a ticket-parented edit to the ticket thread', async () => {
    messageRow = message({ conversationId: null, ticketId: 'ticket_1' })
    await editConversationMessage(
      'conversation_msg_1' as ConversationMessageId,
      'Hello there',
      null,
      agentActor
    )
    expect(publishTicketEvent).toHaveBeenCalledWith(
      'ticket_1',
      expect.objectContaining({
        kind: 'ticket_message_updated',
        ticketId: 'ticket_1',
        message: expect.objectContaining({ id: 'conversation_msg_1', content: 'Hello there' }),
      })
    )
    expect(publishAgentConversationEvent).not.toHaveBeenCalled()
    expect(publishConversationOnlyEvent).not.toHaveBeenCalled()
  })

  it('pushes a paired conversation edit to its customer ticket thread too', async () => {
    pairTicketId = 'ticket_pair'
    messageRow = message()
    await editConversationMessage(
      'conversation_msg_1' as ConversationMessageId,
      'Hello there',
      null,
      agentActor
    )
    expect(publishTicketEvent).toHaveBeenCalledWith(
      'ticket_pair',
      expect.objectContaining({ kind: 'ticket_message_updated', ticketId: 'ticket_pair' })
    )
    expect(publishAgentConversationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'message_updated' })
    )
  })

  it('does not push to a ticket channel for an unpaired conversation', async () => {
    messageRow = message()
    await editConversationMessage(
      'conversation_msg_1' as ConversationMessageId,
      'Hello there',
      null,
      agentActor
    )
    expect(publishTicketEvent).not.toHaveBeenCalled()
  })
})
