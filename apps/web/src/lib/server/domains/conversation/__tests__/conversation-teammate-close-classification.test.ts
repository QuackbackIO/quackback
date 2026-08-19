/**
 * setConversationStatus (the conversation close service used by BOTH the
 * teammate inbox close path and Quinn's end_conversation tool, plus workflow
 * `close` actions): when a real teammate is the one closing the conversation,
 * fire the detectOnClose classification pass (AI-ATTRIBUTES-PARITY-SPEC.md
 * Phase 1, trigger 'teammate_close'), fire-and-forget. Never fires for a
 * service actor (Quinn or a workflow) closing through this same function —
 * those moments are covered by their own dedicated hooks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

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

let conversationRow: Record<string, unknown> = {
  id: 'conversation_1',
  customAttributes: null,
  status: 'open',
}

vi.mock('@/lib/server/db', async (importOriginal) => {
  function chain(): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    let setPayload: Record<string, unknown> = {}
    c.from = () => c
    c.set = (payload: Record<string, unknown>) => {
      setPayload = payload
      return c
    }
    c.where = () => c
    c.values = (payload: Record<string, unknown>) => {
      setPayload = payload
      return c
    }
    c.limit = async () => [conversationRow]
    // update(...).set({status, ...}).where().returning() reflects the
    // requested status, matching the real UPDATE this mocks.
    c.returning = async () => [{ ...conversationRow, ...setPayload }]
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

import { setConversationStatus } from '../conversation.service'

const convId = 'conversation_1' as ConversationId

const teammateActor: Actor = {
  principalId: 'principal_teammate' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}

const serviceActor: Actor = {
  principalId: null,
  role: 'admin',
  principalType: 'service',
  segmentIds: new Set(),
}

beforeEach(() => {
  vi.clearAllMocks()
  classifyConversationAttributes.mockResolvedValue([])
  conversationRow = { id: 'conversation_1', customAttributes: null, status: 'open' }
})

describe('setConversationStatus: teammate-close classification hook', () => {
  it('classifies (trigger teammate_close) when a real teammate closes the conversation', async () => {
    await setConversationStatus(convId, 'closed', teammateActor)
    expect(classifyConversationAttributes).toHaveBeenCalledWith(convId, {
      trigger: 'teammate_close',
    })
  })

  it('never fires for a service actor (Quinn/workflow) closing through the same function', async () => {
    await setConversationStatus(convId, 'closed', serviceActor)
    expect(classifyConversationAttributes).not.toHaveBeenCalled()
  })

  it('never fires when the status does not actually change to closed', async () => {
    conversationRow = { id: 'conversation_1', customAttributes: null, status: 'closed' }
    await setConversationStatus(convId, 'closed', teammateActor)
    expect(classifyConversationAttributes).not.toHaveBeenCalled()
  })

  it('never fires for a non-close status transition', async () => {
    await setConversationStatus(convId, 'snoozed', teammateActor)
    expect(classifyConversationAttributes).not.toHaveBeenCalled()
  })

  it('never lets a classification failure affect the close result', async () => {
    classifyConversationAttributes.mockRejectedValue(new Error('classifier exploded'))
    const result = await setConversationStatus(convId, 'closed', teammateActor)
    expect(result.status).toBe('closed')
  })
})
