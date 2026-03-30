/**
 * Tests for interpretation service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FeedbackSignalId, RawFeedbackItemId } from '@featurepool/ids'

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
  withRetry: vi.fn((fn: () => Promise<unknown>) =>
    fn().then((result: unknown) => ({ result, retryCount: 0 }))
  ),
}))

vi.mock('@/lib/server/domains/ai/usage-log', () => ({
  withUsageLogging: vi.fn((_params: unknown, fn: () => Promise<{ result: unknown }>) =>
    fn().then(({ result }) => result)
  ),
}))

vi.mock('../pipeline-log', () => ({
  logPipelineEvent: vi.fn().mockResolvedValue(undefined),
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

  it('should only embed for featurepool post (no suggestions)', async () => {
    mockSignalFindFirst.mockResolvedValueOnce(baseSignal)
    mockEmbedSignal.mockResolvedValueOnce(mockEmbedding)
    mockRawItemFindFirst.mockResolvedValueOnce({
      sourceType: 'featurepool',
      externalId: 'post:post_src',
      content: { text: 'test' },
    })
    // For checkRawItemCompletion
    mockSignalFindMany.mockResolvedValueOnce([{ id: signalId, processingState: 'completed' }])

    const { interpretSignal } = await import('../interpretation.service')
    await interpretSignal(signalId)

    // Featurepool posts only get embedded — duplicate detection handled by merge_suggestions system
    expect(mockEmbedSignal).toHaveBeenCalledWith(signalId, rawItemId)
    expect(mockFindSimilarPosts).not.toHaveBeenCalled()
    expect(mockCreatePostSuggestion).not.toHaveBeenCalled()

    // Should log skipped_featurepool pipeline event
    const { logPipelineEvent } = await import('../pipeline-log')
    expect(logPipelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'interpretation.skipped_featurepool',
        rawFeedbackItemId: rawItemId,
        signalId,
        detail: {},
      })
    )
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

    // Verify pipeline logging
    const { logPipelineEvent } = await import('../pipeline-log')
    expect(logPipelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'interpretation.similar_posts',
        detail: expect.objectContaining({
          bestSimilarity: 0.85,
          threshold: 0.8,
        }),
      })
    )
    expect(logPipelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'interpretation.suggestion_created',
        detail: expect.objectContaining({
          suggestionType: 'vote_on_post',
          sourceType: 'intercom',
        }),
      })
    )

    // Verify AI usage logging for suggestion generation
    const { withUsageLogging } = await import('@/lib/server/domains/ai/usage-log')
    expect(withUsageLogging).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineStep: 'suggestion',
        rawFeedbackItemId: rawItemId,
        signalId,
        metadata: expect.objectContaining({ suggestionType: 'vote_on_post' }),
      }),
      expect.any(Function),
      expect.any(Function)
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

    // Should log similar_posts and suggestion_created events
    const { logPipelineEvent } = await import('../pipeline-log')
    expect(logPipelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'interpretation.similar_posts',
        detail: expect.objectContaining({
          postMatches: [],
          bestSimilarity: null,
        }),
      })
    )
    expect(logPipelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'interpretation.suggestion_created',
        detail: expect.objectContaining({
          suggestionType: 'create_post',
          sourceType: 'intercom',
          usedFallback: false,
        }),
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

    // Should log suggestion_created with usedFallback=true
    const { logPipelineEvent } = await import('../pipeline-log')
    expect(logPipelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'interpretation.suggestion_created',
        detail: expect.objectContaining({
          usedFallback: true,
        }),
      })
    )
  })

  it('should throw when signal not found', async () => {
    mockSignalFindFirst.mockResolvedValueOnce(null)

    const { interpretSignal } = await import('../interpretation.service')
    await expect(interpretSignal(signalId)).rejects.toThrow('not found')
  })
})
