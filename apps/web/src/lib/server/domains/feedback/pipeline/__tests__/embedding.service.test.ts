/**
 * Tests for embedding service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FeedbackSignalId } from '@quackback/ids'

// --- Mock tracking ---
const updateSetCalls: unknown[][] = []
const executeCalls: unknown[][] = []

function createUpdateChain() {
  const chain: Record<string, unknown> = {}
  chain.set = vi.fn((...args: unknown[]) => {
    updateSetCalls.push(args)
    return chain
  })
  chain.where = vi.fn().mockResolvedValue([])
  return chain
}

const mockFindFirst = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      feedbackSignals: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
    },
    update: vi.fn(() => createUpdateChain()),
    execute: vi.fn((...args: unknown[]) => {
      executeCalls.push(args)
      return Promise.resolve({ rows: [] })
    }),
  },
  eq: vi.fn(),
  feedbackSignals: {
    id: 'id',
    embedding: 'embedding',
    embeddingModel: 'embedding_model',
    embeddingUpdatedAt: 'embedding_updated_at',
  },
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}))

vi.mock('@/lib/server/utils/execute-rows', () => ({
  getExecuteRows: vi.fn((result: { rows?: unknown[] }) => result.rows ?? []),
}))

const mockOpenAI = {
  embeddings: {
    create: vi.fn(),
  },
}

vi.mock('@/lib/server/domains/ai/config', () => ({
  getOpenAI: vi.fn(() => mockOpenAI),
}))

vi.mock('@/lib/server/domains/ai/retry', () => ({
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}))

describe('embedding.service', () => {
  beforeEach(() => {
    updateSetCalls.length = 0
    executeCalls.length = 0
    vi.clearAllMocks()
  })

  const signalId = 'signal_123' as FeedbackSignalId
  const mockEmbedding = [0.1, 0.2, 0.3, 0.4]

  describe('embedSignal', () => {
    it('should embed signal summary and store result', async () => {
      mockFindFirst.mockResolvedValueOnce({
        summary: 'Users want CSV export',
        implicitNeed: 'Data portability',
      })
      mockOpenAI.embeddings.create.mockResolvedValueOnce({
        data: [{ embedding: mockEmbedding }],
      })

      const { embedSignal } = await import('../embedding.service')
      const result = await embedSignal(signalId)

      expect(result).toEqual(mockEmbedding)
      expect(mockOpenAI.embeddings.create).toHaveBeenCalled()
      // Should update DB with embedding
      expect(updateSetCalls.length).toBe(1)
    })

    it('should use summary only when no implicitNeed', async () => {
      mockFindFirst.mockResolvedValueOnce({
        summary: 'Login page crashes',
        implicitNeed: null,
      })
      mockOpenAI.embeddings.create.mockResolvedValueOnce({
        data: [{ embedding: mockEmbedding }],
      })

      const { embedSignal } = await import('../embedding.service')
      const result = await embedSignal(signalId)

      expect(result).toEqual(mockEmbedding)
      // Verify the input text doesn't have "null"
      const createCall = mockOpenAI.embeddings.create.mock.calls[0][0]
      expect(createCall.input).not.toContain('null')
    })

    it('should return null when signal not found', async () => {
      mockFindFirst.mockResolvedValueOnce(null)

      const { embedSignal } = await import('../embedding.service')
      await expect(embedSignal(signalId)).rejects.toThrow('not found')
    })

    it('should return null when AI not configured', async () => {
      const { getOpenAI } = await import('@/lib/server/domains/ai/config')
      vi.mocked(getOpenAI).mockReturnValueOnce(null)

      const { embedSignal } = await import('../embedding.service')
      const result = await embedSignal(signalId)

      expect(result).toBeNull()
      expect(updateSetCalls.length).toBe(0) // No DB write
    })
  })

  describe('findSimilarPosts', () => {
    it('should return matching posts with similarity scores', async () => {
      const { db } = await import('@/lib/server/db')
      vi.mocked(db.execute).mockResolvedValueOnce({
        rows: [
          {
            id: 'post_1',
            title: 'CSV Export',
            vote_count: 5,
            board_id: 'b1',
            board_name: 'Features',
            similarity: 0.85,
          },
          {
            id: 'post_2',
            title: 'Data Export',
            vote_count: 3,
            board_id: 'b1',
            board_name: 'Features',
            similarity: 0.8,
          },
        ],
      } as any)

      const { findSimilarPosts } = await import('../embedding.service')
      const results = await findSimilarPosts(mockEmbedding, { minSimilarity: 0.75 })

      expect(results).toHaveLength(2)
      expect(results[0].id).toBe('post_1')
      expect(results[0].similarity).toBe(0.85)
      expect(results[0].voteCount).toBe(5)
    })

    it('should return empty array when no matches', async () => {
      const { db } = await import('@/lib/server/db')
      vi.mocked(db.execute).mockResolvedValueOnce({ rows: [] } as any)

      const { findSimilarPosts } = await import('../embedding.service')
      const results = await findSimilarPosts(mockEmbedding)

      expect(results).toEqual([])
    })
  })
})
