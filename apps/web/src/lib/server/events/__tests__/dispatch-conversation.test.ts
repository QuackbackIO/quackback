import { describe, it, expect, vi, beforeEach } from 'vitest'

const processEvent = vi.fn().mockResolvedValue(undefined)
vi.mock('../process', () => ({ processEvent: (...a: unknown[]) => processEvent(...a) }))

import {
  dispatchConversationCreated,
  dispatchConversationStatusChanged,
  dispatchConversationAssigned,
  dispatchMessageCreated,
  dispatchMessageNoteCreated,
  dispatchConversationCsatSubmitted,
  dispatchConversationCsatCommentAdded,
  dispatchAssistantHandedOff,
} from '../dispatch'
import type { EventConversationData, EventConversationRef, EventMessageData } from '../types'

const actor = { type: 'user' as const, principalId: 'principal_v', displayName: 'Sam' }
const convData: EventConversationData = {
  id: 'conversation_1',
  status: 'open',
  channel: 'messenger',
  priority: 'none',
  subject: 'Hi',
  visitorPrincipalId: 'principal_v',
  visitorEmail: null,
  assignedAgentPrincipalId: null,
  createdAt: '2026-06-05T00:00:00.000Z',
  lastMessageAt: '2026-06-05T00:00:00.000Z',
  resolvedAt: null,
}
const convRef: EventConversationRef = {
  id: 'conversation_1',
  status: 'open',
  channel: 'messenger',
  priority: 'none',
}
const msg: EventMessageData = {
  id: 'conversation_msg_1',
  conversationId: 'conversation_1',
  senderType: 'visitor',
  authorPrincipalId: 'principal_v',
  authorName: 'Sam',
  authorEmail: null,
  content: 'hello',
  createdAt: '2026-06-05T00:00:00.000Z',
}

beforeEach(() => processEvent.mockClear())

describe('conversation/message dispatch', () => {
  it('dispatchConversationCreated enqueues a well-formed event', async () => {
    await dispatchConversationCreated(actor, convData)
    expect(processEvent).toHaveBeenCalledTimes(1)
    const event = processEvent.mock.calls[0][0]
    expect(event.type).toBe('conversation.created')
    expect(event.data).toEqual({ conversation: convData })
    expect(event.actor).toEqual(actor)
    expect(typeof event.id).toBe('string')
    expect(typeof event.timestamp).toBe('string')
  })

  it('dispatchConversationStatusChanged carries previous + new', async () => {
    await dispatchConversationStatusChanged(actor, convRef, 'open', 'closed')
    const event = processEvent.mock.calls[0][0]
    expect(event.type).toBe('conversation.status_changed')
    expect(event.data).toEqual({
      conversation: convRef,
      previousStatus: 'open',
      newStatus: 'closed',
    })
  })

  it('dispatchConversationAssigned carries agent and team current + previous (WO-3 slice 2)', async () => {
    await dispatchConversationAssigned(actor, convRef, 'principal_agent', null, 'team_1', null)
    const event = processEvent.mock.calls[0][0]
    expect(event.type).toBe('conversation.assigned')
    expect(event.data).toEqual({
      conversation: convRef,
      assignedAgentPrincipalId: 'principal_agent',
      previousAgentPrincipalId: null,
      assignedTeamId: 'team_1',
      previousTeamId: null,
    })
  })

  it('dispatchMessageCreated and dispatchMessageNoteCreated use distinct types', async () => {
    await dispatchMessageCreated(actor, msg, convRef)
    await dispatchMessageNoteCreated(actor, { ...msg, senderType: 'agent' }, convRef)
    expect(processEvent.mock.calls[0][0].type).toBe('message.created')
    expect(processEvent.mock.calls[1][0].type).toBe('message.note_created')
  })

  it('dispatchConversationCsatSubmitted carries rating + comment', async () => {
    await dispatchConversationCsatSubmitted(actor, convRef, 5, 'great', '2026-06-05T01:00:00.000Z')
    const event = processEvent.mock.calls[0][0]
    expect(event.type).toBe('conversation.csat_submitted')
    expect(event.data).toEqual({
      conversation: convRef,
      rating: 5,
      comment: 'great',
      submittedAt: '2026-06-05T01:00:00.000Z',
    })
  })

  it('dispatchConversationCsatCommentAdded carries the rating + comment', async () => {
    await dispatchConversationCsatCommentAdded(
      actor,
      convRef,
      5,
      'great',
      '2026-06-05T01:00:00.000Z'
    )
    const event = processEvent.mock.calls[0][0]
    expect(event.type).toBe('conversation.csat_comment_added')
    expect(event.data).toEqual({
      conversation: convRef,
      rating: 5,
      comment: 'great',
      submittedAt: '2026-06-05T01:00:00.000Z',
    })
  })

  it('dispatchAssistantHandedOff carries the conversation id + reason', async () => {
    await dispatchAssistantHandedOff(actor, 'conversation_1', 'explicit_request')
    const event = processEvent.mock.calls[0][0]
    expect(event.type).toBe('assistant.handed_off')
    expect(event.data).toEqual({ conversationId: 'conversation_1', reason: 'explicit_request' })
    expect(event.actor).toEqual(actor)
  })
})
