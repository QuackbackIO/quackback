/**
 * Quinn answers stamp the agent-side read watermark; handoff clears it so
 * the thread surfaces as unread for the team.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConversationId, PrincipalId } from '@quackback/ids'

const setCalls: Array<Record<string, unknown>> = []

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchAssistantHandedOff: vi.fn(),
  buildEventActor: (a: unknown) => a,
}))
vi.mock('../routing', () => ({
  routeConversation: vi.fn(async () => ({ assignedPrincipalId: null })),
}))
vi.mock('@/lib/server/domains/workflows/workflow.service', () => ({
  hasLiveWorkflowForTrigger: vi.fn(async () => false),
}))
vi.mock('@/lib/server/domains/conversation-attributes/ai-classification.service', () => ({
  classifyConversationAttributes: vi.fn(async () => []),
}))
vi.mock('@/lib/server/domains/conversation-attributes/set-attribute.service', () => ({
  setConversationAttribute: vi.fn(async () => ({})),
}))
vi.mock('@/lib/server/domains/conversation-attributes/conversation-attribute.service', () => ({
  ensureAssistantEscalationReasonAttribute: vi.fn(async () => {}),
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

const conversationRow = {
  id: 'conversation_1',
  customAttributes: null,
  status: 'open',
  channel: 'messenger',
}

vi.mock('@/lib/server/db', async (importOriginal) => {
  function chain(): Record<string, unknown> {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.set = (patch: Record<string, unknown>) => {
      setCalls.push(patch)
      return c
    }
    c.where = () => c
    c.values = () => c
    c.limit = () => ({
      for: async () => [conversationRow],
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve([conversationRow]).then(resolve),
    })
    c.returning = async () => [
      {
        ...conversationRow,
        createdAt: new Date('2026-09-17T10:00:00.000Z'),
      },
    ]
    return c
  }
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: {
      select: () => chain(),
      update: () => chain(),
      insert: () => chain(),
      transaction: async (fn: (tx: { select: () => ReturnType<typeof chain> }) => unknown) =>
        fn({
          select: () => chain(),
          update: () => chain(),
          insert: () => chain(),
        } as never),
    },
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
  }
})

import { appendAssistantReply, executeAssistantHandoff } from '../conversation.service'

const convId = 'conversation_1' as ConversationId
const author = {
  principalId: 'principal_quinn' as PrincipalId,
  displayName: 'Quinn',
}

beforeEach(() => {
  vi.clearAllMocks()
  setCalls.length = 0
})

describe('Quinn read-stamp', () => {
  it('stamps agentLastReadAt on an answer', async () => {
    await appendAssistantReply(convId, 'Here is the fix.', author, { waiting: false })
    expect(setCalls.some((patch) => patch.agentLastReadAt instanceof Date)).toBe(true)
  })

  it('does not stamp agentLastReadAt on a handoff line', async () => {
    await appendAssistantReply(convId, 'Connecting you now.', author, { waiting: true })
    expect(setCalls.some((patch) => 'agentLastReadAt' in patch)).toBe(false)
  })

  it('clears agentLastReadAt on handoff so the team sees it unread', async () => {
    await executeAssistantHandoff(convId, 'explicit_request', author)
    expect(setCalls.some((patch) => patch.agentLastReadAt === null)).toBe(true)
  })
})
