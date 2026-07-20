/**
 * Copilot auto-fill on conversion (convergence Phase 5): the suggestion
 * service's gates (inboxAi flag -> assistant model configured -> token
 * budget), the pair-thread grounding (union loader when a customer ticket is
 * already linked, the conversation grounding read pre-conversion), the
 * per-field-type JSON schema generation, the structured-output fallback
 * (error/unparseable -> unavailable, never partials), and GATE 1 of the two
 * validation gates (model output validated against the field schema —
 * wholesale rejection, never a half-answer). Pure unit test, no real DB —
 * mirrors ai-classification.service.test.ts's mocking idiom.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConversationId, TicketId, TicketTypeId } from '@quackback/ids'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import type { TicketFormField } from '@/lib/shared/tickets'

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

const mockGetChatModel = vi.fn((_feature?: string): string | null => 'test-assistant-model')
vi.mock('@/lib/server/domains/ai/models', () => ({
  getChatModel: (feature: string) => mockGetChatModel(feature),
}))

const mockEnforceAiTokenBudget = vi.fn()
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: (...args: unknown[]) => mockEnforceAiTokenBudget(...args),
}))

const mockGetTicketType = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket-type.service', () => ({
  getTicketType: (...args: unknown[]) => mockGetTicketType(...args),
}))

const mockResolvePairTicketId = vi.fn()
const mockListPairThreadMessages = vi.fn()
vi.mock('@/lib/server/domains/tickets/pair-thread.service', () => ({
  resolvePairTicketIdForConversation: (...args: unknown[]) => mockResolvePairTicketId(...args),
  listPairThreadMessages: (...args: unknown[]) => mockListPairThreadMessages(...args),
}))

const mockListForGrounding = vi.fn()
vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  listConversationMessagesForGrounding: (...args: unknown[]) => mockListForGrounding(...args),
}))

import {
  suggestTicketFieldValues,
  buildSuggestionSchema,
  renderFieldCatalogue,
  validateSuggestedValues,
} from '../ticket-field-suggestion.service'

const CONVERSATION_ID = 'conversation_1' as ConversationId
const TICKET_TYPE_ID = 'ticket_type_bug' as TicketTypeId
const PAIR_TICKET_ID = 'ticket_1' as TicketId

const field = (over: Partial<TicketFormField>): TicketFormField => ({
  key: 'field',
  label: 'Field',
  type: 'text',
  required: false,
  visibleToCustomer: true,
  order: 0,
  ...over,
})

/** One of every field type, so schema generation + validation see them all. */
const ALL_FIELD_TYPES: TicketFormField[] = [
  field({
    key: 'severity',
    label: 'Severity',
    type: 'select',
    options: ['Low', 'High'],
    required: true,
  }),
  field({ key: 'steps', label: 'Steps', type: 'long_text' }),
  field({ key: 'affected_users', label: 'Affected users', type: 'number' }),
  field({ key: 'due', label: 'Due', type: 'date' }),
  field({ key: 'confirmed', label: 'Confirmed', type: 'checkbox' }),
  field({ key: 'note', label: 'Note', type: 'text' }),
]

/** A minimal thread DTO — the transcript renderer reads senderType/content/isInternal. */
const msg = (content: string, over: Record<string, unknown> = {}) =>
  ({
    id: 'conversation_message_x',
    senderType: 'visitor',
    content,
    isInternal: false,
    ...over,
  }) as never

beforeEach(() => {
  vi.clearAllMocks()
  mockConfig.openaiApiKey = 'test-key'
  mockConfig.openaiBaseUrl = 'http://localhost:9999/v1'
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockGetChatModel.mockReturnValue('test-assistant-model')
  mockEnforceAiTokenBudget.mockResolvedValue(undefined)
  mockGetTicketType.mockResolvedValue({ id: TICKET_TYPE_ID, fields: ALL_FIELD_TYPES })
  mockResolvePairTicketId.mockResolvedValue(null)
  mockListForGrounding.mockResolvedValue([
    msg('CSV export drops the filter columns when I export with any filter active.'),
    msg('Can you look into it? It blocks our weekly report.', { senderType: 'agent' }),
  ])
  mockListPairThreadMessages.mockResolvedValue({ messages: [], hasMore: false })
  mockChat.mockResolvedValue({
    title: 'CSV export drops filter columns',
    severity: 'High',
    steps: 'Export with any filter active → columns missing',
  })
})

describe('buildSuggestionSchema — JSON schema generation per field type', () => {
  it('maps every field type to its wire type and round-trips a well-formed answer', () => {
    const schema = buildSuggestionSchema(ALL_FIELD_TYPES)
    const parsed = schema.parse({
      title: 'A title',
      severity: 'High',
      steps: 'do this',
      affected_users: 3,
      due: '2026-07-20',
      confirmed: true,
      note: 'a note',
    })
    expect(parsed).toEqual({
      title: 'A title',
      severity: 'High',
      steps: 'do this',
      affected_users: 3,
      due: '2026-07-20',
      confirmed: true,
      note: 'a note',
    })
  })

  it('degrades a wrong-typed property to the wholesale-empty catch (never a half answer)', () => {
    const schema = buildSuggestionSchema(ALL_FIELD_TYPES)
    // affected_users must be a number; a string breaks the whole object and
    // the top-level .catch({}) degrades to "no suggestions" by design.
    expect(schema.parse({ title: 'ok', affected_users: 'three' })).toEqual({})
  })

  it('accepts an out-of-enum select string at the wire layer — enum enforcement is the validator gate, by design', () => {
    const schema = buildSuggestionSchema(ALL_FIELD_TYPES)
    expect(schema.parse({ severity: 'Critical' })).toEqual({ severity: 'Critical' })
  })

  it('strips keys that are not on the form', () => {
    const schema = buildSuggestionSchema(ALL_FIELD_TYPES)
    expect(schema.parse({ not_a_field: 'x', title: 't' })).toEqual({ title: 't' })
  })
})

describe('validateSuggestedValues — model output against the field schema (gate 1)', () => {
  it('rejects an out-of-enum select value', () => {
    const result = validateSuggestedValues(ALL_FIELD_TYPES, { severity: 'Critical' })
    expect(result).toEqual({ ok: false })
  })

  it('rejects a malformed date', () => {
    expect(validateSuggestedValues(ALL_FIELD_TYPES, { due: 'next Friday' })).toEqual({ ok: false })
  })

  it('accepts unanswered required fields — "not suggested" is never a required failure', () => {
    const result = validateSuggestedValues(ALL_FIELD_TYPES, { steps: 'do this' })
    expect(result).toEqual({ ok: true, values: { steps: 'do this' } })
  })

  it('drops empty-string answers instead of validating them', () => {
    const result = validateSuggestedValues(ALL_FIELD_TYPES, { severity: '  ', steps: 'x' })
    expect(result).toEqual({ ok: true, values: { steps: 'x' } })
  })

  it('drops a false checkbox answer (the control default), accepts true', () => {
    expect(validateSuggestedValues(ALL_FIELD_TYPES, { confirmed: false })).toEqual({
      ok: true,
      values: {},
    })
    expect(validateSuggestedValues(ALL_FIELD_TYPES, { confirmed: true })).toEqual({
      ok: true,
      values: { confirmed: true },
    })
  })
})

describe('renderFieldCatalogue', () => {
  it('lists select options inline so the model answers verbatim', () => {
    const catalogue = renderFieldCatalogue(ALL_FIELD_TYPES)
    expect(catalogue).toContain('Field "severity" (Severity), type select, required')
    expect(catalogue).toContain('Options: Low | High')
  })

  it('renders a title-only note for a type with no fields', () => {
    expect(renderFieldCatalogue([])).toContain('no custom fields')
  })
})

describe('suggestTicketFieldValues', () => {
  it('returns suggestions for a seeded thread, over one structured-completion call', async () => {
    const result = await suggestTicketFieldValues(CONVERSATION_ID, TICKET_TYPE_ID)
    expect(result).toEqual({
      suggestions: {
        title: 'CSV export drops filter columns',
        severity: 'High',
        steps: 'Export with any filter active → columns missing',
      },
    })

    expect(mockChat).toHaveBeenCalledTimes(1)
    const params = mockChat.mock.calls[0][0]
    // The generated schema is the call's outputSchema, the field catalogue
    // and the transcript ride the single user message, and usage is logged.
    expect(params.outputSchema).toBeDefined()
    expect(params.outputSchema.parse({ severity: 'High' })).toEqual({ severity: 'High' })
    expect(params.messages).toHaveLength(1)
    const content = params.messages[0].content as string
    expect(content).toContain('Field "severity" (Severity), type select, required')
    expect(content).toContain('Options: Low | High')
    expect(content).toContain('Customer: CSV export drops the filter columns')
    expect(params.modelOptions.max_tokens).toBe(2000)
    expect(params.middleware[0].name).toBe('ai-usage-logging')
  })

  it('grounds on the pair union loader (all: true, internal included) when a customer ticket is already linked', async () => {
    mockResolvePairTicketId.mockResolvedValue(PAIR_TICKET_ID)
    mockListPairThreadMessages.mockResolvedValue({
      messages: [msg('Legacy ticket note about the export bug.', { senderType: 'agent' })],
      hasMore: false,
    })

    const result = await suggestTicketFieldValues(CONVERSATION_ID, TICKET_TYPE_ID)
    expect(result.unavailable).not.toBe(true)
    expect(mockListPairThreadMessages).toHaveBeenCalledWith(PAIR_TICKET_ID, {
      all: true,
      includeInternal: true,
    })
    expect(mockListForGrounding).not.toHaveBeenCalled()
    const content = mockChat.mock.calls[0][0].messages[0].content as string
    expect(content).toContain('Agent: Legacy ticket note about the export bug.')
  })

  it('reads the conversation grounding loader with internal notes pre-conversion (no linked ticket)', async () => {
    await suggestTicketFieldValues(CONVERSATION_ID, TICKET_TYPE_ID)
    expect(mockListForGrounding).toHaveBeenCalledWith(CONVERSATION_ID, { includeInternal: true })
  })

  it('returns unavailable when the completion throws — no partials', async () => {
    mockChat.mockRejectedValue(new Error('provider 500'))
    const result = await suggestTicketFieldValues(CONVERSATION_ID, TICKET_TYPE_ID)
    expect(result).toEqual({ unavailable: true })
  })

  it('returns unavailable when the model output fails field validation (poisoned out-of-enum)', async () => {
    mockChat.mockResolvedValue({ title: 'x', severity: 'Critical' })
    const result = await suggestTicketFieldValues(CONVERSATION_ID, TICKET_TYPE_ID)
    expect(result).toEqual({ unavailable: true })
  })

  it('returns unavailable when the model answers nothing usable', async () => {
    mockChat.mockResolvedValue({})
    expect(await suggestTicketFieldValues(CONVERSATION_ID, TICKET_TYPE_ID)).toEqual({
      unavailable: true,
    })
  })

  it('drops a whitespace-only title but keeps field suggestions', async () => {
    mockChat.mockResolvedValue({ title: '   ', steps: 'repro' })
    const result = await suggestTicketFieldValues(CONVERSATION_ID, TICKET_TYPE_ID)
    expect(result).toEqual({ suggestions: { steps: 'repro' } })
  })

  it('returns unavailable when the inboxAi flag is off, without calling the model', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    expect(await suggestTicketFieldValues(CONVERSATION_ID, TICKET_TYPE_ID)).toEqual({
      unavailable: true,
    })
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('returns unavailable when the assistant model is not configured', async () => {
    mockGetChatModel.mockReturnValue(null)
    expect(await suggestTicketFieldValues(CONVERSATION_ID, TICKET_TYPE_ID)).toEqual({
      unavailable: true,
    })
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('returns unavailable when the AI client is not configured', async () => {
    mockConfig.openaiApiKey = undefined
    expect(await suggestTicketFieldValues(CONVERSATION_ID, TICKET_TYPE_ID)).toEqual({
      unavailable: true,
    })
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('returns unavailable when the AI token budget is exhausted', async () => {
    mockEnforceAiTokenBudget.mockRejectedValue(
      new TierLimitError({ limit: 'aiTokensPerMonth', message: 'budget exceeded' })
    )
    expect(await suggestTicketFieldValues(CONVERSATION_ID, TICKET_TYPE_ID)).toEqual({
      unavailable: true,
    })
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('returns unavailable on an empty thread, without calling the model', async () => {
    mockListForGrounding.mockResolvedValue([])
    expect(await suggestTicketFieldValues(CONVERSATION_ID, TICKET_TYPE_ID)).toEqual({
      unavailable: true,
    })
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('propagates an unknown ticket type as a genuine client error', async () => {
    mockGetTicketType.mockRejectedValue(new Error('Ticket type not found'))
    await expect(suggestTicketFieldValues(CONVERSATION_ID, TICKET_TYPE_ID)).rejects.toThrow(
      'Ticket type not found'
    )
  })
})
