import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'

const mockConversationFindFirst = vi.fn()
const mockInsertValues = vi.fn()
const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/server/db', async (importOriginal) => ({
  // Spread the real db module so tables/operators stay current; override only what this suite drives.
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      conversations: {
        findFirst: (...args: unknown[]) => mockConversationFindFirst(...args),
      },
    },
    insert: vi.fn(() => ({
      values: (...args: unknown[]) => {
        mockInsertValues(...args)
        return { onConflictDoUpdate: (...a: unknown[]) => mockOnConflictDoUpdate(...a) }
      },
    })),
  },
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

const mockGetChatModel = vi.fn(() => 'test-model' as string | null)
vi.mock('@/lib/server/domains/ai/models', () => ({
  getChatModel: () => mockGetChatModel(),
  getEmbeddingModel: () => 'test-embedding-model',
}))

const mockEnforceAiTokenBudget = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: (...args: unknown[]) => mockEnforceAiTokenBudget(...args),
}))

const mockGenerateEmbedding = vi.fn()
vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
}))

const mockLoadConversationThread = vi.fn()
vi.mock('../assistant.thread', () => ({
  loadConversationThread: (...args: unknown[]) => mockLoadConversationThread(...args),
}))

const mockLogError = vi.fn()
const mockLogWarn = vi.fn()
vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      error: (...args: unknown[]) => mockLogError(...args),
      warn: (...args: unknown[]) => mockLogWarn(...args),
      info: vi.fn(),
    }),
  },
}))

import { summarizeConversationOnClose } from '../conversation-summary.service'

const CONVERSATION_ID = 'conversation_1' as ConversationId
const VISITOR_PRINCIPAL_ID = 'principal_visitor_1' as PrincipalId

function msg(overrides: Partial<ConversationMessageDTO> = {}): ConversationMessageDTO {
  return {
    id: 'conversation_msg_1' as ConversationMessageDTO['id'],
    conversationId: CONVERSATION_ID,
    ticketId: null,
    senderType: 'visitor',
    content: 'hi',
    createdAt: '2026-01-01T00:00:00Z',
    author: { principalId: VISITOR_PRINCIPAL_ID, displayName: null, avatarUrl: null },
    attachments: [],
    citations: [],
    isAssistant: false,
    isInternal: false,
    contentJson: null,
    viaEmail: false,
    systemEvent: null,
    ...overrides,
  }
}

const TRANSCRIPT = [
  msg({ senderType: 'visitor', content: 'My March invoice charged me twice.' }),
  msg({ senderType: 'agent', content: 'Refunded the duplicate charge, sorry about that.' }),
]

beforeEach(() => {
  vi.clearAllMocks()
  mockConfig.openaiApiKey = 'test-key'
  mockConfig.openaiBaseUrl = 'http://localhost:9999/v1'
  mockEnforceAiTokenBudget.mockResolvedValue(undefined)
  mockGetChatModel.mockReturnValue('test-model')
  mockConversationFindFirst.mockResolvedValue({ visitorPrincipalId: VISITOR_PRINCIPAL_ID })
  mockLoadConversationThread.mockResolvedValue(TRANSCRIPT)
  mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
  mockChat.mockResolvedValue({
    summary: 'Customer was double-charged for their March invoice; refunded the duplicate.',
  })
})

describe('summarizeConversationOnClose', () => {
  it('writes a summary and its embedding for the closed conversation', async () => {
    await summarizeConversationOnClose(CONVERSATION_ID)

    expect(mockChat).toHaveBeenCalledOnce()
    const call = mockChat.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>
    }
    // The transcript is what the model sees; internal notes never enter it
    // (loadConversationThread already excludes them in SQL).
    expect(call.messages.at(-1)?.content).toContain('My March invoice charged me twice.')
    expect(call.messages.at(-1)?.content).toContain('Refunded the duplicate charge')

    expect(mockGenerateEmbedding).toHaveBeenCalledWith(
      'Customer was double-charged for their March invoice; refunded the duplicate.',
      expect.objectContaining({ pipelineStep: expect.any(String) })
    )

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        visitorPrincipalId: VISITOR_PRINCIPAL_ID,
        summary: 'Customer was double-charged for their March invoice; refunded the duplicate.',
        embeddingModel: 'test-embedding-model',
      })
    )
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.anything() })
    )
  })

  it('is a no-op when the AI client is not configured', async () => {
    mockConfig.openaiApiKey = undefined

    await summarizeConversationOnClose(CONVERSATION_ID)

    expect(mockLoadConversationThread).not.toHaveBeenCalled()
    expect(mockChat).not.toHaveBeenCalled()
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('is a no-op when the summary chat model is not configured', async () => {
    mockGetChatModel.mockReturnValue(null)

    await summarizeConversationOnClose(CONVERSATION_ID)

    expect(mockLoadConversationThread).not.toHaveBeenCalled()
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('never throws when the model call fails', async () => {
    mockChat.mockRejectedValue(new Error('upstream unavailable'))

    await expect(summarizeConversationOnClose(CONVERSATION_ID)).resolves.toBeUndefined()

    expect(mockInsertValues).not.toHaveBeenCalled()
    expect(mockLogError).toHaveBeenCalled()
  })

  it('never throws when the model response fails schema validation', async () => {
    // With outputSchema, chat() validates and rejects on a non-conforming
    // response; the outer best-effort catch logs and swallows it.
    mockChat.mockRejectedValue(new Error('response did not match schema'))

    await expect(summarizeConversationOnClose(CONVERSATION_ID)).resolves.toBeUndefined()

    expect(mockInsertValues).not.toHaveBeenCalled()
    expect(mockLogError).toHaveBeenCalled()
  })

  it('never throws when the DB write fails', async () => {
    mockOnConflictDoUpdate.mockRejectedValueOnce(new Error('db unavailable'))

    await expect(summarizeConversationOnClose(CONVERSATION_ID)).resolves.toBeUndefined()

    expect(mockLogError).toHaveBeenCalled()
  })

  it('does nothing when the conversation has no customer-visible transcript', async () => {
    mockLoadConversationThread.mockResolvedValue([
      msg({ senderType: 'system', content: 'chat_ended' }),
    ])

    await summarizeConversationOnClose(CONVERSATION_ID)

    expect(mockChat).not.toHaveBeenCalled()
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('does nothing when the conversation row cannot be found', async () => {
    mockConversationFindFirst.mockResolvedValue(undefined)

    await summarizeConversationOnClose(CONVERSATION_ID)

    expect(mockChat).not.toHaveBeenCalled()
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('loads the on-close transcript note-free (never opts into includeInternal), so an internal note can never leak into the persisted summary (D1)', async () => {
    // The leak boundary is the persisted summary: unlike the copilot grounding
    // block, this path must never pass includeInternal, so a note is filtered
    // out in SQL and never reaches the summarizer or the retrievable summary.
    await summarizeConversationOnClose(CONVERSATION_ID)

    expect(mockLoadConversationThread).toHaveBeenCalledWith(CONVERSATION_ID)
    const optsArg = mockLoadConversationThread.mock.calls[0]?.[1] as
      | { includeInternal?: boolean }
      | undefined
    expect(optsArg?.includeInternal).not.toBe(true)
  })

  it('still saves the summary text when embedding generation is unavailable', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)

    await summarizeConversationOnClose(CONVERSATION_ID)

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: 'Customer was double-charged for their March invoice; refunded the duplicate.',
      })
    )
    const values = mockInsertValues.mock.calls[0][0] as Record<string, unknown>
    expect(values.embedding).toBeUndefined()
  })
})
