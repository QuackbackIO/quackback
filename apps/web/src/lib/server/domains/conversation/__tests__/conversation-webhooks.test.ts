import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Conversation, ConversationMessage } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import type { ConversationAuthorInput } from '../conversation.types'

const dispatch = vi.hoisted(() => ({
  dispatchConversationCreated: vi.fn().mockResolvedValue(undefined),
  dispatchConversationStatusChanged: vi.fn().mockResolvedValue(undefined),
  dispatchConversationAssigned: vi.fn().mockResolvedValue(undefined),
  dispatchConversationPriorityChanged: vi.fn().mockResolvedValue(undefined),
  dispatchConversationCsatSubmitted: vi.fn().mockResolvedValue(undefined),
  dispatchConversationCsatCommentAdded: vi.fn().mockResolvedValue(undefined),
  dispatchMessageCreated: vi.fn().mockResolvedValue(undefined),
  dispatchMessageNoteCreated: vi.fn().mockResolvedValue(undefined),
  dispatchMessageDeleted: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/server/events/dispatch', () => dispatch)

import {
  emitConversationCreated,
  emitConversationStatusChanged,
  emitConversationAssigned,
  emitConversationPriorityChanged,
  emitMessageCreated,
  emitMessageNoteCreated,
  emitMessageDeleted,
  emitConversationCsatSubmitted,
  emitConversationCsatCommentAdded,
} from '../conversation.webhooks'

const now = new Date('2026-06-05T00:00:00.000Z')
const baseConversation = {
  id: 'conversation_1',
  visitorPrincipalId: 'principal_v',
  assignedAgentPrincipalId: null,
  status: 'open',
  channel: 'messenger',
  priority: 'none',
  subject: 'Hello',
  lastMessagePreview: null,
  lastMessageAt: now,
  visitorLastReadAt: null,
  agentLastReadAt: null,
  csatRating: null,
  csatComment: null,
  csatSubmittedAt: null,
  resolvedAt: null,
  visitorEmail: null,
  createdAt: now,
  updatedAt: null,
} as unknown as Conversation

const visitorActor: Actor = {
  principalId: 'principal_v',
  role: 'user',
  principalType: 'anonymous',
  segmentIds: new Set(),
} as unknown as Actor

const anonAuthor: ConversationAuthorInput = {
  principalId: 'principal_v',
  displayName: 'A visitor',
  email: 'temp-abc@anon.quackback.io',
}

const message = {
  id: 'conversation_msg_1',
  conversationId: 'conversation_1',
  principalId: 'principal_v',
  senderType: 'visitor',
  content: 'hi there',
  isInternal: false,
  createdAt: now,
} as unknown as ConversationMessage

beforeEach(() => Object.values(dispatch).forEach((m) => m.mockClear()))

describe('conversation.webhooks emit helpers', () => {
  it('emitConversationCreated sends a sanitized EventConversationData with a user actor', async () => {
    await emitConversationCreated(visitorActor, anonAuthor, baseConversation)
    expect(dispatch.dispatchConversationCreated).toHaveBeenCalledTimes(1)
    const [actorArg, dataArg] = dispatch.dispatchConversationCreated.mock.calls[0]
    expect(actorArg).toMatchObject({
      type: 'user',
      principalId: 'principal_v',
      displayName: 'A visitor',
    })
    expect(actorArg.email).toBeUndefined()
    expect(dataArg).toMatchObject({
      id: 'conversation_1',
      status: 'open',
      channel: 'messenger',
      priority: 'none',
      visitorEmail: null,
      createdAt: '2026-06-05T00:00:00.000Z',
      resolvedAt: null,
    })
  })

  it('emitMessageCreated strips a synthetic author email to null', async () => {
    await emitMessageCreated(visitorActor, anonAuthor, message, baseConversation)
    const [, msgArg, convRefArg] = dispatch.dispatchMessageCreated.mock.calls[0]
    expect(msgArg).toMatchObject({
      id: 'conversation_msg_1',
      senderType: 'visitor',
      authorName: 'A visitor',
      authorEmail: null,
      content: 'hi there',
    })
    expect(convRefArg).toEqual({
      id: 'conversation_1',
      status: 'open',
      channel: 'messenger',
      priority: 'none',
    })
    expect(dispatch.dispatchMessageNoteCreated).not.toHaveBeenCalled()
  })

  it('emitMessageNoteCreated routes to the note topic, not message.created', async () => {
    const note = {
      ...message,
      senderType: 'agent',
      isInternal: true,
    } as unknown as ConversationMessage
    const agent: ConversationAuthorInput = {
      principalId: 'principal_a',
      displayName: 'Agent',
      email: 'agent@acme.com',
    }
    const agentActor: Actor = {
      principalId: 'principal_a',
      role: 'member',
      principalType: 'user',
      segmentIds: new Set(),
    } as unknown as Actor
    await emitMessageNoteCreated(agentActor, agent, note, baseConversation)
    expect(dispatch.dispatchMessageNoteCreated).toHaveBeenCalledTimes(1)
    expect(dispatch.dispatchMessageCreated).not.toHaveBeenCalled()
    const [, msgArg] = dispatch.dispatchMessageNoteCreated.mock.calls[0]
    expect(msgArg.authorEmail).toBe('agent@acme.com')
  })

  it('emitConversationCsatSubmitted reads rating/comment/submittedAt from the row', async () => {
    const rated = {
      ...baseConversation,
      csatRating: 4,
      csatComment: 'ok',
      csatSubmittedAt: new Date('2026-06-05T02:00:00.000Z'),
    } as unknown as Conversation
    await emitConversationCsatSubmitted(visitorActor, rated)
    const [, convRefArg, rating, comment, submittedAt] =
      dispatch.dispatchConversationCsatSubmitted.mock.calls[0]
    expect(convRefArg.id).toBe('conversation_1')
    expect(rating).toBe(4)
    expect(comment).toBe('ok')
    expect(submittedAt).toBe('2026-06-05T02:00:00.000Z')
  })

  it('emitConversationCsatCommentAdded carries the comment, skips a comment-less row', async () => {
    const withComment = {
      ...baseConversation,
      csatRating: 4,
      csatComment: 'nice work',
      csatSubmittedAt: new Date('2026-06-05T02:00:00.000Z'),
    } as unknown as Conversation
    await emitConversationCsatCommentAdded(visitorActor, withComment)
    expect(dispatch.dispatchConversationCsatCommentAdded).toHaveBeenCalledTimes(1)
    const [, ref, rating, comment, submittedAt] =
      dispatch.dispatchConversationCsatCommentAdded.mock.calls[0]
    expect(ref.id).toBe('conversation_1')
    expect(rating).toBe(4)
    expect(comment).toBe('nice work')
    expect(submittedAt).toBe('2026-06-05T02:00:00.000Z')

    // A rating with no comment must not emit the comment event.
    const noComment = {
      ...baseConversation,
      csatRating: 5,
      csatComment: null,
      csatSubmittedAt: new Date('2026-06-05T02:00:00.000Z'),
    } as unknown as Conversation
    await emitConversationCsatCommentAdded(visitorActor, noComment)
    expect(dispatch.dispatchConversationCsatCommentAdded).toHaveBeenCalledTimes(1)
  })

  it('emitConversationStatusChanged passes previous then new status', async () => {
    const closed = { ...baseConversation, status: 'closed' } as unknown as Conversation
    await emitConversationStatusChanged(visitorActor, closed, 'open')
    expect(dispatch.dispatchConversationStatusChanged).toHaveBeenCalledTimes(1)
    const [, ref, previousStatus, newStatus] =
      dispatch.dispatchConversationStatusChanged.mock.calls[0]
    expect(ref).toEqual({
      id: 'conversation_1',
      status: 'closed',
      channel: 'messenger',
      priority: 'none',
    })
    expect(previousStatus).toBe('open')
    expect(newStatus).toBe('closed')
  })

  it('emitConversationAssigned passes new assignee then previous', async () => {
    const assigned = {
      ...baseConversation,
      assignedAgentPrincipalId: 'principal_a',
    } as unknown as Conversation
    await emitConversationAssigned(visitorActor, assigned, null)
    const [, , assignedAgentPrincipalId, previousAgentPrincipalId] =
      dispatch.dispatchConversationAssigned.mock.calls[0]
    expect(assignedAgentPrincipalId).toBe('principal_a')
    expect(previousAgentPrincipalId).toBeNull()
  })

  it('emitConversationPriorityChanged passes previous then new priority', async () => {
    const high = { ...baseConversation, priority: 'high' } as unknown as Conversation
    await emitConversationPriorityChanged(visitorActor, high, 'none')
    const [, , previousPriority, newPriority] =
      dispatch.dispatchConversationPriorityChanged.mock.calls[0]
    expect(previousPriority).toBe('none')
    expect(newPriority).toBe('high')
  })

  it('emitMessageDeleted sends only the message id + conversationId (no author)', async () => {
    await emitMessageDeleted(visitorActor, message, baseConversation)
    expect(dispatch.dispatchMessageDeleted).toHaveBeenCalledTimes(1)
    const [, msgRef, convRef] = dispatch.dispatchMessageDeleted.mock.calls[0]
    expect(msgRef).toEqual({ id: 'conversation_msg_1', conversationId: 'conversation_1' })
    expect(convRef).toEqual({
      id: 'conversation_1',
      status: 'open',
      channel: 'messenger',
      priority: 'none',
    })
  })
})
