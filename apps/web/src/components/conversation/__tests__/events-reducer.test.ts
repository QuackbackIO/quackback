/**
 * The events reducer is the one piece of NEW logic in the thread extraction:
 * pure functions mapping conversation stream events (and local mutations) onto
 * the thread caches. These tests pin the exact semantics the surfaces shipped
 * with: dedupe by id, viewer-relative merge on message_updated, read-watermark
 * routing by side, and the inbox-list refresh predicate.
 */
import { describe, it, expect } from 'vitest'
import type { ConversationId, ConversationMessageId } from '@quackback/ids'
import type {
  AgentConversationMessageDTO,
  ConversationDTO,
  ConversationMessageDTO,
  ConversationStreamEvent,
} from '@/lib/shared/conversation/types'
import {
  agentEventChangesInboxList,
  appendSentAgentMessage,
  appendSentVisitorMessage,
  applyAgentThreadEvent,
  applyVisitorThreadEvent,
  asAgentMessage,
  mergeAgentMessage,
  prependOlderAgentMessages,
  prependOlderVisitorMessages,
  removeAgentThreadMessage,
  toggleReactionLocal,
  updateAgentThreadMessage,
  type AgentThreadCache,
  type VisitorThreadCache,
} from '../events-reducer'

const CONV_ID = 'conversation_a' as ConversationId
const OTHER_CONV_ID = 'conversation_b' as ConversationId

function baseMessage(id: string, overrides: Partial<ConversationMessageDTO> = {}) {
  return {
    id: id as ConversationMessageId,
    conversationId: CONV_ID,
    senderType: 'visitor',
    content: `msg ${id}`,
    createdAt: '2026-07-01T10:00:00.000Z',
    author: null,
    attachments: [],
    isInternal: false,
    contentJson: null,
    viaEmail: false,
    systemEvent: null,
    ...overrides,
  } satisfies ConversationMessageDTO
}

function agentMessage(id: string, overrides: Partial<AgentConversationMessageDTO> = {}) {
  return {
    ...baseMessage(id),
    reactions: [],
    flaggedAt: null,
    postSuggestion: null,
    ...overrides,
  } satisfies AgentConversationMessageDTO
}

function conversation(overrides: Partial<ConversationDTO> = {}): ConversationDTO {
  return {
    id: CONV_ID,
    status: 'open',
    priority: 'none',
    channel: 'messenger',
    subject: null,
    lastMessagePreview: null,
    lastMessageAt: '2026-07-01T10:00:00.000Z',
    createdAt: '2026-07-01T09:00:00.000Z',
    visitor: { principalId: 'principal_v' as never, displayName: 'Visitor', avatarUrl: null },
    assignedAgent: null,
    unreadCount: 0,
    visitorLastReadAt: null,
    agentLastReadAt: null,
    csatRating: null,
    visitorEmail: null,
    resolvedAt: null,
    endReason: null,
    endNote: null,
    tags: [],
    ...overrides,
  }
}

function agentCache(overrides: Partial<AgentThreadCache> = {}): AgentThreadCache {
  return {
    conversation: conversation(),
    messages: [agentMessage('m1')],
    hasMore: false,
    ...overrides,
  }
}

function visitorCache(overrides: Partial<VisitorThreadCache> = {}): VisitorThreadCache {
  return {
    messages: [baseMessage('m1')],
    hasMore: false,
    agentLastReadAt: null,
    status: 'open',
    csatRating: null,
    ...overrides,
  }
}

describe('asAgentMessage', () => {
  it('defaults the agent-only fields on a base DTO', () => {
    expect(asAgentMessage(baseMessage('m1'))).toEqual(
      expect.objectContaining({ reactions: [], flaggedAt: null, postSuggestion: null })
    )
  })

  it('preserves agent-only fields a message already carries', () => {
    const m = agentMessage('m1', {
      reactions: [{ emoji: '👍', count: 2, hasReacted: true }],
      flaggedAt: '2026-07-01T10:05:00.000Z',
      postSuggestion: { boardId: 'b', title: 't', content: 'c' },
    })
    expect(asAgentMessage(m)).toEqual(m)
  })
})

describe('mergeAgentMessage', () => {
  it('adopts incoming counts but keeps OUR hasReacted and OUR flag', () => {
    const local = agentMessage('m1', {
      reactions: [{ emoji: '👍', count: 1, hasReacted: true }],
      flaggedAt: '2026-07-01T10:05:00.000Z',
    })
    const incoming = agentMessage('m1', {
      reactions: [
        // The broadcast carries the ACTOR's view: their hasReacted, not ours.
        { emoji: '👍', count: 2, hasReacted: false, reactors: ['A', 'B'] },
        { emoji: '🎉', count: 1, hasReacted: true, reactors: ['A'] },
      ],
      flaggedAt: null,
    })
    const merged = mergeAgentMessage(local, incoming)
    expect(merged.reactions).toEqual([
      { emoji: '👍', count: 2, hasReacted: true, reactors: ['A', 'B'] },
      { emoji: '🎉', count: 1, hasReacted: false, reactors: ['A'] },
    ])
    expect(merged.flaggedAt).toBe(local.flaggedAt)
  })
})

describe('toggleReactionLocal', () => {
  it('adds a new reaction bucket attributed to the caller', () => {
    const m = toggleReactionLocal(agentMessage('m1'), '👍', false, 'Me')
    expect(m.reactions).toEqual([{ emoji: '👍', count: 1, hasReacted: true, reactors: ['Me'] }])
  })

  it('increments an existing bucket the caller had not reacted to', () => {
    const m = toggleReactionLocal(
      agentMessage('m1', {
        reactions: [{ emoji: '👍', count: 1, hasReacted: false, reactors: ['A'] }],
      }),
      '👍',
      false,
      'Me'
    )
    expect(m.reactions).toEqual([
      { emoji: '👍', count: 2, hasReacted: true, reactors: ['A', 'Me'] },
    ])
  })

  it('decrements on un-react and drops an emptied bucket', () => {
    const m = toggleReactionLocal(
      agentMessage('m1', {
        reactions: [{ emoji: '👍', count: 1, hasReacted: true, reactors: ['Me'] }],
      }),
      '👍',
      true,
      'Me'
    )
    expect(m.reactions).toEqual([])
  })

  it('keeps a still-populated bucket after un-react', () => {
    const m = toggleReactionLocal(
      agentMessage('m1', {
        reactions: [{ emoji: '👍', count: 2, hasReacted: true, reactors: ['A', 'Me'] }],
      }),
      '👍',
      true,
      'Me'
    )
    expect(m.reactions).toEqual([{ emoji: '👍', count: 1, hasReacted: false, reactors: ['A'] }])
  })
})

describe('agentEventChangesInboxList', () => {
  const msg = baseMessage('m9')
  it.each([
    [{ kind: 'message', conversationId: CONV_ID, message: msg }, true],
    [{ kind: 'conversation', conversation: conversation() }, true],
    [{ kind: 'message_deleted', conversationId: CONV_ID, messageId: msg.id }, true],
    [{ kind: 'read', conversationId: CONV_ID, side: 'agent', at: 'x' }, true],
    [{ kind: 'read', conversationId: CONV_ID, side: 'visitor', at: 'x' }, false],
    [{ kind: 'typing', conversationId: CONV_ID, side: 'visitor', at: 'x' }, false],
    [{ kind: 'message_updated', conversationId: CONV_ID, message: agentMessage('m9') }, false],
  ] as Array<[ConversationStreamEvent, boolean]>)('%j -> %s', (evt, expected) => {
    expect(agentEventChangesInboxList(evt)).toBe(expected)
  })
})

describe('applyAgentThreadEvent', () => {
  it('returns prev untouched when the cache is empty', () => {
    const evt: ConversationStreamEvent = {
      kind: 'message',
      conversationId: CONV_ID,
      message: baseMessage('m2'),
    }
    expect(applyAgentThreadEvent(undefined, evt, CONV_ID)).toBeUndefined()
  })

  it('appends a coerced agent message, deduped by id', () => {
    const prev = agentCache()
    const evt: ConversationStreamEvent = {
      kind: 'message',
      conversationId: CONV_ID,
      message: baseMessage('m2'),
    }
    const next = applyAgentThreadEvent(prev, evt, CONV_ID)!
    expect(next.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(next.messages[1]).toEqual(expect.objectContaining({ reactions: [], flaggedAt: null }))
    // Same event again: no duplicate, prev returned as-is.
    expect(applyAgentThreadEvent(next, evt, CONV_ID)).toBe(next)
  })

  it('ignores a message for another conversation', () => {
    const prev = agentCache()
    const evt: ConversationStreamEvent = {
      kind: 'message',
      conversationId: OTHER_CONV_ID,
      message: baseMessage('m2'),
    }
    expect(applyAgentThreadEvent(prev, evt, CONV_ID)).toBe(prev)
  })

  it('routes read watermarks by side', () => {
    const prev = agentCache()
    const visitorRead = applyAgentThreadEvent(
      prev,
      { kind: 'read', conversationId: CONV_ID, side: 'visitor', at: 't1' },
      CONV_ID
    )!
    expect(visitorRead.conversation.visitorLastReadAt).toBe('t1')
    const agentRead = applyAgentThreadEvent(
      prev,
      { kind: 'read', conversationId: CONV_ID, side: 'agent', at: 't2' },
      CONV_ID
    )!
    expect(agentRead.conversation.agentLastReadAt).toBe('t2')
  })

  it('returns prev untouched on a read that does not move the watermark', () => {
    const prev = agentCache({ conversation: conversation({ visitorLastReadAt: 't1' }) })
    expect(
      applyAgentThreadEvent(
        prev,
        { kind: 'read', conversationId: CONV_ID, side: 'visitor', at: 't1' },
        CONV_ID
      )
    ).toBe(prev)
  })

  it('patches message_updated in place with the viewer-relative merge', () => {
    const prev = agentCache({
      messages: [
        agentMessage('m1', {
          reactions: [{ emoji: '👍', count: 1, hasReacted: true }],
          flaggedAt: 'flag-t',
        }),
      ],
    })
    const evt: ConversationStreamEvent = {
      kind: 'message_updated',
      conversationId: CONV_ID,
      message: agentMessage('m1', {
        reactions: [{ emoji: '👍', count: 2, hasReacted: false }],
        flaggedAt: null,
      }),
    }
    const next = applyAgentThreadEvent(prev, evt, CONV_ID)!
    expect(next.messages[0].reactions).toEqual([{ emoji: '👍', count: 2, hasReacted: true }])
    expect(next.messages[0].flaggedAt).toBe('flag-t')
  })

  it('returns prev untouched on message_updated for a message outside the loaded page', () => {
    const prev = agentCache()
    const evt: ConversationStreamEvent = {
      kind: 'message_updated',
      conversationId: CONV_ID,
      message: agentMessage('m_unloaded'),
    }
    expect(applyAgentThreadEvent(prev, evt, CONV_ID)).toBe(prev)
  })

  it('removes a deleted message', () => {
    const prev = agentCache({ messages: [agentMessage('m1'), agentMessage('m2')] })
    const next = applyAgentThreadEvent(
      prev,
      {
        kind: 'message_deleted',
        conversationId: CONV_ID,
        messageId: 'm1' as ConversationMessageId,
      },
      CONV_ID
    )!
    expect(next.messages.map((m) => m.id)).toEqual(['m2'])
  })

  it('adopts a conversation event wholesale, only for this conversation', () => {
    const prev = agentCache()
    const updated = conversation({ status: 'closed' })
    const next = applyAgentThreadEvent(
      prev,
      { kind: 'conversation', conversation: updated },
      CONV_ID
    )!
    expect(next.conversation).toBe(updated)
    const foreign = conversation({ id: OTHER_CONV_ID, status: 'closed' })
    expect(
      applyAgentThreadEvent(prev, { kind: 'conversation', conversation: foreign }, CONV_ID)
    ).toBe(prev)
  })

  it('ignores typing events', () => {
    const prev = agentCache()
    expect(
      applyAgentThreadEvent(
        prev,
        { kind: 'typing', conversationId: CONV_ID, side: 'visitor', at: 't' },
        CONV_ID
      )
    ).toBe(prev)
  })
})

describe('applyVisitorThreadEvent', () => {
  it('returns prev untouched when the cache is empty', () => {
    const evt: ConversationStreamEvent = {
      kind: 'message',
      conversationId: CONV_ID,
      message: baseMessage('m2'),
    }
    expect(applyVisitorThreadEvent(undefined, evt, CONV_ID)).toBeUndefined()
  })

  it('appends a message, deduped by id (per-conversation stream: no id filter)', () => {
    const prev = visitorCache()
    const evt: ConversationStreamEvent = {
      kind: 'message',
      conversationId: CONV_ID,
      message: baseMessage('m2', { senderType: 'agent' }),
    }
    const next = applyVisitorThreadEvent(prev, evt, CONV_ID)!
    expect(next.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(applyVisitorThreadEvent(next, evt, CONV_ID)).toBe(next)
  })

  it('advances the agent read watermark on agent reads only', () => {
    const prev = visitorCache()
    const next = applyVisitorThreadEvent(
      prev,
      { kind: 'read', conversationId: CONV_ID, side: 'agent', at: 't1' },
      CONV_ID
    )!
    expect(next.agentLastReadAt).toBe('t1')
    expect(
      applyVisitorThreadEvent(
        prev,
        { kind: 'read', conversationId: CONV_ID, side: 'visitor', at: 't2' },
        CONV_ID
      )
    ).toBe(prev)
  })

  it('returns prev untouched on a read that does not move the watermark', () => {
    const prev = visitorCache({ agentLastReadAt: 't1' })
    expect(
      applyVisitorThreadEvent(
        prev,
        { kind: 'read', conversationId: CONV_ID, side: 'agent', at: 't1' },
        CONV_ID
      )
    ).toBe(prev)
  })

  it('removes a deleted message', () => {
    const prev = visitorCache({ messages: [baseMessage('m1'), baseMessage('m2')] })
    const next = applyVisitorThreadEvent(
      prev,
      {
        kind: 'message_deleted',
        conversationId: CONV_ID,
        messageId: 'm2' as ConversationMessageId,
      },
      CONV_ID
    )!
    expect(next.messages.map((m) => m.id)).toEqual(['m1'])
  })

  it('takes status + csat from a conversation event for this thread only', () => {
    const prev = visitorCache()
    const next = applyVisitorThreadEvent(
      prev,
      { kind: 'conversation', conversation: conversation({ status: 'closed', csatRating: 4 }) },
      CONV_ID
    )!
    expect(next.status).toBe('closed')
    expect(next.csatRating).toBe(4)
    expect(
      applyVisitorThreadEvent(
        prev,
        {
          kind: 'conversation',
          conversation: conversation({ id: OTHER_CONV_ID, status: 'closed' }),
        },
        CONV_ID
      )
    ).toBe(prev)
  })

  it('ignores typing and agent-only message_updated events', () => {
    const prev = visitorCache()
    expect(
      applyVisitorThreadEvent(
        prev,
        { kind: 'typing', conversationId: CONV_ID, side: 'agent', at: 't' },
        CONV_ID
      )
    ).toBe(prev)
    expect(
      applyVisitorThreadEvent(
        prev,
        { kind: 'message_updated', conversationId: CONV_ID, message: agentMessage('m1') },
        CONV_ID
      )
    ).toBe(prev)
  })
})

describe('appendSentAgentMessage', () => {
  it('appends our sent message and adopts the returned conversation', () => {
    const prev = agentCache()
    const conv = conversation({ status: 'pending' })
    const next = appendSentAgentMessage(prev, {
      conversation: conv,
      message: baseMessage('m2', { senderType: 'agent' }),
    })!
    expect(next.conversation).toBe(conv)
    expect(next.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(next.messages[1]).toEqual(expect.objectContaining({ reactions: [], flaggedAt: null }))
  })

  it('is a no-op when the message already landed (SSE beat the response)', () => {
    const prev = agentCache()
    expect(
      appendSentAgentMessage(prev, { conversation: conversation(), message: baseMessage('m1') })
    ).toBe(prev)
    expect(
      appendSentAgentMessage(undefined, {
        conversation: conversation(),
        message: baseMessage('m1'),
      })
    ).toBeUndefined()
  })
})

describe('appendSentVisitorMessage', () => {
  it('initializes the cache on the first send of a new conversation', () => {
    const next = appendSentVisitorMessage(undefined, {
      conversation: conversation({ status: 'open' }),
      message: baseMessage('m1'),
    })
    expect(next).toEqual({
      messages: [expect.objectContaining({ id: 'm1' })],
      hasMore: false,
      agentLastReadAt: null,
      status: 'open',
      csatRating: null,
    })
  })

  it('appends (deduped) and adopts the server status so a reopen clears closed hints', () => {
    const prev = visitorCache({ status: 'closed', csatRating: 5 })
    const next = appendSentVisitorMessage(prev, {
      conversation: conversation({ status: 'open' }),
      message: baseMessage('m2'),
    })
    expect(next.status).toBe('open')
    expect(next.csatRating).toBe(5)
    expect(next.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
    const deduped = appendSentVisitorMessage(next, {
      conversation: conversation({ status: 'open' }),
      message: baseMessage('m2'),
    })
    expect(deduped.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
  })
})

describe('older-page prepends', () => {
  it('prepends only unknown agent messages, coerced, and updates hasMore', () => {
    const prev = agentCache({ hasMore: true })
    const next = prependOlderAgentMessages(prev, {
      messages: [baseMessage('m0'), baseMessage('m1')],
      hasMore: false,
    })!
    expect(next.messages.map((m) => m.id)).toEqual(['m0', 'm1'])
    expect(next.messages[0]).toEqual(expect.objectContaining({ reactions: [], flaggedAt: null }))
    expect(next.hasMore).toBe(false)
    expect(prependOlderAgentMessages(undefined, { messages: [], hasMore: false })).toBeUndefined()
  })

  it('prepends only unknown visitor messages and updates hasMore', () => {
    const prev = visitorCache({ hasMore: true })
    const next = prependOlderVisitorMessages(prev, {
      messages: [baseMessage('m0'), baseMessage('m1')],
      hasMore: true,
    })!
    expect(next.messages.map((m) => m.id)).toEqual(['m0', 'm1'])
    expect(next.hasMore).toBe(true)
    expect(prependOlderVisitorMessages(undefined, { messages: [], hasMore: false })).toBeUndefined()
  })
})

describe('agent thread message helpers', () => {
  it('updateAgentThreadMessage patches just the target message', () => {
    const prev = agentCache({ messages: [agentMessage('m1'), agentMessage('m2')] })
    const next = updateAgentThreadMessage(prev, 'm2' as ConversationMessageId, (m) => ({
      ...m,
      flaggedAt: 'now',
    }))!
    expect(next.messages[0].flaggedAt).toBeNull()
    expect(next.messages[1].flaggedAt).toBe('now')
    expect(
      updateAgentThreadMessage(undefined, 'm2' as ConversationMessageId, (m) => m)
    ).toBeUndefined()
  })

  it('removeAgentThreadMessage drops the target message', () => {
    const prev = agentCache({ messages: [agentMessage('m1'), agentMessage('m2')] })
    const next = removeAgentThreadMessage(prev, 'm1' as ConversationMessageId)!
    expect(next.messages.map((m) => m.id)).toEqual(['m2'])
    expect(removeAgentThreadMessage(undefined, 'm1' as ConversationMessageId)).toBeUndefined()
  })
})
