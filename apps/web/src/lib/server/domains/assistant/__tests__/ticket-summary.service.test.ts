import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TicketId, PrincipalId } from '@quackback/ids'

const mockTicketFindFirst = vi.fn()
const mockInsertValues = vi.fn()
const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      tickets: {
        findFirst: (...args: unknown[]) => mockTicketFindFirst(...args),
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

const mockOpenAI = {
  chat: { completions: { create: vi.fn() } },
}
const mockGetOpenAI = vi.fn(() => mockOpenAI as unknown)
vi.mock('@/lib/server/domains/ai/config', () => ({
  getOpenAI: () => mockGetOpenAI(),
  stripCodeFences: (s: string) => s.replace(/^```[a-z]*\n?/i, '').replace(/```$/, ''),
}))

const mockGetChatModel = vi.fn(() => 'test-model' as string | null)
vi.mock('@/lib/server/domains/ai/models', () => ({
  getChatModel: () => mockGetChatModel(),
  getEmbeddingModel: () => 'test-embedding-model',
}))

vi.mock('@/lib/server/domains/ai/retry', () => ({
  withRetry: (fn: () => Promise<unknown>) =>
    fn().then((result: unknown) => ({ result, retryCount: 0 })),
}))

const mockWithUsageLogging = vi.fn((_params: unknown, fn: () => Promise<{ result: unknown }>) =>
  fn().then(({ result }) => result)
)
vi.mock('@/lib/server/domains/ai/usage-log', () => ({
  withUsageLogging: (...args: [unknown, () => Promise<{ result: unknown }>]) =>
    mockWithUsageLogging(...args),
}))

const mockEnforceAiTokenBudget = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: (...args: unknown[]) => mockEnforceAiTokenBudget(...args),
}))

const mockGenerateEmbedding = vi.fn()
vi.mock('@/lib/server/domains/embeddings/embedding.service', () => ({
  generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
}))

const mockListTicketMessages = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket-message.service', () => ({
  listTicketMessages: (...args: unknown[]) => mockListTicketMessages(...args),
}))

const mockBuildTicketTranscript = vi.fn()
vi.mock('../transcript', () => ({
  buildTicketTranscript: (...args: unknown[]) => mockBuildTicketTranscript(...args),
  GROUNDING_CHAR_BUDGET: 10000,
}))

const mockLogError = vi.fn()
const mockLogWarn = vi.fn()
vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      error: (...args: unknown[]) => mockLogError(...args),
      warn: (...args: unknown[]) => mockLogWarn(...args),
      info: vi.fn(),
      debug: vi.fn(),
    }),
  },
}))

import { summarizeTicketOnClose } from '../ticket-summary.service'

const TICKET_ID = 'ticket_1' as TicketId
const REQUESTER_ID = 'principal_requester_1' as PrincipalId

function completion(content: string) {
  return { choices: [{ message: { content } }], usage: {} }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetOpenAI.mockReturnValue(mockOpenAI)
  mockGetChatModel.mockReturnValue('test-model')
  mockTicketFindFirst.mockResolvedValue({ requesterPrincipalId: REQUESTER_ID })
  mockListTicketMessages.mockResolvedValue({ messages: [{ id: 'm1' }] })
  mockBuildTicketTranscript.mockReturnValue('Customer: SSO broke\nAgent: fixed it')
  mockGenerateEmbedding.mockResolvedValue(null)
})

describe('summarizeTicketOnClose', () => {
  it('no-ops without touching the model when AI is unconfigured', async () => {
    mockGetOpenAI.mockReturnValue(null)
    await summarizeTicketOnClose(TICKET_ID)
    expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled()
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('excludes internal notes when loading the ticket thread', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue(completion('{"summary":"resolved"}'))
    await summarizeTicketOnClose(TICKET_ID)
    expect(mockListTicketMessages).toHaveBeenCalledWith(TICKET_ID, { includeInternal: false })
  })

  it('no-ops when nothing customer-visible happened (empty transcript)', async () => {
    mockBuildTicketTranscript.mockReturnValue('')
    await summarizeTicketOnClose(TICKET_ID)
    expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled()
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('upserts a summary row keyed on ticketId with the denormalized requester', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue(
      completion('{"summary":"SSO redirect_uri mismatch; fixed by re-adding the callback URL."}')
    )
    await summarizeTicketOnClose(TICKET_ID)

    expect(mockInsertValues).toHaveBeenCalledTimes(1)
    const values = mockInsertValues.mock.calls[0][0]
    expect(values).toMatchObject({
      ticketId: TICKET_ID,
      requesterPrincipalId: REQUESTER_ID,
      summary: 'SSO redirect_uri mismatch; fixed by re-adding the callback URL.',
    })
    // No embedding available in this run: the embedding columns stay absent.
    expect(values).not.toHaveProperty('embedding')
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1)
  })

  it('persists the embedding columns when an embedding is generated', async () => {
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
    mockOpenAI.chat.completions.create.mockResolvedValue(completion('{"summary":"resolved"}'))
    await summarizeTicketOnClose(TICKET_ID)

    const values = mockInsertValues.mock.calls[0][0]
    expect(values).toHaveProperty('embedding')
    expect(values.embeddingModel).toBe('test-embedding-model')
    expect(values.embeddingUpdatedAt).toBeInstanceOf(Date)
  })

  it('swallows a malformed model response (never throws, writes nothing)', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue(completion('not json'))
    await expect(summarizeTicketOnClose(TICKET_ID)).resolves.toBeUndefined()
    expect(mockInsertValues).not.toHaveBeenCalled()
    expect(mockLogError).toHaveBeenCalled()
  })

  it('swallows a missing ticket (never throws, writes nothing)', async () => {
    mockTicketFindFirst.mockResolvedValue(undefined)
    await expect(summarizeTicketOnClose(TICKET_ID)).resolves.toBeUndefined()
    expect(mockInsertValues).not.toHaveBeenCalled()
  })
})
