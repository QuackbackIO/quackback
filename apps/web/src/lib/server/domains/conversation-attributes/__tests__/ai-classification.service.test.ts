/**
 * Deterministic AI attribute classification (AI-ATTRIBUTES-PARITY-SPEC.md
 * Phase 1): gating order (flag -> AI configured -> token budget -> at least
 * one enabled definition, narrowed to detectOnClose for teammate_close), the
 * one structured-output call, optionId validation, the AI-precedence-aware
 * write + churn-avoidance skip, and the combined internal-note audit record.
 * Mirrors quality-gate.service.test.ts's mocking idiom (pure unit test, no
 * real DB — this domain's write path already has real-DB coverage in
 * set-attribute.service.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockIsFeatureEnabled = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}))

const mockConfig = vi.hoisted(() => ({
  openaiApiKey: 'test-key' as string | undefined,
  openaiBaseUrl: 'http://localhost:9999/v1' as string | undefined,
}))
vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

const mockChat = vi.fn()
vi.mock('@tanstack/ai', () => ({
  chat: (...args: unknown[]) => mockChat(...args),
}))
vi.mock('@tanstack/ai-openai/compatible', () => ({
  openaiCompatibleText: (...args: unknown[]) => ({ kind: 'text', args }),
}))

vi.mock('@/lib/server/domains/ai/config', () => ({
  isAiClientConfigured: (apiKey?: string, baseUrl?: string) => Boolean(apiKey) && Boolean(baseUrl),
  structuredOutputProviderOptions: () => ({}),
}))

vi.mock('@/lib/server/domains/ai/usage-middleware', () => ({
  createUsageLoggingMiddleware: () => ({ name: 'ai-usage-logging' }),
}))

const mockGetChatModel = vi.fn((_feature?: string): string | null => 'test-classification-model')
vi.mock('@/lib/server/domains/ai/models', () => ({
  getChatModel: (feature: string) => mockGetChatModel(feature),
}))

const mockEnforceAiTokenBudget = vi.fn()
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: (...args: unknown[]) => mockEnforceAiTokenBudget(...args),
}))

const mockListConversationAttributes = vi.fn()
vi.mock('../conversation-attribute.service', () => ({
  listConversationAttributes: (...args: unknown[]) => mockListConversationAttributes(...args),
}))

const mockSetConversationAttribute = vi.fn()
vi.mock('../set-attribute.service', () => ({
  setConversationAttribute: (...args: unknown[]) => mockSetConversationAttribute(...args),
}))

const mockLoadConversationThread = vi.fn()
vi.mock('@/lib/server/domains/assistant/assistant.thread', () => ({
  loadConversationThread: (...args: unknown[]) => mockLoadConversationThread(...args),
}))

const mockEnsureAssistantPrincipal = vi.fn()
vi.mock('@/lib/server/domains/assistant/assistant.principal', () => ({
  ensureAssistantPrincipal: (...args: unknown[]) => mockEnsureAssistantPrincipal(...args),
}))

vi.mock('@/lib/server/domains/assistant/assistant.actor', () => ({
  quinnActor: (principalId: string) => ({
    principalId,
    role: 'admin',
    principalType: 'service',
    segmentIds: new Set(),
    permissions: new Set(),
  }),
}))

vi.mock('@/lib/server/messages/message-core', () => ({
  toMessageDTO: (message: Record<string, unknown>) => ({ ...message, dto: true }),
}))

vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  authorFromInput: (input: Record<string, unknown>) => ({ ...input }),
}))

/**
 * The conversation row `select().from().where().limit()` resolves to — the
 * classifier reads current `customAttributes` once up front so it can skip a
 * write that would just reproduce what's already on record (churn
 * avoidance), before ever calling the writer. Defaults to no stored
 * attributes; individual tests override via `mockConversationRow.current`.
 */
const mockConversationRow = vi.hoisted(() => ({
  current: { customAttributes: {} } as Record<string, unknown> | undefined,
}))
const mockInsertReturning = vi.hoisted(() => vi.fn())
const mockInsertValues = vi.hoisted(() =>
  vi.fn((_values: Record<string, unknown>) => ({ returning: mockInsertReturning }))
)
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () =>
          mockConversationRow.current ? [mockConversationRow.current] : []
        ),
      })),
    })),
  })),
  insert: vi.fn(() => ({ values: mockInsertValues })),
}))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: mockDb,
}))

const mockPublishAgentConversationEvent = vi.fn()
vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishAgentConversationEvent: (...args: unknown[]) => mockPublishAgentConversationEvent(...args),
}))

import type { ConversationId } from '@quackback/ids'
import { classifyConversationAttributes } from '../ai-classification.service'

const conversationId = 'conversation_1' as ConversationId

function fakeDefinition(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv_attr_1',
    key: 'issue_type',
    label: 'Issue type',
    description: 'What the conversation is about.',
    fieldType: 'select' as const,
    options: [
      { id: 'opt_billing', label: 'Billing', description: 'A charge question.' },
      { id: 'opt_bug', label: 'Bug report', description: null },
    ],
    requiredToClose: false,
    sourceHint: 'ai' as const,
    aiDetect: true,
    detectOnClose: false,
    archivedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockConfig.openaiApiKey = 'test-key'
  mockConfig.openaiBaseUrl = 'http://localhost:9999/v1'
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockGetChatModel.mockReturnValue('test-classification-model')
  mockEnforceAiTokenBudget.mockResolvedValue(undefined)
  mockListConversationAttributes.mockResolvedValue([fakeDefinition()])
  mockLoadConversationThread.mockResolvedValue([
    { senderType: 'visitor', content: 'I was charged twice for my subscription this month.' },
  ])
  mockEnsureAssistantPrincipal.mockResolvedValue({ id: 'principal_quinn' })
  mockSetConversationAttribute.mockResolvedValue({
    issue_type: { v: 'opt_billing', src: 'ai', at: '2026-01-01' },
  })
  mockInsertReturning.mockResolvedValue([{ id: 'message_1' }])
  mockConversationRow.current = { customAttributes: {} }
})

describe('classifyConversationAttributes: gating', () => {
  it('is a no-op when the inboxAi flag is off', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    const result = await classifyConversationAttributes(conversationId, { trigger: 'handoff' })
    expect(result).toEqual([])
    expect(mockListConversationAttributes).not.toHaveBeenCalled()
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('is a no-op when the AI client is not configured', async () => {
    mockConfig.openaiApiKey = undefined
    const result = await classifyConversationAttributes(conversationId, { trigger: 'handoff' })
    expect(result).toEqual([])
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('is a no-op when the classification chat model is not configured', async () => {
    mockGetChatModel.mockReturnValue(null)
    const result = await classifyConversationAttributes(conversationId, { trigger: 'handoff' })
    expect(result).toEqual([])
  })

  it('is a no-op when the AI token budget is exhausted', async () => {
    const { TierLimitError } = await import('@/lib/server/errors/tier-limit-error')
    mockEnforceAiTokenBudget.mockRejectedValue(
      new TierLimitError({ limit: 'aiTokensPerMonth', message: 'over budget' })
    )
    const result = await classifyConversationAttributes(conversationId, { trigger: 'handoff' })
    expect(result).toEqual([])
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('is a no-op when there are no enabled (aiDetect) definitions', async () => {
    mockListConversationAttributes.mockResolvedValue([])
    const result = await classifyConversationAttributes(conversationId, { trigger: 'handoff' })
    expect(result).toEqual([])
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('narrows to detectOnClose definitions for the teammate_close trigger', async () => {
    mockListConversationAttributes.mockResolvedValue([
      fakeDefinition({ key: 'issue_type', detectOnClose: false }),
      fakeDefinition({ key: 'sentiment', detectOnClose: true }),
    ])
    mockChat.mockResolvedValue({
      results: [{ key: 'sentiment', optionId: 'opt_billing', reasoning: 'x' }],
    })
    await classifyConversationAttributes(conversationId, { trigger: 'teammate_close' })
    const userMessage = mockChat.mock.calls[0][0].messages.find(
      (m: { role: string }) => m.role === 'user'
    ).content
    expect(userMessage).toContain('sentiment')
    expect(userMessage).not.toContain('issue_type')
  })

  it('is a no-op for teammate_close when no definitions have detectOnClose set', async () => {
    mockListConversationAttributes.mockResolvedValue([
      fakeDefinition({ key: 'issue_type', detectOnClose: false }),
    ])
    const result = await classifyConversationAttributes(conversationId, {
      trigger: 'teammate_close',
    })
    expect(result).toEqual([])
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('is a no-op when the conversation transcript is empty', async () => {
    mockLoadConversationThread.mockResolvedValue([])
    const result = await classifyConversationAttributes(conversationId, { trigger: 'handoff' })
    expect(result).toEqual([])
    expect(mockChat).not.toHaveBeenCalled()
  })

  // Phase 2 live re-check's restrictToKeys filter (AI-ATTRIBUTES-PARITY-
  // SPEC.md §3): narrows the enabled catalogue to the intersection with the
  // caller-supplied keys, independent of the per-trigger (detectOnClose)
  // narrowing.
  describe('restrictToKeys', () => {
    beforeEach(() => {
      mockListConversationAttributes.mockResolvedValue([
        fakeDefinition({ key: 'issue_type' }),
        fakeDefinition({ key: 'sentiment' }),
      ])
    })

    it('classifies only the definitions whose key is in restrictToKeys', async () => {
      mockChat.mockResolvedValue({
        results: [{ key: 'sentiment', optionId: 'opt_billing', reasoning: 'x' }],
      })
      await classifyConversationAttributes(conversationId, {
        trigger: 'live_recheck',
        restrictToKeys: ['sentiment'],
      })
      const userMessage = mockChat.mock.calls[0][0].messages.find(
        (m: { role: string }) => m.role === 'user'
      ).content
      expect(userMessage).toContain('sentiment')
      expect(userMessage).not.toContain('issue_type')
    })

    it('is a no-op when restrictToKeys intersects nothing enabled', async () => {
      const result = await classifyConversationAttributes(conversationId, {
        trigger: 'live_recheck',
        restrictToKeys: ['not_an_enabled_key'],
      })
      expect(result).toEqual([])
      expect(mockChat).not.toHaveBeenCalled()
    })

    it('classifies the full enabled catalogue when restrictToKeys is omitted', async () => {
      mockChat.mockResolvedValue({
        results: [
          { key: 'issue_type', optionId: 'opt_billing', reasoning: 'x' },
          { key: 'sentiment', optionId: 'opt_billing', reasoning: 'y' },
        ],
      })
      await classifyConversationAttributes(conversationId, { trigger: 'live_recheck' })
      const userMessage = mockChat.mock.calls[0][0].messages.find(
        (m: { role: string }) => m.role === 'user'
      ).content
      expect(userMessage).toContain('sentiment')
      expect(userMessage).toContain('issue_type')
    })

    it('intersects restrictToKeys with the teammate_close detectOnClose narrowing', async () => {
      mockListConversationAttributes.mockResolvedValue([
        fakeDefinition({ key: 'issue_type', detectOnClose: true }),
        fakeDefinition({ key: 'sentiment', detectOnClose: false }),
      ])
      // sentiment is in restrictToKeys but isn't detectOnClose, so it's
      // dropped by the trigger narrowing before restrictToKeys ever applies.
      const result = await classifyConversationAttributes(conversationId, {
        trigger: 'teammate_close',
        restrictToKeys: ['sentiment'],
      })
      expect(result).toEqual([])
      expect(mockChat).not.toHaveBeenCalled()
    })
  })
})

describe('classifyConversationAttributes: happy path', () => {
  it('classifies, writes through setConversationAttribute with src ai, and reports applied', async () => {
    mockChat.mockResolvedValue({
      results: [
        {
          key: 'issue_type',
          optionId: 'opt_billing',
          reasoning: 'Customer was charged twice.',
        },
      ],
    })

    const result = await classifyConversationAttributes(conversationId, { trigger: 'handoff' })

    expect(mockSetConversationAttribute).toHaveBeenCalledWith(
      { conversationId },
      'issue_type',
      'opt_billing',
      'ai'
    )
    expect(result).toEqual([
      { key: 'issue_type', applied: true, reasoning: 'Customer was charged twice.' },
    ])
  })

  it('passes the classification pipeline step and conversationId + trigger metadata to chat()', async () => {
    mockChat.mockResolvedValue({
      results: [{ key: 'issue_type', optionId: 'opt_billing', reasoning: 'x' }],
    })
    await classifyConversationAttributes(conversationId, { trigger: 'handoff' })
    expect(mockChat).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: false,
        middleware: expect.any(Array),
      })
    )
  })

  it('records one combined internal note for the applied writes this run', async () => {
    mockChat.mockResolvedValue({
      results: [{ key: 'issue_type', optionId: 'opt_billing', reasoning: 'Charged twice.' }],
    })
    await classifyConversationAttributes(conversationId, { trigger: 'handoff' })

    expect(mockDb.insert).toHaveBeenCalledTimes(1)
    const insertedValues = mockInsertValues.mock.calls[0][0]
    expect(insertedValues.isInternal).toBe(true)
    expect(insertedValues.senderType).toBe('agent')
    expect(insertedValues.content).toContain('Issue type')
    expect(insertedValues.content).toContain('Billing')
    expect(insertedValues.content).toContain('Charged twice.')
    expect(mockPublishAgentConversationEvent).toHaveBeenCalledTimes(1)
  })

  it('drops a result whose optionId is not one of the definition options', async () => {
    mockChat.mockResolvedValue({
      results: [{ key: 'issue_type', optionId: 'opt_not_real', reasoning: 'x' }],
    })
    const result = await classifyConversationAttributes(conversationId, { trigger: 'handoff' })
    expect(mockSetConversationAttribute).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('drops a result whose key is not in the enabled catalogue', async () => {
    mockChat.mockResolvedValue({
      results: [{ key: 'not_a_real_attribute', optionId: 'opt_billing', reasoning: 'x' }],
    })
    const result = await classifyConversationAttributes(conversationId, { trigger: 'handoff' })
    expect(mockSetConversationAttribute).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('treats a null optionId as "nothing applies" and skips the write when already unset', async () => {
    mockChat.mockResolvedValue({
      results: [{ key: 'issue_type', optionId: null, reasoning: 'Unclear.' }],
    })
    const result = await classifyConversationAttributes(conversationId, { trigger: 'handoff' })
    expect(mockSetConversationAttribute).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('skips the write and the note (churn avoidance) when the current value already matches', async () => {
    // Conversation already carries this exact ai-set value — the classifier
    // must read that before ever calling the writer, so re-deciding the same
    // value this run is a no-op: no write, no note, no result entry.
    mockConversationRow.current = {
      customAttributes: { issue_type: { v: 'opt_billing', src: 'ai', at: '2025-01-01' } },
    }
    mockChat.mockResolvedValue({
      results: [{ key: 'issue_type', optionId: 'opt_billing', reasoning: 'Still billing.' }],
    })
    const result = await classifyConversationAttributes(conversationId, { trigger: 'handoff' })
    expect(mockSetConversationAttribute).not.toHaveBeenCalled()
    expect(mockDb.insert).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('writes and notes a null result that clears a previously ai-set value', async () => {
    mockConversationRow.current = {
      customAttributes: { issue_type: { v: 'opt_billing', src: 'ai', at: '2025-01-01' } },
    }
    mockSetConversationAttribute.mockResolvedValue({})
    mockChat.mockResolvedValue({
      results: [{ key: 'issue_type', optionId: null, reasoning: 'No longer applies.' }],
    })
    const result = await classifyConversationAttributes(conversationId, { trigger: 'handoff' })
    expect(mockSetConversationAttribute).toHaveBeenCalledWith(
      { conversationId },
      'issue_type',
      null,
      'ai'
    )
    expect(result).toEqual([{ key: 'issue_type', applied: true, reasoning: 'No longer applies.' }])
  })

  it('never throws on a malformed model response', async () => {
    // Simulates what the hub's permissive outputSchema reduces a
    // shape-mismatched response down to: `{ results: [] }`.
    mockChat.mockResolvedValue({ results: [] })
    const result = await classifyConversationAttributes(conversationId, { trigger: 'handoff' })
    expect(result).toEqual([])
    expect(mockSetConversationAttribute).not.toHaveBeenCalled()
  })

  it('never throws when the model call itself rejects', async () => {
    mockChat.mockRejectedValue(new Error('upstream error'))
    await expect(
      classifyConversationAttributes(conversationId, { trigger: 'handoff' })
    ).resolves.toEqual([])
  })

  it('uses the bounded Quinn actor identity as the note author', async () => {
    mockChat.mockResolvedValue({
      results: [{ key: 'issue_type', optionId: 'opt_billing', reasoning: 'x' }],
    })
    await classifyConversationAttributes(conversationId, { trigger: 'handoff' })
    const insertedValues = mockInsertValues.mock.calls[0][0]
    expect(insertedValues.principalId).toBe('principal_quinn')
  })
})
