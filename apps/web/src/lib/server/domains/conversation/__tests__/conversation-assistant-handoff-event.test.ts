/**
 * executeAssistantHandoff bus event: before this, a hand-off only produced a
 * system message + realtime update — workflows/webhooks had no way to react.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConversationId } from '@quackback/ids'

const dispatchAssistantHandedOff = vi.fn()
const buildEventActor = vi.fn((a: { principalId: string; displayName?: string }) => ({
  type: 'service' as const,
  principalId: a.principalId,
  displayName: a.displayName,
}))
vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchAssistantHandedOff: (...a: unknown[]) => dispatchAssistantHandedOff(...a),
  buildEventActor: (a: { principalId: string; displayName?: string }) => buildEventActor(a),
}))

const routeConversation = vi.fn()
vi.mock('../routing', () => ({
  routeConversation: (...a: unknown[]) => routeConversation(...a),
}))

const classifyConversationAttributes = vi.fn()
vi.mock('@/lib/server/domains/conversation-attributes/ai-classification.service', () => ({
  classifyConversationAttributes: (...a: unknown[]) => classifyConversationAttributes(...a),
}))

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
}))

vi.mock('../conversation.query', () => ({
  conversationToDTO: vi.fn(async (c: { id: string }) => ({ id: c.id })),
  toMessageDTO: vi.fn((m: Record<string, unknown>) => m),
  authorFromInput: vi.fn(),
  resolveAuthor: vi.fn(),
}))

vi.mock('../conversation.webhooks', () => ({
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

const conversationRow: Record<string, unknown> = {
  id: 'conversation_1',
  customAttributes: null,
  status: 'waiting',
}

vi.mock('@/lib/server/db', async (importOriginal) => {
  function chain(): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.set = () => c
    c.where = () => c
    c.values = () => c
    // loadConversationOr404 -> select().from().where().limit()
    c.limit = async () => [conversationRow]
    // update(...).set().where().returning() / insert(...).values().returning()
    c.returning = async () => [{ ...conversationRow }]
    return c
  }
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: {
      select: () => chain(),
      update: () => chain(),
      insert: () => chain(),
    },
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
  }
})

import { executeAssistantHandoff } from '../conversation.service'
import type { PrincipalId } from '@quackback/ids'

const convId = 'conversation_1' as ConversationId
const quinnAuthor = {
  principalId: 'principal_quinn' as PrincipalId,
  displayName: 'Quinn',
}

beforeEach(() => {
  vi.clearAllMocks()
  routeConversation.mockResolvedValue({ assignedPrincipalId: null })
  classifyConversationAttributes.mockResolvedValue([])
})

describe('executeAssistantHandoff bus event', () => {
  it('dispatches assistant.handed_off with the conversation id and reason', async () => {
    await executeAssistantHandoff(convId, 'explicit_request', quinnAuthor)

    expect(dispatchAssistantHandedOff).toHaveBeenCalledTimes(1)
    const [actor, conversationId, reason] = dispatchAssistantHandedOff.mock.calls[0]
    expect(conversationId).toBe(convId)
    expect(reason).toBe('explicit_request')
    expect(actor).toEqual({ type: 'service', principalId: 'principal_quinn', displayName: 'Quinn' })
    expect(buildEventActor).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: 'principal_quinn' })
    )
  })

  it('builds the actor from the caller-supplied author without a principal lookup', async () => {
    await executeAssistantHandoff(convId, 'frustration', {
      principalId: 'principal_other' as PrincipalId,
      displayName: undefined,
    })

    expect(dispatchAssistantHandedOff).toHaveBeenCalledTimes(1)
    expect(buildEventActor).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: 'principal_other', displayName: undefined })
    )
  })

  it('classifies attributes BEFORE dispatching the event, so a handoff-triggered workflow sees fresh values', async () => {
    const order: string[] = []
    classifyConversationAttributes.mockImplementation(async () => {
      order.push('classify')
      return []
    })
    dispatchAssistantHandedOff.mockImplementation(async () => {
      order.push('dispatch')
    })

    await executeAssistantHandoff(convId, 'explicit_request', quinnAuthor)

    expect(classifyConversationAttributes).toHaveBeenCalledWith(convId, { trigger: 'handoff' })
    expect(order).toEqual(['classify', 'dispatch'])
  })

  it('never lets a classification failure block the handoff', async () => {
    classifyConversationAttributes.mockRejectedValue(new Error('classifier exploded'))

    await expect(
      executeAssistantHandoff(convId, 'explicit_request', quinnAuthor)
    ).resolves.toBeUndefined()
    expect(dispatchAssistantHandedOff).toHaveBeenCalledTimes(1)
  })
})
