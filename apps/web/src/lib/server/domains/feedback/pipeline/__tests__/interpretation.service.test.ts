/**
 * Tests for interpretation service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FeedbackSignalId, RawFeedbackItemId } from '@quackback/ids'

// --- Mock tracking ---
const updateSetCalls: unknown[][] = []

function createUpdateChain() {
  const chain: Record<string, unknown> = {}
  chain.set = vi.fn((...args: unknown[]) => {
    updateSetCalls.push(args)
    return chain
  })
  chain.where = vi.fn().mockResolvedValue([])
  return chain
}

const mockSignalFindFirst = vi.fn()
const mockRawItemFindFirst = vi.fn()
const mockPostFindFirst = vi.fn()
const mockSignalFindMany = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      feedbackSignals: {
        findFirst: (...args: unknown[]) => mockSignalFindFirst(...args),
        findMany: (...args: unknown[]) => mockSignalFindMany(...args),
      },
      rawFeedbackItems: {
        findFirst: (...args: unknown[]) => mockRawItemFindFirst(...args),
      },
      posts: {
        findFirst: (...args: unknown[]) => mockPostFindFirst(...args),
      },
      boards: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'board_1', name: 'Features', slug: 'features' }]),
      },
    },
    update: vi.fn(() => createUpdateChain()),
  },
  eq: vi.fn(),
  feedbackSignals: {
    id: 'id',
    processingState: 'processing_state',
    rawFeedbackItemId: 'raw_feedback_item_id',
  },
  rawFeedbackItems: {
    id: 'id',
    processingState: 'processing_state',
  },
  posts: { id: 'id' },
  boards: {},
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}))

const mockEmbedSignal = vi.fn()
const mockFindSimilarPosts = vi.fn()

vi.mock('../embedding.service', () => ({
  embedSignal: (...args: unknown[]) => mockEmbedSignal(...args),
  findSimilarPosts: (...args: unknown[]) => mockFindSimilarPosts(...args),
}))

const mockCreateMergeSuggestion = vi.fn()
const mockCreatePostSuggestion = vi.fn()

vi.mock('../suggestion.service', () => ({
  createMergeSuggestion: (...args: unknown[]) => mockCreateMergeSuggestion(...args),
  createPostSuggestion: (...args: unknown[]) => mockCreatePostSuggestion(...args),
}))

vi.mock('../prompts/suggestion.prompt', () => ({
  buildSuggestionPrompt: vi.fn(() => 'mocked suggestion prompt'),
}))

const mockOpenAI = {
  chat: {
    completions: {
      create: vi.fn(),
    },
  },
}

vi.mock('@/lib/server/domains/ai/config', () => ({
  getOpenAI: vi.fn(() => mockOpenAI),
}))

vi.mock('@/lib/server/domains/ai/retry', () => ({
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}))

describe('interpretation.service', () => {
  beforeEach(() => {
    updateSetCalls.length = 0
    vi.clearAllMocks()
  })

  const signalId = 'signal_123' as FeedbackSignalId
  const rawItemId = 'raw_item_456' as RawFeedbackItemId
  const mockEmbedding = [0.1, 0.2, 0.3]

  const baseSignal = {
    id: signalId,
    rawFeedbackItemId: rawItemId,
    processingState: 'pending_interpretation',
    signalType: 'feature_request',
    summary: 'CSV export needed',
    implicitNeed: 'Data portability',
    evidence: ['I need CSV export'],
    sentiment: 'neutral',
    urgency: 'medium',
  }

  it('should create merge suggestion for quackback post with similar match', async () => {
    mockSignalFindFirst.mockResolvedValueOnce(baseSignal)
    mockEmbedSignal.mockResolvedValueOnce(mockEmbedding)
    mockRawItemFindFirst.mockResolvedValueOnce({
      sourceType: 'quackback',
      externalId: 'post:post_src',
      content: { text: 'test' },
    })
    mockPostFindFirst.mockResolvedValueOnce({
      embedding: '[0.1,0.2,0.3]',
    })
    mockFindSimilarPosts.mockResolvedValueOnce([
      {
        id: 'post_target',
        title: 'Export Data',
        voteCount: 5,
        boardId: 'b1',
        boardName: 'Features',
        similarity: 0.85,
      },
    ])
    // For checkRawItemCompletion
    mockSignalFindMany.mockResolvedValueOnce([{ id: signalId, processingState: 'completed' }])

    const { interpretSignal } = await import('../interpretation.service')
    await interpretSignal(signalId)

    expect(mockCreateMergeSuggestion).toHaveBeenCalledTimes(1)
    expect(mockCreateMergeSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        targetPostId: 'post_target',
        similarityScore: 0.85,
      })
    )
  })

  it('should not create suggestions for quackback post with no match', async () => {
    mockSignalFindFirst.mockResolvedValueOnce(baseSignal)
    mockEmbedSignal.mockResolvedValueOnce(mockEmbedding)
    mockRawItemFindFirst.mockResolvedValueOnce({
      sourceType: 'quackback',
      externalId: 'post:post_src',
      content: { text: 'test' },
    })
    mockPostFindFirst.mockResolvedValueOnce({ embedding: '[0.1,0.2,0.3]' })
    mockFindSimilarPosts.mockResolvedValueOnce([])
    mockSignalFindMany.mockResolvedValueOnce([{ id: signalId, processingState: 'completed' }])

    const { interpretSignal } = await import('../interpretation.service')
    await interpretSignal(signalId)

    expect(mockCreateMergeSuggestion).not.toHaveBeenCalled()
    expect(mockCreatePostSuggestion).not.toHaveBeenCalled()
  })

  it('should create merge suggestion for external source above threshold', async () => {
    mockSignalFindFirst.mockResolvedValueOnce(baseSignal)
    mockEmbedSignal.mockResolvedValueOnce(mockEmbedding)
    mockRawItemFindFirst.mockResolvedValueOnce({
      sourceType: 'intercom',
      externalId: 'conv_123',
      content: { text: 'test' },
    })
    mockFindSimilarPosts.mockResolvedValueOnce([
      {
        id: 'post_target',
        title: 'Export',
        voteCount: 3,
        boardId: 'b1',
        boardName: 'Features',
        similarity: 0.85,
      },
    ])
    mockSignalFindMany.mockResolvedValueOnce([{ id: signalId, processingState: 'completed' }])

    const { interpretSignal } = await import('../interpretation.service')
    await interpretSignal(signalId)

    expect(mockCreateMergeSuggestion).toHaveBeenCalledTimes(1)
  })

  it('should create post suggestion for external source with no match', async () => {
    mockSignalFindFirst.mockResolvedValueOnce(baseSignal)
    mockEmbedSignal.mockResolvedValueOnce(mockEmbedding)
    mockRawItemFindFirst.mockResolvedValueOnce({
      sourceType: 'intercom',
      externalId: 'conv_123',
      content: { subject: 'CSV', text: 'We need CSV export' },
    })
    mockFindSimilarPosts.mockResolvedValueOnce([])

    // Mock LLM for suggestion generation
    mockOpenAI.chat.completions.create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: 'Add CSV Export',
              body: 'Users need CSV export for data',
              boardId: 'board_1',
              reasoning: 'Clear feature request',
            }),
          },
        },
      ],
    })

    mockSignalFindMany.mockResolvedValueOnce([{ id: signalId, processingState: 'completed' }])

    const { interpretSignal } = await import('../interpretation.service')
    await interpretSignal(signalId)

    expect(mockCreatePostSuggestion).toHaveBeenCalledTimes(1)
    expect(mockCreatePostSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedTitle: 'Add CSV Export',
      })
    )
  })

  it('should use fallback when LLM fails for create_post suggestion', async () => {
    mockSignalFindFirst.mockResolvedValueOnce(baseSignal)
    mockEmbedSignal.mockResolvedValueOnce(mockEmbedding)
    mockRawItemFindFirst.mockResolvedValueOnce({
      sourceType: 'intercom',
      externalId: 'conv_123',
      content: { subject: 'CSV', text: 'We need CSV' },
    })
    mockFindSimilarPosts.mockResolvedValueOnce([])
    mockOpenAI.chat.completions.create.mockRejectedValueOnce(new Error('API down'))
    mockSignalFindMany.mockResolvedValueOnce([{ id: signalId, processingState: 'completed' }])

    const { interpretSignal } = await import('../interpretation.service')
    await interpretSignal(signalId)

    expect(mockCreatePostSuggestion).toHaveBeenCalledTimes(1)
    // Fallback uses signal summary as title
    expect(mockCreatePostSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedTitle: expect.stringContaining('CSV export needed'),
      })
    )
  })

  it('should throw when signal not found', async () => {
    mockSignalFindFirst.mockResolvedValueOnce(null)

    const { interpretSignal } = await import('../interpretation.service')
    await expect(interpretSignal(signalId)).rejects.toThrow('not found')
  })

  it('should skip signal in wrong state', async () => {
    mockSignalFindFirst.mockResolvedValueOnce({
      ...baseSignal,
      processingState: 'completed',
    })

    const { interpretSignal } = await import('../interpretation.service')
    await interpretSignal(signalId)

    // Should not embed or create suggestions
    expect(mockEmbedSignal).not.toHaveBeenCalled()
  })

  it('should mark raw item as completed when all signals done', async () => {
    mockSignalFindFirst.mockResolvedValueOnce(baseSignal)
    mockEmbedSignal.mockResolvedValueOnce(mockEmbedding)
    mockRawItemFindFirst.mockResolvedValueOnce({
      sourceType: 'quackback',
      externalId: 'post:post_1',
      content: { text: 'test' },
    })
    mockPostFindFirst.mockResolvedValueOnce({ embedding: null })
    mockFindSimilarPosts.mockResolvedValueOnce([])
    mockSignalFindMany.mockResolvedValueOnce([{ id: signalId, processingState: 'completed' }])

    const { interpretSignal } = await import('../interpretation.service')
    await interpretSignal(signalId)

    // Should update raw item to completed
    const completedUpdate = updateSetCalls.find(
      (call) => (call[0] as Record<string, unknown>).processingState === 'completed'
    )
    expect(completedUpdate).toBeDefined()
  })

  it('should mark raw item as failed when some signals failed', async () => {
    mockSignalFindFirst.mockResolvedValueOnce(baseSignal)
    mockEmbedSignal.mockResolvedValueOnce(mockEmbedding)
    mockRawItemFindFirst.mockResolvedValueOnce({
      sourceType: 'quackback',
      externalId: 'post:post_1',
      content: { text: 'test' },
    })
    mockPostFindFirst.mockResolvedValueOnce({ embedding: null })
    mockFindSimilarPosts.mockResolvedValueOnce([])
    mockSignalFindMany.mockResolvedValueOnce([
      { id: signalId, processingState: 'completed' },
      { id: 'signal_other' as FeedbackSignalId, processingState: 'failed' },
    ])

    const { interpretSignal } = await import('../interpretation.service')
    await interpretSignal(signalId)

    const failedUpdate = updateSetCalls.find(
      (call) => (call[0] as Record<string, unknown>).processingState === 'failed'
    )
    expect(failedUpdate).toBeDefined()
  })

  it('should parse pgvector string embedding from post', async () => {
    mockSignalFindFirst.mockResolvedValueOnce(baseSignal)
    mockEmbedSignal.mockResolvedValueOnce(mockEmbedding)
    mockRawItemFindFirst.mockResolvedValueOnce({
      sourceType: 'quackback',
      externalId: 'post:post_src',
      content: { text: 'test' },
    })
    // pgvector returns embedding as string
    mockPostFindFirst.mockResolvedValueOnce({
      embedding: '[0.5,0.6,0.7]',
    })
    mockFindSimilarPosts.mockResolvedValueOnce([])
    mockSignalFindMany.mockResolvedValueOnce([{ id: signalId, processingState: 'completed' }])

    const { interpretSignal } = await import('../interpretation.service')
    await interpretSignal(signalId)

    // findSimilarPosts should be called with the parsed post embedding, not signal embedding
    expect(mockFindSimilarPosts).toHaveBeenCalledWith(
      [0.5, 0.6, 0.7],
      expect.objectContaining({ excludePostId: 'post_src' })
    )
  })
})
