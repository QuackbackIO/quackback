/**
 * Tests for the conversation export query (§I3): full message content +
 * linked ticket references, with visitor email resolved through realEmail
 * so a synthetic anonymous address never leaks into the export.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  findManyConversations: vi.fn(),
  selectResults: [] as unknown[][],
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      conversations: {
        findMany: hoisted.findManyConversations,
      },
    },
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve(hoisted.selectResults.shift() ?? []),
        }),
        where: () => Promise.resolve(hoisted.selectResults.shift() ?? []),
      }),
    }),
  },
  conversations: { createdAt: 'conversations.created_at' },
  conversationMessages: { deletedAt: 'conversation_messages.deleted_at' },
  ticketConversations: { conversationId: 'ticket_conversations.conversation_id' },
  principal: { id: 'principal.id', userId: 'principal.user_id' },
  user: { email: 'user.email' },
  eq: (...args: unknown[]) => ({ eq: args }),
  isNull: (...args: unknown[]) => ({ isNull: args }),
  asc: (...args: unknown[]) => ({ asc: args }),
  desc: (...args: unknown[]) => ({ desc: args }),
  inArray: (...args: unknown[]) => ({ inArray: args }),
}))

import { listConversationsForExport } from '../conversation.export'

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.selectResults = []
})

describe('listConversationsForExport', () => {
  it('returns an empty array when there are no conversations', async () => {
    hoisted.findManyConversations.mockResolvedValue([])
    const result = await listConversationsForExport()
    expect(result).toEqual([])
  })

  it('attaches full message content, resolved visitor email, and linked tickets', async () => {
    hoisted.findManyConversations.mockResolvedValue([
      {
        id: 'conversation_1',
        status: 'open',
        channel: 'widget',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        visitorPrincipalId: 'principal_1',
        messages: [
          {
            id: 'conversation_msg_1',
            senderType: 'visitor',
            content: 'Hello, I need help',
            isInternal: false,
            createdAt: new Date('2026-01-01T00:01:00Z'),
          },
        ],
      },
    ])
    // First select() call resolves visitor emails, second resolves ticket links.
    hoisted.selectResults = [
      [{ principalId: 'principal_1', email: 'visitor@example.com' }],
      [{ conversationId: 'conversation_1', ticketId: 'ticket_1', ticketType: 'customer' }],
    ]

    const result = await listConversationsForExport()

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'conversation_1',
      status: 'open',
      channel: 'widget',
      visitorEmail: 'visitor@example.com',
      tickets: [{ id: 'ticket_1', type: 'customer' }],
    })
    expect(result[0].messages).toEqual([
      {
        id: 'conversation_msg_1',
        senderType: 'visitor',
        content: 'Hello, I need help',
        isInternal: false,
        createdAt: '2026-01-01T00:01:00.000Z',
      },
    ])
  })

  it('never surfaces a synthetic anonymous email as the visitor email', async () => {
    hoisted.findManyConversations.mockResolvedValue([
      {
        id: 'conversation_2',
        status: 'open',
        channel: 'widget',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        visitorPrincipalId: 'principal_2',
        messages: [],
      },
    ])
    hoisted.selectResults = [
      [{ principalId: 'principal_2', email: 'temp-principal_2@anon.quackback.io' }],
      [],
    ]

    const result = await listConversationsForExport()

    expect(result[0].visitorEmail).toBeNull()
    expect(result[0].tickets).toEqual([])
  })
})
