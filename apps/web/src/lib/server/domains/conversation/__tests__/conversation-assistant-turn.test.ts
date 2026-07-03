/**
 * Quinn messenger wiring: the out-of-band trigger gate and the escalation
 * dispatch. The model client is fully mocked (the assistant domain is replaced),
 * so no live runtime is exercised — these assert the conversation-side wiring:
 * when Quinn runs, and how offer vs hand-off persist.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationId } from '@quackback/ids'

const assistantMock = vi.hoisted(() => ({
  isAssistantConfigured: vi.fn(() => true),
  ensureAssistantPrincipal: vi.fn(async () => ({ id: 'principal_assistant' })),
  getAssistantPrincipal: vi.fn(async () => ({ id: 'principal_assistant' })),
  voidAssumedResolutionForConversation: vi.fn(async () => null),
  loadConversationThread: vi.fn(async () => [
    { senderType: 'visitor', content: 'hi', author: null },
  ]),
  mapRowsToThreadMessages: vi.fn(() => [{ sender: 'customer', content: 'hi' }]),
  respondEligible: vi.fn(() => true),
  getActiveInvolvement: vi.fn(async () => null as { id: string; escalationOfferedAt: Date } | null),
  openInvolvement: vi.fn(async () => ({ id: 'assistant_involvement_1' })),
  getLatestInvolvement: vi.fn(async () => null),
  runAssistantTurn: vi.fn(),
  recordHandoff: vi.fn(async () => {}),
  recordAssistantAnswer: vi.fn(async () => {}),
  setInvolvementRating: vi.fn(async () => {}),
  buildAssistantHandoverMessage: vi.fn(() => 'HANDOVER'),
}))
vi.mock('@/lib/server/domains/assistant', () => assistantMock)

const getMessengerConfig = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/domains/settings/settings.widget', () => ({ getMessengerConfig }))
vi.mock('@/lib/server/domains/settings/settings.office-hours', () => ({
  getOfficeHoursSchedule: vi.fn(async () => ({ enabled: false, timezone: 'UTC', intervals: [] })),
}))

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
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
// Routing declines so the hand-off takes the "stays unassigned" branch.
vi.mock('../routing', () => ({
  routeConversation: vi.fn(async () => ({ assignedPrincipalId: null })),
}))
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))
vi.mock('../conversation.query', () => ({
  conversationToDTO: vi.fn(async (c: { id: string }) => ({ id: c.id })),
  toMessageDTO: vi.fn((m: Record<string, unknown>) => ({
    id: m.id,
    conversationId: m.conversationId,
    content: m.content,
  })),
  authorFromInput: vi.fn((a: { principalId: string }) => ({ principalId: a.principalId })),
  resolveAuthor: vi.fn(async (a: { principalId: string }) => ({ principalId: a.principalId })),
  loadAuthors: vi.fn(async () => new Map()),
}))

const insertedMessages: Record<string, unknown>[] = []
const updateSets: Record<string, unknown>[] = []

function conversationRow(override: Record<string, unknown> = {}) {
  return {
    id: 'conversation_1',
    status: 'open',
    source: 'widget',
    customAttributes: {},
    visitorPrincipalId: 'principal_visitor',
    assignedAgentPrincipalId: null,
    createdAt: new Date(),
    updatedAt: null,
    ...override,
  }
}

vi.mock('@/lib/server/db', () => {
  function chain(label: string) {
    const c: Record<string, unknown> = {}
    let row: Record<string, unknown> = {}
    c.values = vi.fn((r: Record<string, unknown>) => {
      row = r
      if (label === 'conversation_messages') insertedMessages.push(r)
      return c
    })
    c.set = vi.fn((r: Record<string, unknown>) => {
      row = r
      if (label === 'conversations') updateSets.push(r)
      return c
    })
    c.where = vi.fn(() => c)
    c.orderBy = vi.fn(() => c)
    c.limit = vi.fn(async () => (label === 'conversations' ? [conversationRow()] : []))
    c.returning = vi.fn(async () => {
      if (label === 'conversation_messages') {
        return [{ ...row, id: 'conversation_msg_new', createdAt: new Date() }]
      }
      if (label === 'conversations') return [conversationRow(row)]
      return []
    })
    return c
  }
  const maker = {
    select: vi.fn(() => ({ from: (t: { __name?: string }) => chain(t?.__name ?? 'select') })),
    insert: vi.fn((t: { __name?: string }) => chain(t?.__name ?? 'unknown')),
    update: vi.fn((t: { __name?: string }) => chain(t?.__name ?? 'unknown')),
  }
  return {
    db: { ...maker, transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(maker)) },
    conversations: { __name: 'conversations' },
    conversationMessages: { __name: 'conversation_messages' },
    principal: { __name: 'principal' },
    user: { __name: 'user' },
    eq: vi.fn(),
    and: vi.fn(),
    or: vi.fn(),
    isNull: vi.fn(),
    isNotNull: vi.fn(),
    lte: vi.fn(),
    desc: vi.fn(),
    inArray: vi.fn(),
  }
})

import { shouldConsiderAssistant } from '../conversation.service'
import {
  runAssistantTurnForConversation,
  __resetAssistantPrincipalMemo,
} from '@/lib/server/domains/assistant/assistant.orchestrator'

const CONV = 'conversation_1' as ConversationId

function answered(extra: Record<string, unknown>) {
  return { status: 'answered', text: 'ok', citations: [], ...extra }
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetAssistantPrincipalMemo()
  insertedMessages.length = 0
  updateSets.length = 0
  assistantMock.isAssistantConfigured.mockReturnValue(true)
  assistantMock.ensureAssistantPrincipal.mockResolvedValue({ id: 'principal_assistant' })
  assistantMock.voidAssumedResolutionForConversation.mockResolvedValue(null)
  assistantMock.loadConversationThread.mockResolvedValue([
    { senderType: 'visitor', content: 'hi', author: null },
  ])
  assistantMock.mapRowsToThreadMessages.mockReturnValue([{ sender: 'customer', content: 'hi' }])
  assistantMock.respondEligible.mockReturnValue(true)
  assistantMock.getActiveInvolvement.mockResolvedValue(null)
  assistantMock.openInvolvement.mockResolvedValue({ id: 'assistant_involvement_1' })
  getMessengerConfig.mockResolvedValue({ assistant: { respond: true, name: 'Quinn' } })
})

describe('shouldConsiderAssistant', () => {
  it('considers a widget conversation reopened from a live/new state', () => {
    expect(shouldConsiderAssistant(conversationRow() as never, 'open')).toBe(true)
    expect(shouldConsiderAssistant(conversationRow() as never, null)).toBe(true)
  })

  it('skips non-widget sources (email joins in a later phase)', () => {
    expect(shouldConsiderAssistant(conversationRow({ source: 'email' }) as never, 'open')).toBe(
      false
    )
  })

  it('skips a thread a human deliberately closed', () => {
    expect(shouldConsiderAssistant(conversationRow() as never, 'closed')).toBe(false)
  })
})

describe('runAssistantTurnForConversation gate', () => {
  it('does not run when assistant.respond is off', async () => {
    getMessengerConfig.mockResolvedValue({ assistant: { respond: false } })
    await runAssistantTurnForConversation(CONV)
    expect(assistantMock.ensureAssistantPrincipal).not.toHaveBeenCalled()
    expect(assistantMock.runAssistantTurn).not.toHaveBeenCalled()
  })

  it('does not run when the AI client is not configured', async () => {
    assistantMock.isAssistantConfigured.mockReturnValue(false)
    await runAssistantTurnForConversation(CONV)
    expect(assistantMock.runAssistantTurn).not.toHaveBeenCalled()
  })

  it('persists nothing when the engine suppresses on the silence rule', async () => {
    assistantMock.runAssistantTurn.mockResolvedValue({ status: 'suppressed', reason: 'silence' })
    await runAssistantTurnForConversation(CONV)
    expect(assistantMock.openInvolvement).not.toHaveBeenCalled()
    expect(insertedMessages).toHaveLength(0)
  })
})

describe('runAssistantTurnForConversation escalation dispatch', () => {
  it('on an offer, persists Quinn reply + citations and stamps the offer (no hand-off)', async () => {
    assistantMock.runAssistantTurn.mockResolvedValue(
      answered({
        text: 'Here is the answer. Want me to connect a human?',
        citations: [{ type: 'article', id: 'a1', title: 'T', url: 'u' }],
        escalation: { reason: 'low_confidence', mode: 'offer' },
      })
    )
    await runAssistantTurnForConversation(CONV)

    expect(insertedMessages).toHaveLength(1)
    expect(insertedMessages[0].content).toBe('Here is the answer. Want me to connect a human?')
    // One combined involvement update: sources + inactivity stamp + the single
    // escalation offer (mode 'offer').
    expect(assistantMock.recordAssistantAnswer).toHaveBeenCalledWith('assistant_involvement_1', {
      sources: [{ type: 'article', id: 'a1', title: 'T', url: 'u' }],
      offeredEscalation: true,
    })
    expect(assistantMock.recordHandoff).not.toHaveBeenCalled()
  })

  it('on a hand-off, records the reason, writes the custom attribute, and posts the handover', async () => {
    assistantMock.getActiveInvolvement.mockResolvedValue({
      id: 'assistant_involvement_1',
      escalationOfferedAt: new Date(),
    })
    assistantMock.runAssistantTurn.mockResolvedValue(
      answered({ escalation: { reason: 'low_confidence', mode: 'handoff' } })
    )
    await runAssistantTurnForConversation(CONV)

    expect(assistantMock.recordHandoff).toHaveBeenCalledWith(
      'assistant_involvement_1',
      'low_confidence'
    )
    // The hand-off path posts the handover + records the reason; it never runs
    // the answer/offer involvement update.
    expect(assistantMock.recordAssistantAnswer).not.toHaveBeenCalled()
    expect(insertedMessages.some((m) => m.content === 'HANDOVER')).toBe(true)
    expect(
      updateSets.some(
        (s) =>
          (s.customAttributes as Record<string, unknown> | undefined)
            ?.assistant_escalation_reason === 'low_confidence'
      )
    ).toBe(true)
  })

  it('escalationAlreadyOffered rides the involvement offer stamp into the engine', async () => {
    assistantMock.getActiveInvolvement.mockResolvedValue({
      id: 'assistant_involvement_1',
      escalationOfferedAt: new Date(),
    })
    assistantMock.runAssistantTurn.mockResolvedValue(answered({}))
    await runAssistantTurnForConversation(CONV)
    expect(assistantMock.runAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({ escalationAlreadyOffered: true })
    )
  })
})
