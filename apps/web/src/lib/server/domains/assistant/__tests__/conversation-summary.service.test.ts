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

const mockOpenAI = {
  chat: {
    completions: {
      create: vi.fn(),
    },
  },
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

// Call through once, no real retry/backoff — mirrors the pipeline test precedent.
vi.mock('@/lib/server/domains/ai/retry', () => ({
  withRetry: (fn: () => Promise<unknown>) =>
    fn().then((result: unknown) => ({ result, retryCount: 0 })),
}))

// Call through without touching ai_usage_log — mirrors extraction.service.test.ts's
// precedent, and keeps `mockInsertValues` (the conversation_summaries assertion
// below) from also observing the on-demand path's usage-log insert.
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

const mockLoadConversationThread = vi.fn()
vi.mock('../assistant.thread', () => ({
  loadConversationThread: (...args: unknown[]) => mockLoadConversationThread(...args),
}))

// Ticket grounding (unified inbox §2.9): the read-only reach into the tickets
// domain `generateTicketSummaryText` uses for its thread.
const mockListTicketMessages = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket-message.service', () => ({
  listTicketMessages: (...args: unknown[]) => mockListTicketMessages(...args),
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

import {
  summarizeConversationOnClose,
  generateConversationSummaryText,
  generateTicketSummaryText,
} from '../conversation-summary.service'
import type { TicketId } from '@quackback/ids'

const CONVERSATION_ID = 'conversation_1' as ConversationId
const VISITOR_PRINCIPAL_ID = 'principal_visitor_1' as PrincipalId
const TICKET_ID = 'ticket_1' as TicketId

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

function jsonCompletion(body: unknown) {
  return { choices: [{ message: { content: JSON.stringify(body) } }] }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockEnforceAiTokenBudget.mockResolvedValue(undefined)
  mockGetOpenAI.mockReturnValue(mockOpenAI as unknown as never)
  mockGetChatModel.mockReturnValue('test-model')
  mockConversationFindFirst.mockResolvedValue({ visitorPrincipalId: VISITOR_PRINCIPAL_ID })
  mockLoadConversationThread.mockResolvedValue(TRANSCRIPT)
  mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
  mockOpenAI.chat.completions.create.mockResolvedValue(
    jsonCompletion({
      summary: 'Customer was double-charged for their March invoice; refunded the duplicate.',
    })
  )
})

describe('summarizeConversationOnClose', () => {
  it('writes a summary and its embedding for the closed conversation', async () => {
    await summarizeConversationOnClose(CONVERSATION_ID)

    expect(mockOpenAI.chat.completions.create).toHaveBeenCalledOnce()
    const call = mockOpenAI.chat.completions.create.mock.calls[0][0] as {
      response_format: { type: string }
      messages: Array<{ role: string; content: string }>
    }
    expect(call.response_format).toEqual({ type: 'json_object' })
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

  it("usage-logs the call under its own pipelineStep 'conversation_summary', never 'copilot_summary'", async () => {
    // The step name is load-bearing twice over: it makes the fire-and-forget
    // close summarizer count against aiTokensPerMonth at all, and it keeps
    // this automatic spend out of analytics/copilot-usage.ts, which counts
    // 'copilot_summary' rows as on-demand Summarize-chip calls.
    await summarizeConversationOnClose(CONVERSATION_ID)

    expect(mockWithUsageLogging).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineStep: 'conversation_summary',
        callType: 'chat_completion',
        metadata: { conversationId: CONVERSATION_ID },
      }),
      expect.any(Function),
      expect.any(Function)
    )
  })

  it('is a no-op when the AI client is not configured', async () => {
    mockGetOpenAI.mockReturnValue(null as unknown as never)

    await summarizeConversationOnClose(CONVERSATION_ID)

    expect(mockLoadConversationThread).not.toHaveBeenCalled()
    expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled()
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('is a no-op when the summary chat model is not configured', async () => {
    mockGetChatModel.mockReturnValue(null)

    await summarizeConversationOnClose(CONVERSATION_ID)

    expect(mockLoadConversationThread).not.toHaveBeenCalled()
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('never throws when the model call fails', async () => {
    mockOpenAI.chat.completions.create.mockRejectedValue(new Error('upstream unavailable'))

    await expect(summarizeConversationOnClose(CONVERSATION_ID)).resolves.toBeUndefined()

    expect(mockInsertValues).not.toHaveBeenCalled()
    expect(mockLogError).toHaveBeenCalled()
  })

  it('never throws when the model response is not valid JSON', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: 'not json at all' } }],
    })

    await expect(summarizeConversationOnClose(CONVERSATION_ID)).resolves.toBeUndefined()

    expect(mockInsertValues).not.toHaveBeenCalled()
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

    expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled()
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('does nothing when the conversation row cannot be found', async () => {
    mockConversationFindFirst.mockResolvedValue(undefined)

    await summarizeConversationOnClose(CONVERSATION_ID)

    expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled()
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

describe('generateConversationSummaryText', () => {
  beforeEach(() => {
    mockOpenAI.chat.completions.create.mockResolvedValue(
      jsonCompletion({
        question: 'Duplicate March invoice charge',
        bullets: [
          'Customer was charged twice for their March invoice.',
          'Refunded the duplicate charge.',
        ],
      })
    )
  })

  it('returns a question and bullets built from the live transcript', async () => {
    const result = await generateConversationSummaryText(CONVERSATION_ID)

    expect(result).toEqual({
      question: 'Duplicate March invoice charge',
      bullets: [
        'Customer was charged twice for their March invoice.',
        'Refunded the duplicate charge.',
      ],
    })
    const call = mockOpenAI.chat.completions.create.mock.calls[0][0] as {
      response_format: { type: string }
      messages: Array<{ role: string; content: string }>
    }
    expect(call.response_format).toEqual({ type: 'json_object' })
    expect(call.messages.at(-1)?.content).toContain('My March invoice charged me twice.')
  })

  it('never writes to conversation_summaries or generates an embedding', async () => {
    await generateConversationSummaryText(CONVERSATION_ID)

    expect(mockInsertValues).not.toHaveBeenCalled()
    expect(mockGenerateEmbedding).not.toHaveBeenCalled()
  })

  it('usage-logs the call under pipelineStep copilot_summary, for the Copilot usage report', async () => {
    await generateConversationSummaryText(CONVERSATION_ID)

    expect(mockWithUsageLogging).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineStep: 'copilot_summary',
        callType: 'chat_completion',
        metadata: { conversationId: CONVERSATION_ID },
      }),
      expect.any(Function),
      expect.any(Function)
    )
  })

  it('returns null when the AI client is not configured', async () => {
    mockGetOpenAI.mockReturnValue(null as unknown as never)

    const result = await generateConversationSummaryText(CONVERSATION_ID)

    expect(result).toBeNull()
    expect(mockLoadConversationThread).not.toHaveBeenCalled()
  })

  it('returns null when the summary chat model is not configured', async () => {
    mockGetChatModel.mockReturnValue(null)

    const result = await generateConversationSummaryText(CONVERSATION_ID)

    expect(result).toBeNull()
    expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled()
  })

  it('returns null when there is no customer-visible transcript yet', async () => {
    mockLoadConversationThread.mockResolvedValue([
      msg({ senderType: 'system', content: 'chat_started' }),
    ])

    const result = await generateConversationSummaryText(CONVERSATION_ID)

    expect(result).toBeNull()
    expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled()
  })

  it('returns null on an invalid model response shape', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue(
      jsonCompletion({ question: 'Only a question, no bullets' })
    )

    const result = await generateConversationSummaryText(CONVERSATION_ID)

    expect(result).toBeNull()
  })

  it('returns null when the model response is not valid JSON', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: 'not json at all' } }],
    })

    const result = await generateConversationSummaryText(CONVERSATION_ID)

    expect(result).toBeNull()
  })

  it('propagates a model-call failure instead of swallowing it (unlike the on-close path)', async () => {
    mockOpenAI.chat.completions.create.mockRejectedValue(new Error('upstream unavailable'))

    await expect(generateConversationSummaryText(CONVERSATION_ID)).rejects.toThrow(
      'upstream unavailable'
    )
  })
})

describe('generateTicketSummaryText (unified inbox §2.9)', () => {
  beforeEach(() => {
    mockListTicketMessages.mockResolvedValue({
      messages: [
        { senderType: 'visitor', content: 'The CSV export button does nothing.' },
        { senderType: 'agent', content: 'Looking into it now.' },
      ],
      hasMore: false,
    })
    mockOpenAI.chat.completions.create.mockResolvedValue(
      jsonCompletion({
        question: 'CSV export broken',
        bullets: ['Customer cannot export CSV.', 'Agent is investigating.'],
      })
    )
  })

  it('returns a question and bullets built from the ticket thread', async () => {
    const result = await generateTicketSummaryText(TICKET_ID)

    expect(result).toEqual({
      question: 'CSV export broken',
      bullets: ['Customer cannot export CSV.', 'Agent is investigating.'],
    })
    expect(mockListTicketMessages).toHaveBeenCalledWith(TICKET_ID, { includeInternal: false })
    const call = mockOpenAI.chat.completions.create.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>
    }
    expect(call.messages.at(-1)?.content).toContain('The CSV export button does nothing.')
  })

  it('never writes anything (no ticket_summaries table, no message, no involvement)', async () => {
    await generateTicketSummaryText(TICKET_ID)

    expect(mockInsertValues).not.toHaveBeenCalled()
    expect(mockGenerateEmbedding).not.toHaveBeenCalled()
  })

  it('usage-logs the call under pipelineStep copilot_summary, same as the conversation path', async () => {
    await generateTicketSummaryText(TICKET_ID)

    expect(mockWithUsageLogging).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineStep: 'copilot_summary',
        callType: 'chat_completion',
        metadata: { ticketId: TICKET_ID },
      }),
      expect.any(Function),
      expect.any(Function)
    )
  })

  it('returns null when the AI client is not configured', async () => {
    mockGetOpenAI.mockReturnValue(null as unknown as never)

    const result = await generateTicketSummaryText(TICKET_ID)

    expect(result).toBeNull()
    expect(mockListTicketMessages).not.toHaveBeenCalled()
  })

  it('returns null when there is no customer-visible thread yet', async () => {
    mockListTicketMessages.mockResolvedValue({ messages: [], hasMore: false })

    const result = await generateTicketSummaryText(TICKET_ID)

    expect(result).toBeNull()
    expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled()
  })

  it('returns null on an invalid model response shape', async () => {
    mockOpenAI.chat.completions.create.mockResolvedValue(
      jsonCompletion({ question: 'Only a question, no bullets' })
    )

    const result = await generateTicketSummaryText(TICKET_ID)

    expect(result).toBeNull()
  })

  it('propagates a model-call failure instead of swallowing it', async () => {
    mockOpenAI.chat.completions.create.mockRejectedValue(new Error('upstream unavailable'))

    await expect(generateTicketSummaryText(TICKET_ID)).rejects.toThrow('upstream unavailable')
  })
})
