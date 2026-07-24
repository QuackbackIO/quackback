/**
 * Quinn messenger wiring: the out-of-band trigger gate and the escalation
 * dispatch. The model client is fully mocked (the assistant domain is replaced),
 * so no live runtime is exercised — these assert the conversation-side wiring:
 * when Quinn runs, and how offer vs hand-off persist.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationId } from '@quackback/ids'
import type { AssistantTurnResult } from '@/lib/server/domains/assistant/assistant.runtime'

const assistantMock = vi.hoisted(() => ({
  isAssistantConfigured: vi.fn(() => true),
  ensureAssistantPrincipal: vi.fn(async () => ({ id: 'principal_assistant' })),
  getAssistantPrincipal: vi.fn(async () => ({ id: 'principal_assistant' })),
  voidAssumedResolutionForConversation: vi.fn(async () => null),
  loadConversationThread: vi.fn(async () => [
    { id: 'conversation_message_1', senderType: 'visitor', content: 'hi', author: null },
  ]),
  mapRowsToThreadMessages: vi.fn(() => [{ sender: 'customer', content: 'hi' }]),
  respondEligible: vi.fn(() => true),
  getActiveInvolvement: vi.fn(async () => null as { id: string; escalationOfferedAt: Date } | null),
  openInvolvement: vi.fn(async () => ({ id: 'assistant_involvement_1' })),
  getLatestInvolvement: vi.fn(async () => null),
  runAssistantTurn: vi.fn(),
  // CAS shape: a won handoff returns the updated row; tests that need a lost
  // CAS override this per-case.
  recordHandoff: vi.fn(async () => ({ id: 'assistant_involvement_1', status: 'handed_off' })),
  recordAssistantAnswer: vi.fn(async () => {}),
  setInvolvementRating: vi.fn(async () => {}),
  // Mirrors the real assistant.runtime.ts mapping (thinking -> thinking; any
  // tool -> searching_kb for search, else reviewing_conversation) so
  // the activity-snapshot assertions below see the same status strings the
  // unmocked domain would produce.
  activityToStatus: vi.fn((activity: { kind: string; tool?: string }) =>
    activity.kind === 'thinking'
      ? 'thinking'
      : activity.tool === 'search'
        ? 'searching_kb'
        : 'reviewing_conversation'
  ),
}))
vi.mock('@/lib/server/domains/assistant', () => assistantMock)

const getMessengerConfig = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/domains/settings/settings.widget', () => ({ getMessengerConfig }))

const mockEnforceAiTokenBudget = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: mockEnforceAiTokenBudget,
}))
vi.mock('@/lib/server/domains/settings/settings.office-hours', () => ({
  getOfficeHoursSchedule: vi.fn(async () => ({ enabled: false, timezone: 'UTC', intervals: [] })),
}))

// Phase 2 live re-check (AI-ATTRIBUTES-PARITY-SPEC.md §3): defaults keep the
// hook inert (flag off, matching the real DEFAULT_FEATURE_FLAGS default) so
// every pre-existing test in this file exercises it as a no-op; the dedicated
// gating tests below flip these per case.
const mockIsFeatureEnabled = vi.hoisted(() => vi.fn(async () => false))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))
const mockGetLiveWorkflowReferencedAttributeKeys = vi.hoisted(() => vi.fn(async () => new Set()))
vi.mock('@/lib/server/domains/workflows/workflow.service', () => ({
  getLiveWorkflowReferencedAttributeKeys: mockGetLiveWorkflowReferencedAttributeKeys,
}))
const mockClassifyConversationAttributes = vi.hoisted(() => vi.fn(async () => []))
vi.mock('@/lib/server/domains/conversation-attributes/ai-classification.service', () => ({
  classifyConversationAttributes: mockClassifyConversationAttributes,
}))

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
  publishConversationUpdate: vi.fn(),
  publishTyping: vi.fn(),
  publishConversationOnlyEvent: vi.fn(),
}))
const mockWriteActivitySnapshot = vi.hoisted(() => vi.fn(async () => {}))
const mockClearActivitySnapshot = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/server/domains/assistant/assistant-activity-snapshot', () => ({
  writeActivitySnapshot: mockWriteActivitySnapshot,
  clearActivitySnapshot: mockClearActivitySnapshot,
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

const mockAppendAssistantHandoffNote = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]): Promise<void> => {})
)
vi.mock('@/lib/server/domains/conversation/conversation.service', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/server/domains/conversation/conversation.service')
  >()),
  appendAssistantHandoffNote: mockAppendAssistantHandoffNote,
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
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('').includes('assistant_escalation_reason')) {
        return { assistant_escalation_reason: values.at(-1) }
      }
      return { strings, values }
    },
  }
})

import { shouldConsiderAssistant } from '../conversation.service'
import {
  runAssistantTurnForConversation,
  __resetAssistantPrincipalMemo,
} from '@/lib/server/domains/assistant/assistant.orchestrator'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

const CONV = 'conversation_1' as ConversationId

type AnsweredTurn = Extract<AssistantTurnResult, { status: 'answered' }>
type CannotAnswerTurn = Extract<AssistantTurnResult, { status: 'cannot_answer' }>
type DeliveredFields = Omit<AnsweredTurn, 'status'>

const V2_IDENTITY: DeliveredFields['identity'] = {
  name: 'Nova',
  avatarUrl: 'https://cdn.example.com/nova.png',
}

// Durable trace fixtures contain only bounded config metadata and tool names/outcomes,
// never prompts, customer text, tool arguments, or tool results.
const PRIVACY_SAFE_TRACE: DeliveredFields['trace'] = {
  promptVersion: 'support-agent-v4',
  configRevision: 12,
  role: 'customer_support',
  tone: 'balanced',
  responseLength: 'brief',
  appliedGuidance: [],
  toolCalls: [],
}

const HANDOFF_PACKET: Omit<NonNullable<AnsweredTurn['escalation']>, 'mode'> = {
  reason: 'low_confidence',
  customerNeed: 'Restore access to the feature that keeps failing.',
  attempted: ['Reviewed the available troubleshooting guidance.'],
  recommendedNextStep: 'Inspect the account and reproduce the failure.',
}

function delivered(extra: Partial<DeliveredFields> = {}): DeliveredFields {
  return {
    text: 'ok',
    answerType: 'draft_reply',
    citations: [],
    internalSourced: false,
    proposedActions: [],
    identity: V2_IDENTITY,
    trace: PRIVACY_SAFE_TRACE,
    ...extra,
  }
}

function answered(extra: Partial<DeliveredFields> = {}): AnsweredTurn {
  return { status: 'answered', ...delivered(extra) }
}

/** Latest-involvement fixture: the orchestrator derives engaged ('active') vs
 *  bowed-out ('handed_off') from this single row's status. */
function involvementRow(status: 'active' | 'handed_off') {
  return { id: 'assistant_involvement_1', status, escalationOfferedAt: new Date() } as never
}

function cannotAnswer(
  extra: Partial<DeliveredFields> & {
    cannotAnswerReason?: CannotAnswerTurn['cannotAnswerReason']
  } = {}
): CannotAnswerTurn {
  const { cannotAnswerReason = 'no_relevant_sources', ...deliveredExtra } = extra
  return { status: 'cannot_answer', cannotAnswerReason, ...delivered(deliveredExtra) }
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
    { id: 'conversation_message_1', senderType: 'visitor', content: 'hi', author: null },
  ])
  assistantMock.mapRowsToThreadMessages.mockReturnValue([{ sender: 'customer', content: 'hi' }])
  assistantMock.respondEligible.mockReturnValue(true)
  assistantMock.getActiveInvolvement.mockResolvedValue(null)
  assistantMock.getLatestInvolvement.mockResolvedValue(null)
  assistantMock.openInvolvement.mockResolvedValue({ id: 'assistant_involvement_1' })
  getMessengerConfig.mockResolvedValue({ assistant: { respond: true, name: 'Quinn' } })
  mockEnforceAiTokenBudget.mockResolvedValue(undefined)
  mockIsFeatureEnabled.mockResolvedValue(false)
  mockGetLiveWorkflowReferencedAttributeKeys.mockResolvedValue(new Set())
  mockClassifyConversationAttributes.mockResolvedValue([])
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

  it('skips a ticket-intake backing conversation (source ticket_form, channel messenger)', () => {
    expect(
      shouldConsiderAssistant(
        conversationRow({ channel: 'messenger', source: 'ticket_form' }) as never,
        'open'
      )
    ).toBe(false)
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

  it('stays silent after a handoff even before the first teammate reply', async () => {
    // The customer writes again after "Connecting you to the team" but before
    // a human replies: the message-based silence rule cannot see the handoff,
    // so the involvement state must mute Quinn.
    assistantMock.getLatestInvolvement.mockResolvedValue(involvementRow('handed_off'))

    await runAssistantTurnForConversation(CONV)

    expect(assistantMock.runAssistantTurn).not.toHaveBeenCalled()
    expect(insertedMessages).toHaveLength(0)
    // The turn never started, so no activity snapshot was written or cleared.
    expect(mockClearActivitySnapshot).not.toHaveBeenCalled()
  })

  it('a workflow step explicitly re-engages Quinn on a handed-off conversation', async () => {
    assistantMock.getLatestInvolvement.mockResolvedValue(involvementRow('handed_off'))
    assistantMock.runAssistantTurn.mockResolvedValue(answered({}))

    await runAssistantTurnForConversation(CONV, { surface: 'workflow_step' })

    expect(assistantMock.runAssistantTurn).toHaveBeenCalled()
  })

  it('persists nothing when the engine suppresses on the silence rule', async () => {
    assistantMock.runAssistantTurn.mockResolvedValue({ status: 'suppressed', reason: 'silence' })
    await runAssistantTurnForConversation(CONV)
    expect(assistantMock.openInvolvement).not.toHaveBeenCalled()
    expect(insertedMessages).toHaveLength(0)
  })

  it('returns silently without calling the model when the ai token budget is exceeded', async () => {
    mockEnforceAiTokenBudget.mockRejectedValue(
      new TierLimitError({ limit: 'aiTokensPerMonth', message: 'over budget' })
    )
    await expect(runAssistantTurnForConversation(CONV)).resolves.toBeUndefined()
    expect(getMessengerConfig).not.toHaveBeenCalled()
    expect(assistantMock.runAssistantTurn).not.toHaveBeenCalled()
    expect(insertedMessages).toHaveLength(0)
  })

  it('propagates a non-tier-limit error from the budget check', async () => {
    mockEnforceAiTokenBudget.mockRejectedValue(new Error('db unavailable'))
    await expect(runAssistantTurnForConversation(CONV)).rejects.toThrow('db unavailable')
  })
})

describe('runAssistantTurnForConversation escalation dispatch', () => {
  it('persists an honest inability without opening involvement or stamping an answer', async () => {
    assistantMock.runAssistantTurn.mockResolvedValue(
      cannotAnswer({ text: 'I could not find that. I can connect you with a teammate.' })
    )

    await runAssistantTurnForConversation(CONV)

    expect(insertedMessages).toHaveLength(1)
    expect(insertedMessages[0].content).toBe(
      'I could not find that. I can connect you with a teammate.'
    )
    expect(assistantMock.openInvolvement).not.toHaveBeenCalled()
    expect(assistantMock.recordAssistantAnswer).not.toHaveBeenCalled()
  })

  it('persists a normal model-authored answer and its citations', async () => {
    assistantMock.runAssistantTurn.mockResolvedValue(
      answered({
        text: 'Here is the answer. Want me to connect a human?',
        citations: [{ type: 'article', id: 'a1', title: 'T', url: 'u' }],
      })
    )
    await runAssistantTurnForConversation(CONV)

    expect(insertedMessages).toHaveLength(1)
    expect(insertedMessages[0].content).toBe('Here is the answer. Want me to connect a human?')
    // A normal answer moves the inactivity clock but never smuggles an action
    // through response metadata.
    expect(assistantMock.recordAssistantAnswer).toHaveBeenCalledWith('assistant_involvement_1', {
      sources: [{ type: 'article', id: 'a1', title: 'T', url: 'u' }],
    })
    expect(assistantMock.recordHandoff).not.toHaveBeenCalled()
  })

  it('refuses an internal-sourced public result: the reply never persists, the floor hands off', async () => {
    assistantMock.runAssistantTurn.mockResolvedValue(
      answered({
        text: 'Here is the internal-sourced answer.',
        citations: [{ type: 'article', id: 'a1', title: 'Public article', url: '/hc/a1' }],
        internalSourced: true,
      })
    )

    // The leak guard rejects the reply; the failure floor then escalates to a
    // human rather than stranding the customer with no response at all.
    await expect(runAssistantTurnForConversation(CONV)).resolves.toBeUndefined()

    // The tainted model reply itself is never persisted — only the handoff
    // system message lands.
    expect(insertedMessages).toHaveLength(1)
    expect(insertedMessages[0].content).toBe('Connecting you to the team')
    expect(assistantMock.recordAssistantAnswer).not.toHaveBeenCalled()
    expect(assistantMock.recordHandoff).toHaveBeenCalledWith(
      'assistant_involvement_1',
      'system_error'
    )
    expect(mockAppendAssistantHandoffNote).not.toHaveBeenCalled()
  })

  it('passes the structured handoff packet to the note while preserving the model-authored reply', async () => {
    assistantMock.getLatestInvolvement.mockResolvedValue(involvementRow('active'))
    assistantMock.runAssistantTurn.mockResolvedValue(
      answered({
        text: 'I am connecting you with a teammate now.',
        escalation: { ...HANDOFF_PACKET, mode: 'handoff' },
      })
    )
    await runAssistantTurnForConversation(CONV)

    expect(assistantMock.recordHandoff).toHaveBeenCalledWith(
      'assistant_involvement_1',
      'low_confidence'
    )
    expect(mockAppendAssistantHandoffNote).toHaveBeenCalledWith(
      CONV,
      { ...HANDOFF_PACKET, mode: 'handoff' },
      {
        principalId: 'principal_assistant',
        displayName: 'Nova',
        avatarUrl: 'https://cdn.example.com/nova.png',
      }
    )
    // The hand-off path keeps the model's exact customer-facing prose; the
    // structured packet is only passed to the internal note seam.
    expect(assistantMock.recordAssistantAnswer).not.toHaveBeenCalled()
    expect(insertedMessages[0]).toMatchObject({
      principalId: 'principal_assistant',
      senderType: 'agent',
      content: 'I am connecting you with a teammate now.',
    })
    expect(
      updateSets.some(
        (s) =>
          (s.customAttributes as Record<string, unknown> | undefined)
            ?.assistant_escalation_reason === 'low_confidence'
      )
    ).toBe(true)
  })

  it('threads the active involvement id and the latest customer message id into the engine', async () => {
    assistantMock.getLatestInvolvement.mockResolvedValue(involvementRow('active'))
    assistantMock.runAssistantTurn.mockResolvedValue(answered({}))
    await runAssistantTurnForConversation(CONV)
    expect(assistantMock.runAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        involvementId: 'assistant_involvement_1',
        latestCustomerMessageId: 'conversation_message_1',
      })
    )
  })

  it('passes involvementId null before the first involvement opens', async () => {
    assistantMock.getLatestInvolvement.mockResolvedValue(null)
    assistantMock.runAssistantTurn.mockResolvedValue(answered({}))
    await runAssistantTurnForConversation(CONV)
    expect(assistantMock.runAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({ involvementId: null })
    )
  })

  it('threads the explicit customer-support widget boundary into the engine', async () => {
    assistantMock.runAssistantTurn.mockResolvedValue(answered({}))
    await runAssistantTurnForConversation(CONV)
    expect(assistantMock.runAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'customer_support', surface: 'widget' })
    )
  })

  it('threads the workflow_step surface and one-time instructions into the engine', async () => {
    assistantMock.runAssistantTurn.mockResolvedValue(answered({}))
    await runAssistantTurnForConversation(CONV, {
      surface: 'workflow_step',
      stepInstructions: 'Answer only the billing question.',
    })
    expect(assistantMock.runAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'customer_support',
        surface: 'workflow_step',
        stepInstructions: 'Answer only the billing question.',
      })
    )
  })
})

describe('runAssistantTurnForConversation preview retraction (invalidated attempt)', () => {
  async function publishedEvents(): Promise<Array<Record<string, unknown>>> {
    const { publishConversationOnlyEvent } =
      await import('@/lib/server/realtime/conversation-channels')
    return vi.mocked(publishConversationOnlyEvent).mock.calls.map(([, e]) => e as never)
  }

  it('retracts a streamed answer on retry and stays preview-silent for the rest of the turn', async () => {
    assistantMock.runAssistantTurn.mockImplementation(
      async (input: { onActivity: (a: unknown) => void; onTextDelta: (d: string) => void }) => {
        // Attempt 1: streams a full answer, then the attempt fails after the
        // fact (a structural rejection or a transport re-dial) — the retry
        // starts with a fresh 'thinking'.
        input.onActivity({ kind: 'thinking' })
        input.onTextDelta('All systems are ')
        input.onTextDelta('operational right now.')
        // Attempt 2 (the retry): must never stream a second candidate the
        // customer could watch get retracted again.
        input.onActivity({ kind: 'thinking' })
        input.onTextDelta('We currently have a degraded-performance incident.')
        return answered({ text: 'We currently have a degraded-performance incident.' })
      }
    )
    await runAssistantTurnForConversation(CONV)

    const deltas = (await publishedEvents()).filter((e) => e.kind === 'assistant_delta')
    // Attempt 1's preview streamed at least once.
    expect(deltas.some((e) => (e.text as string).length > 0)).toBe(true)
    // The invalidation retracted it with an explicit empty frame...
    const retractionIndex = deltas.findIndex((e) => e.text === '')
    expect(retractionIndex).toBeGreaterThan(-1)
    // ...and nothing streamed after it: the retry's answer arrives only as
    // the persisted, validated reply.
    expect(deltas.slice(retractionIndex + 1)).toEqual([])
  })

  it('a clean single-attempt turn streams without any retraction frame', async () => {
    assistantMock.runAssistantTurn.mockImplementation(
      async (input: { onActivity: (a: unknown) => void; onTextDelta: (d: string) => void }) => {
        input.onActivity({ kind: 'thinking' })
        input.onTextDelta('Here is your answer.')
        return answered({ text: 'Here is your answer.' })
      }
    )
    await runAssistantTurnForConversation(CONV)

    const deltas = (await publishedEvents()).filter((e) => e.kind === 'assistant_delta')
    expect(deltas.length).toBeGreaterThan(0)
    expect(deltas.every((e) => (e.text as string).length > 0)).toBe(true)
  })
})

describe('runAssistantTurnForConversation activity snapshot (Redis mirror)', () => {
  it('mirrors every onActivity publish into Redis, keyed by conversation', async () => {
    assistantMock.runAssistantTurn.mockImplementation(
      async (input: { onActivity: (a: unknown) => void }) => {
        input.onActivity({ kind: 'thinking' })
        return answered({})
      }
    )
    await runAssistantTurnForConversation(CONV)

    expect(mockWriteActivitySnapshot).toHaveBeenCalledWith(
      CONV,
      expect.objectContaining({ kind: 'assistant_activity', status: 'thinking' })
    )
  })

  it('clears the snapshot once the reply lands (answer/offer path)', async () => {
    assistantMock.runAssistantTurn.mockResolvedValue(answered({}))
    await runAssistantTurnForConversation(CONV)
    expect(mockClearActivitySnapshot).toHaveBeenCalledWith(CONV)
  })

  it('clears the snapshot on the hand-off path', async () => {
    assistantMock.getLatestInvolvement.mockResolvedValue(involvementRow('active'))
    assistantMock.runAssistantTurn.mockResolvedValue(
      answered({ escalation: { ...HANDOFF_PACKET, mode: 'handoff' } })
    )
    await runAssistantTurnForConversation(CONV)
    expect(mockClearActivitySnapshot).toHaveBeenCalledWith(CONV)
  })

  it('clears the snapshot when the engine suppresses on the silence rule', async () => {
    assistantMock.runAssistantTurn.mockResolvedValue({ status: 'suppressed', reason: 'silence' })
    await runAssistantTurnForConversation(CONV)
    expect(mockClearActivitySnapshot).toHaveBeenCalledWith(CONV)
  })

  it('fails over to a human handoff on a model failure: no Quinn reply, system message only', async () => {
    assistantMock.runAssistantTurn.mockRejectedValue(new Error('provider exhausted'))

    // The floor is the terminal outcome, so the orchestrator resolves rather
    // than rejecting into the caller's fire-and-forget catch.
    await expect(runAssistantTurnForConversation(CONV)).resolves.toBeUndefined()

    // The only persisted message is the visitor-visible transition marker from
    // executeAssistantHandoff — never a server-authored Quinn reply.
    expect(insertedMessages).toHaveLength(1)
    expect(insertedMessages[0].content).toBe('Connecting you to the team')
    expect(assistantMock.recordHandoff).toHaveBeenCalledWith(
      'assistant_involvement_1',
      'system_error'
    )
    expect(mockAppendAssistantHandoffNote).not.toHaveBeenCalled()
    expect(
      updateSets.some(
        (s) =>
          (s.customAttributes as Record<string, unknown> | undefined)
            ?.assistant_escalation_reason === 'system_error'
      )
    ).toBe(true)
    expect(mockClearActivitySnapshot).toHaveBeenCalledWith(CONV)
  })

  it('skips the failure-floor handoff when a human took over mid-turn', async () => {
    assistantMock.runAssistantTurn.mockRejectedValue(new Error('provider exhausted'))
    // Eligible when the turn starts, ineligible at floor time (a human replied
    // while the turn was failing).
    assistantMock.respondEligible.mockReturnValueOnce(true).mockReturnValue(false)

    await expect(runAssistantTurnForConversation(CONV)).resolves.toBeUndefined()

    expect(assistantMock.recordHandoff).not.toHaveBeenCalled()
    expect(insertedMessages).toHaveLength(0)
    expect(mockClearActivitySnapshot).toHaveBeenCalledWith(CONV)
  })

  it('skips the failure-floor handoff when the conversation is already handed off', async () => {
    assistantMock.runAssistantTurn.mockRejectedValue(new Error('provider exhausted'))
    // Not handed off when the turn starts (the pre-turn handoff gate must let
    // it through), handed off by the time the floor re-checks — e.g. a
    // concurrent turn escalated while this one was failing.
    assistantMock.getLatestInvolvement
      .mockResolvedValueOnce(null)
      .mockResolvedValue(involvementRow('handed_off'))

    await expect(runAssistantTurnForConversation(CONV)).resolves.toBeUndefined()

    expect(assistantMock.recordHandoff).not.toHaveBeenCalled()
    expect(assistantMock.openInvolvement).not.toHaveBeenCalled()
    expect(insertedMessages).toHaveLength(0)
    expect(mockClearActivitySnapshot).toHaveBeenCalledWith(CONV)
  })

  it('never writes or clears when the turn never starts (respond off)', async () => {
    getMessengerConfig.mockResolvedValue({ assistant: { respond: false } })
    await runAssistantTurnForConversation(CONV)
    expect(mockWriteActivitySnapshot).not.toHaveBeenCalled()
    expect(mockClearActivitySnapshot).not.toHaveBeenCalled()
  })
})

describe('runAssistantTurnForConversation Phase 2 live attribute re-check', () => {
  it('never fires when the inboxAi flag is off', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    mockGetLiveWorkflowReferencedAttributeKeys.mockResolvedValue(new Set(['issue_type']))
    assistantMock.runAssistantTurn.mockResolvedValue(answered({}))
    await runAssistantTurnForConversation(CONV)
    // The flag gate is checked before the referenced-keys read at all.
    expect(mockGetLiveWorkflowReferencedAttributeKeys).not.toHaveBeenCalled()
    expect(mockClassifyConversationAttributes).not.toHaveBeenCalled()
  })

  it('never fires when no live workflow references any AI attribute', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true)
    mockGetLiveWorkflowReferencedAttributeKeys.mockResolvedValue(new Set())
    assistantMock.runAssistantTurn.mockResolvedValue(answered({}))
    await runAssistantTurnForConversation(CONV)
    await vi.waitFor(() => {
      expect(mockGetLiveWorkflowReferencedAttributeKeys).toHaveBeenCalled()
    })
    expect(mockClassifyConversationAttributes).not.toHaveBeenCalled()
  })

  it('fires with trigger live_recheck restricted to the referenced keys when flag on + referenced', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true)
    mockGetLiveWorkflowReferencedAttributeKeys.mockResolvedValue(
      new Set(['issue_type', 'sentiment'])
    )
    assistantMock.runAssistantTurn.mockResolvedValue(answered({}))
    await runAssistantTurnForConversation(CONV)
    await vi.waitFor(() => {
      expect(mockClassifyConversationAttributes).toHaveBeenCalled()
    })
    expect(mockClassifyConversationAttributes).toHaveBeenCalledWith(CONV, {
      trigger: 'live_recheck',
      restrictToKeys: expect.arrayContaining(['issue_type', 'sentiment']),
    })
  })

  it('never fires when the silence rule mutes the turn (a human is handling it)', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true)
    mockGetLiveWorkflowReferencedAttributeKeys.mockResolvedValue(new Set(['issue_type']))
    assistantMock.respondEligible.mockReturnValue(false)
    await runAssistantTurnForConversation(CONV)
    expect(mockClassifyConversationAttributes).not.toHaveBeenCalled()
  })

  it('still fires on a hand-off turn (independent of this turn resolving as a hand-off)', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true)
    mockGetLiveWorkflowReferencedAttributeKeys.mockResolvedValue(new Set(['issue_type']))
    assistantMock.getLatestInvolvement.mockResolvedValue(involvementRow('active'))
    assistantMock.runAssistantTurn.mockResolvedValue(
      answered({ escalation: { ...HANDOFF_PACKET, mode: 'handoff' } })
    )
    await runAssistantTurnForConversation(CONV)
    await vi.waitFor(() => {
      expect(mockClassifyConversationAttributes).toHaveBeenCalled()
    })
  })

  it('a re-check failure never propagates into the turn', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true)
    mockGetLiveWorkflowReferencedAttributeKeys.mockResolvedValue(new Set(['issue_type']))
    mockClassifyConversationAttributes.mockRejectedValue(new Error('classification boom'))
    assistantMock.runAssistantTurn.mockResolvedValue(answered({}))
    await expect(runAssistantTurnForConversation(CONV)).resolves.toBeUndefined()
  })
})
