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
  boards: {},
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}))

const mockEmbedSignal = vi.fn()
const mockFindSimilarPosts = vi.fn()
const mockFindSimilarPendingSuggestions = vi.fn()

vi.mock('../embedding.service', () => ({
  embedSignal: (...args: unknown[]) => mockEmbedSignal(...args),
  findSimilarPosts: (...args: unknown[]) => mockFindSimilarPosts(...args),
  findSimilarPendingSuggestions: (...args: unknown[]) => mockFindSimilarPendingSuggestions(...args),
}))

const mockCreatePostSuggestion = vi.fn()
const mockCreateVoteSuggestion = vi.fn()

vi.mock('../suggestion.service', () => ({
  createPostSuggestion: (...args: unknown[]) => mockCreatePostSuggestion(...args),
  createVoteSuggestion: (...args: unknown[]) => mockCreateVoteSuggestion(...args),
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

  it('should only embed for quackback post (no suggestions)', async () => {
    mockSignalFindFirst.mockResolvedValueOnce(baseSignal)
    mockEmbedSignal.mockResolvedValueOnce(mockEmbedding)
    mockRawItemFindFirst.mockResolvedValueOnce({
      sourceType: 'quackback',
      externalId: 'post:post_src',
      content: { text: 'test' },
    })
    // For checkRawItemCompletion
    mockSignalFindMany.mockResolvedValueOnce([{ id: signalId, processingState: 'completed' }])

    const { interpretSignal } = await import('../interpretation.service')
    await interpretSignal(signalId)

    // Quackback posts only get embedded — duplicate detection handled by merge_suggestions system
    expect(mockEmbedSignal).toHaveBeenCalledWith(signalId)
    expect(mockFindSimilarPosts).not.toHaveBeenCalled()
    expect(mockCreatePostSuggestion).not.toHaveBeenCalled()
  })

  it('should create vote_on_post suggestion for external source with high-similarity match', async () => {
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

    // Mock LLM for suggestion generation (vote suggestions also generate title/body)
    mockOpenAI.chat.completions.create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: 'Add CSV Export',
              body: 'Users need CSV export',
              boardId: 'board_1',
              reasoning: 'Feature request',
            }),
          },
        },
      ],
    })

    mockSignalFindMany.mockResolvedValueOnce([{ id: signalId, processingState: 'completed' }])

    const { interpretSignal } = await import('../interpretation.service')
    await interpretSignal(signalId)

    expect(mockCreatePostSuggestion).not.toHaveBeenCalled()
    expect(mockCreateVoteSuggestion).toHaveBeenCalledTimes(1)
    expect(mockCreateVoteSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        resultPostId: 'post_target',
        similarPosts: expect.arrayContaining([
          expect.objectContaining({ postId: 'post_target', similarity: 0.85 }),
        ]),
      })
    )
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
    mockFindSimilarPendingSuggestions.mockResolvedValueOnce([])

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
    mockFindSimilarPendingSuggestions.mockResolvedValueOnce([])
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

  it('should skip creating suggestion when similar pending suggestion exists', async () => {
    mockSignalFindFirst.mockResolvedValueOnce(baseSignal)
    mockEmbedSignal.mockResolvedValueOnce(mockEmbedding)
    mockRawItemFindFirst.mockResolvedValueOnce({
      sourceType: 'intercom',
      externalId: 'conv_789',
      content: { subject: 'CSV', text: 'We need CSV export' },
    })
    mockFindSimilarPosts.mockResolvedValueOnce([]) // no matching posts
    mockFindSimilarPendingSuggestions.mockResolvedValueOnce([
      {
        id: 'existing_suggestion_1',
        rawFeedbackItemId: 'other_raw_item',
        suggestedTitle: 'Add CSV Export',
        boardId: 'board_1',
        similarity: 0.92,
      },
    ])
    mockSignalFindMany.mockResolvedValueOnce([{ id: signalId, processingState: 'completed' }])

    const { interpretSignal } = await import('../interpretation.service')
    await interpretSignal(signalId)

    // Should NOT create any suggestion — the existing pending one covers this need
    expect(mockCreatePostSuggestion).not.toHaveBeenCalled()
    expect(mockCreateVoteSuggestion).not.toHaveBeenCalled()

    // Should still check pending suggestions with the right params
    expect(mockFindSimilarPendingSuggestions).toHaveBeenCalledWith(
      mockEmbedding,
      expect.objectContaining({
        limit: 1,
        minSimilarity: 0.8,
        excludeRawItemId: rawItemId,
      })
    )
  })

  it('should use signal embedding for external source similarity search', async () => {
    mockSignalFindFirst.mockResolvedValueOnce(baseSignal)
    mockEmbedSignal.mockResolvedValueOnce(mockEmbedding)
    mockRawItemFindFirst.mockResolvedValueOnce({
      sourceType: 'intercom',
      externalId: 'conv_456',
      content: { subject: 'CSV', text: 'We need CSV export' },
    })
    mockFindSimilarPosts.mockResolvedValueOnce([])
    mockFindSimilarPendingSuggestions.mockResolvedValueOnce([])

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

    // findSimilarPosts should be called with the signal embedding and lowered threshold
    expect(mockFindSimilarPosts).toHaveBeenCalledWith(
      mockEmbedding,
      expect.objectContaining({ minSimilarity: 0.55 })
    )
  })
})
