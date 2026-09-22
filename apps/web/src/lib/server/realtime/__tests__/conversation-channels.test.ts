/**
 * Channel routing for conversation events, with a focus on the security-critical
 * invariant that agent-only data (internal notes, captured visitor email)
 * never reaches the visitor's conversation channel.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationId, PrincipalId, TicketId } from '@quackback/ids'
import type { ConversationDTO } from '@/lib/shared/conversation/types'

const publish = vi.fn()
vi.mock('../pubsub', () => ({ publish: (...args: unknown[]) => publish(...args) }))
const loadAuthors = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/domains/principals/principal-display', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/principals/principal-display')>()),
  loadAuthors,
}))

import {
  conversationChannel,
  CONVERSATION_INBOX_CHANNEL,
  publishConversationEvent,
  publishConversationMessage,
  publishAgentConversationEvent,
  publishConversationUpdate,
  publishTyping,
  parseConversationFrame,
  isOwnTyping,
  ticketChannel,
  publishTicketEvent,
} from '../conversation-channels'

const conversationId = 'conversation_1' as ConversationId

const agentDto = {
  id: conversationId,
  status: 'open',
  priority: 'none',
  channel: 'messenger',
  subject: null,
  lastMessagePreview: 'hi',
  lastMessageAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  visitor: { principalId: 'principal_v', displayName: null, avatarUrl: null },
  assignedAgent: null,
  unreadCount: 0,
  visitorLastReadAt: null,
  agentLastReadAt: null,
  csatRating: null,
  visitorEmail: 'visitor@example.com',
  resolvedAt: null,
  endReason: null,
  endNote: 'internal end note',
  snoozedUntil: '2026-01-02T00:00:00.000Z',
  assignedTeamId: 'team_1',
  customAttributes: { internalNote: 'Account review needed' },
  translation: { enabled: true, detectedCustomerLanguage: 'fr', suggestionDismissed: false },
  spamReason: 'manual',
  tags: [{ id: 'conversation_tag_1', name: 'VIP', color: '#ff0000' }],
  sla: {
    policyId: 'sla_policy_1',
    policyName: 'Gold',
    appliedAt: '2026-01-01T00:00:00.000Z',
    firstResponseDueAt: '2026-01-01T04:00:00.000Z',
    firstResponseAt: null,
    nextResponseDueAt: null,
    timeToCloseDueAt: null,
    resolvedAt: null,
    pauseOnSnooze: true,
  },
} as unknown as ConversationDTO

beforeEach(() => {
  vi.clearAllMocks()
  loadAuthors.mockResolvedValue(new Map())
})

describe('publishConversationEvent', () => {
  it('fans out to both the conversation channel and the inbox', () => {
    publishConversationEvent(conversationId, {
      kind: 'read',
      conversationId,
      side: 'agent',
      at: 'x',
    })
    const channels = publish.mock.calls.map((c) => c[0])
    expect(channels).toContain(conversationChannel(conversationId))
    expect(channels).toContain(CONVERSATION_INBOX_CHANNEL)
  })
})

describe('publishConversationMessage', () => {
  it('keeps the public name on the visitor channel and the account name on the inbox', () => {
    const visitor = {
      id: 'conversation_msg_1',
      author: { principalId: 'principal_a', displayName: 'Quiet Otter', avatarUrl: null },
    }
    const agent = {
      ...visitor,
      author: { principalId: 'principal_a', displayName: 'Ada Lovelace', avatarUrl: null },
    }
    publishConversationMessage(conversationId, {
      visitor: visitor as never,
      agent: agent as never,
    })
    const visitorEvent = publish.mock.calls.find(
      (c) => c[0] === conversationChannel(conversationId)
    )
    const inboxEvent = publish.mock.calls.find((c) => c[0] === CONVERSATION_INBOX_CHANNEL)
    expect(visitorEvent?.[1].message.author.displayName).toBe('Quiet Otter')
    expect(inboxEvent?.[1].message.author.displayName).toBe('Ada Lovelace')
  })
})

describe('publishAgentConversationEvent', () => {
  it('publishes to the inbox channel ONLY (never the visitor conversation channel)', () => {
    publishAgentConversationEvent({ kind: 'conversation', conversation: agentDto })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0][0]).toBe(CONVERSATION_INBOX_CHANNEL)
  })
})

describe('publishConversationUpdate', () => {
  it('sends the full DTO to the inbox and strips ALL agent-only fields for the visitor', async () => {
    await publishConversationUpdate(conversationId, agentDto)

    const inbox = publish.mock.calls.find((c) => c[0] === CONVERSATION_INBOX_CHANNEL)
    const visitor = publish.mock.calls.find((c) => c[0] === conversationChannel(conversationId))
    expect(inbox).toBeDefined()
    expect(visitor).toBeDefined()

    // Agents keep agent-only fields...
    const inboxConv = (inbox![1] as { conversation: ConversationDTO }).conversation
    expect(inboxConv.visitorEmail).toBe('visitor@example.com')
    expect(inboxConv.tags).toHaveLength(1)
    expect(inboxConv.endNote).toBe('internal end note')
    expect(inboxConv.sla?.policyName).toBe('Gold')
    expect(inboxConv.customAttributes).toEqual(agentDto.customAttributes)
    expect(inboxConv.translation).toEqual(agentDto.translation)

    // ...the visitor copy must have every agent-only field stripped.
    const visitorConv = (visitor![1] as { conversation: ConversationDTO }).conversation
    expect(visitorConv.visitorEmail).toBeNull()
    expect(visitorConv.tags).toEqual([])
    expect(visitorConv.endNote).toBeNull()
    expect(visitorConv.sla).toBeNull()
    expect(visitorConv.snoozedUntil).toBeNull()
    expect(visitorConv.assignedTeamId).toBeNull()
    expect(visitorConv.customAttributes).toEqual({})
    expect(visitorConv.translation).toBeNull()
    expect(visitorConv.spamReason).toBeNull()
  })

  it('resolves both visitor-facing names from public profiles without changing the inbox DTO', async () => {
    const visitor = { ...agentDto.visitor, displayName: 'Quiet Otter' }
    const assignedAgent = {
      principalId: 'principal_a' as PrincipalId,
      displayName: 'Support Ada',
      avatarUrl: null,
    }
    loadAuthors.mockResolvedValue(
      new Map([
        [visitor.principalId, visitor],
        [assignedAgent.principalId, assignedAgent],
      ])
    )
    const dto = {
      ...agentDto,
      visitor: { ...visitor, displayName: 'Private Customer Name' },
      assignedAgent: { ...assignedAgent, displayName: 'Private Agent Name' },
    }

    await publishConversationUpdate(conversationId, dto)

    expect(loadAuthors).toHaveBeenCalledExactlyOnceWith([
      visitor.principalId,
      assignedAgent.principalId,
    ])
    expect(publish).toHaveBeenCalledWith(conversationChannel(conversationId), {
      kind: 'conversation',
      conversation: expect.objectContaining({ visitor, assignedAgent }),
    })
    expect(publish).toHaveBeenCalledWith(CONVERSATION_INBOX_CHANNEL, {
      kind: 'conversation',
      conversation: dto,
    })
    expect(dto.assignedAgent.displayName).toBe('Private Agent Name')
  })

  it('does not fall back to account names if a public profile is missing', async () => {
    const dto = {
      ...agentDto,
      visitor: { ...agentDto.visitor, displayName: 'Private Customer Name' },
      assignedAgent: {
        principalId: 'principal_missing' as PrincipalId,
        displayName: 'Private Agent Name',
        avatarUrl: null,
      },
    }
    await publishConversationUpdate(conversationId, dto)

    const event = publish.mock.calls.find((c) => c[0] === conversationChannel(conversationId))
    expect(event?.[1].conversation.visitor.displayName).toBeNull()
    expect(event?.[1].conversation.assignedAgent.displayName).toBeNull()
  })
})

describe('publishTyping', () => {
  it('agent side: sends the typist id only to the inbox, never to the visitor channel', () => {
    publishTyping(conversationId, 'agent', '2026-01-01T00:00:00.000Z', 'principal_agent' as never)

    const inbox = publish.mock.calls.find((c) => c[0] === CONVERSATION_INBOX_CHANNEL)
    const visitor = publish.mock.calls.find((c) => c[0] === conversationChannel(conversationId))

    // Inbox carries the typist id (collision detection + self-suppression)...
    expect(inbox![1]).toMatchObject({
      kind: 'typing',
      side: 'agent',
      typistPrincipalId: 'principal_agent',
    })
    // ...the visitor only sees an anonymous "agent is typing" — no id leak.
    expect(visitor![1]).toMatchObject({ kind: 'typing', side: 'agent' })
    expect((visitor![1] as { typistPrincipalId?: string }).typistPrincipalId).toBeUndefined()
  })

  it('visitor side: carries the typist id on BOTH channels so every stream can drop the echo', () => {
    publishTyping(conversationId, 'visitor', '2026-01-01T00:00:00.000Z', 'principal_owner' as never)

    const inbox = publish.mock.calls.find((c) => c[0] === CONVERSATION_INBOX_CHANNEL)
    const visitor = publish.mock.calls.find((c) => c[0] === conversationChannel(conversationId))

    // Inbox: a team member typing in a conversation they OWN signals the
    // visitor side — without the id their own inbox stream would echo it back.
    expect(inbox![1]).toMatchObject({
      kind: 'typing',
      side: 'visitor',
      typistPrincipalId: 'principal_owner',
    })
    // Conversation channel: the id is the owner's own (no agent leak) and lets
    // the owner's streams drop their own echo server-side.
    expect(visitor![1]).toMatchObject({
      kind: 'typing',
      side: 'visitor',
      typistPrincipalId: 'principal_owner',
    })
  })
})

describe('ticketChannel', () => {
  it('namespaces a ticket id', () => {
    expect(ticketChannel('ticket_1' as TicketId)).toBe('ticket:ticket_1')
  })
})

describe('publishTicketEvent', () => {
  it('fans out the same event to the ticket channel AND the shared inbox channel', () => {
    const ticketId = 'ticket_1' as TicketId
    const event = { kind: 'ticket_updated', ticket: { id: ticketId } } as never
    publishTicketEvent(ticketId, event)

    expect(publish).toHaveBeenCalledTimes(2)
    const calls = publish.mock.calls.map((c) => [c[0], c[1]])
    expect(calls).toContainEqual([ticketChannel(ticketId), event])
    expect(calls).toContainEqual([CONVERSATION_INBOX_CHANNEL, event])
  })
})

describe('isOwnTyping', () => {
  const frame = (e: unknown) => parseConversationFrame(JSON.stringify(e))

  it('suppresses a typing frame from the same principal, on either side', () => {
    expect(
      isOwnTyping(frame({ kind: 'typing', side: 'agent', typistPrincipalId: 'p1' }), 'p1')
    ).toBe(true)
    expect(
      isOwnTyping(frame({ kind: 'typing', side: 'visitor', typistPrincipalId: 'p1' }), 'p1')
    ).toBe(true)
  })

  it('does not suppress another typist, an anonymous frame, a non-typing event, or junk', () => {
    expect(
      isOwnTyping(frame({ kind: 'typing', side: 'agent', typistPrincipalId: 'p2' }), 'p1')
    ).toBe(false)
    expect(isOwnTyping(frame({ kind: 'typing', side: 'visitor' }), 'p1')).toBe(false)
    expect(isOwnTyping(frame({ kind: 'message', typistPrincipalId: 'p1' }), 'p1')).toBe(false)
    expect(isOwnTyping(parseConversationFrame('not json{'), 'p1')).toBe(false)
  })
})
