/**
 * Tests for merge check orchestrator (per-post check + sweep).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostId } from '@quackback/ids'

// --- Mock dependencies ---
const mockFindMergeCandidates = vi.fn()
const mockAssessMergeCandidates = vi.fn()
const mockDetermineDirection = vi.fn()
const mockCreateMergeSuggestion = vi.fn()
const mockExpireStale = vi.fn()

vi.mock('../merge-search.service', () => ({
  findMergeCandidates: (...args: unknown[]) => mockFindMergeCandidates(...args),
}))

vi.mock('../merge-assessment.service', () => ({
  assessMergeCandidates: (...args: unknown[]) => mockAssessMergeCandidates(...args),
  determineDirection: (...args: unknown[]) => mockDetermineDirection(...args),
}))

vi.mock('../merge-suggestion.service', () => ({
  createMergeSuggestion: (...args: unknown[]) => mockCreateMergeSuggestion(...args),
  expireStaleMergeSuggestions: (...args: unknown[]) => mockExpireStale(...args),
}))

const mockPostFindFirst = vi.fn()
const mockUpdateSet = vi.fn()
const mockUpdateWhere = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      posts: {
        findFirst: (...args: unknown[]) => mockPostFindFirst(...args),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: (...args: unknown[]) => {
        mockUpdateSet(...args)
        return {
          where: (...wargs: unknown[]) => {
            mockUpdateWhere(...wargs)
            return Promise.resolve()
          },
        }
      },
    })),
  },
  posts: {
    id: 'id',
    deletedAt: 'deleted_at',
    canonicalPostId: 'canonical_post_id',
    embedding: 'embedding',
    mergeCheckedAt: 'merge_checked_at',
    updatedAt: 'updated_at',
  },
  and: vi.fn(),
  or: vi.fn(),
  isNull: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}))

vi.mock('@/lib/server/domains/ai/config', () => ({
  getOpenAI: vi.fn(() => ({})),
}))

describe('merge-check.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExpireStale.mockResolvedValue(0)
  })

  const postId = 'post_test1' as PostId

  describe('checkPostForMergeCandidates', () => {
    it('should bail if post not found', async () => {
      mockPostFindFirst.mockResolvedValueOnce(null)

      const { checkPostForMergeCandidates } = await import('../merge-check.service')
      await checkPostForMergeCandidates(postId)

      expect(mockFindMergeCandidates).not.toHaveBeenCalled()
    })

    it('should bail if post is deleted', async () => {
      mockPostFindFirst.mockResolvedValueOnce({
        id: postId,
        deletedAt: new Date(),
        canonicalPostId: null,
        embedding: [0.1, 0.2],
      })

      const { checkPostForMergeCandidates } = await import('../merge-check.service')
      await checkPostForMergeCandidates(postId)

      expect(mockFindMergeCandidates).not.toHaveBeenCalled()
    })

    it('should bail if post has no embedding', async () => {
      mockPostFindFirst.mockResolvedValueOnce({
        id: postId,
        deletedAt: null,
        canonicalPostId: null,
        embedding: null,
      })

      const { checkPostForMergeCandidates } = await import('../merge-check.service')
      await checkPostForMergeCandidates(postId)

      expect(mockFindMergeCandidates).not.toHaveBeenCalled()
    })

    it('should bail if post is already merged', async () => {
      mockPostFindFirst.mockResolvedValueOnce({
        id: postId,
        deletedAt: null,
        canonicalPostId: 'post_canonical' as PostId,
        embedding: [0.1, 0.2],
      })

      const { checkPostForMergeCandidates } = await import('../merge-check.service')
      await checkPostForMergeCandidates(postId)

      expect(mockFindMergeCandidates).not.toHaveBeenCalled()
    })

    it('should update mergeCheckedAt even with no candidates', async () => {
      mockPostFindFirst.mockResolvedValueOnce({
        id: postId,
        title: 'Test',
        content: 'Test content',
        voteCount: 5,
        commentCount: 2,
        createdAt: new Date(),
        deletedAt: null,
        canonicalPostId: null,
        embedding: [0.1, 0.2],
      })
      mockFindMergeCandidates.mockResolvedValueOnce([])

      const { checkPostForMergeCandidates } = await import('../merge-check.service')
      await checkPostForMergeCandidates(postId)

      expect(mockFindMergeCandidates).toHaveBeenCalledWith(postId)
      expect(mockAssessMergeCandidates).not.toHaveBeenCalled()
      // Should still update mergeCheckedAt
      expect(mockUpdateSet).toHaveBeenCalled()
    })

    it('should create suggestions for confirmed duplicates', async () => {
      const candidatePostId = 'post_cand1' as PostId
      mockPostFindFirst.mockResolvedValueOnce({
        id: postId,
        title: 'Add dark mode',
        content: 'Users want dark mode',
        voteCount: 5,
        commentCount: 2,
        createdAt: new Date('2025-01-01'),
        deletedAt: null,
        canonicalPostId: null,
        embedding: [0.1, 0.2],
      })

      mockFindMergeCandidates.mockResolvedValueOnce([
        {
          postId: candidatePostId,
          title: 'Dark theme',
          content: 'Dark theme please',
          voteCount: 20,
          commentCount: 5,
          createdAt: new Date('2025-02-01'),
          vectorScore: 0.85,
          ftsScore: 0.6,
          hybridScore: 0.93,
        },
      ])

      mockAssessMergeCandidates.mockResolvedValueOnce([
        {
          candidatePostId,
          confidence: 0.9,
          reasoning: 'Both about dark mode',
        },
      ])

      mockDetermineDirection.mockReturnValueOnce({
        sourcePostId: postId,
        targetPostId: candidatePostId,
      })

      const { checkPostForMergeCandidates } = await import('../merge-check.service')
      await checkPostForMergeCandidates(postId)

      expect(mockCreateMergeSuggestion).toHaveBeenCalledWith(
        expect.objectContaining({
          sourcePostId: postId,
          targetPostId: candidatePostId,
          vectorScore: 0.85,
          ftsScore: 0.6,
          hybridScore: 0.93,
          llmConfidence: 0.9,
          llmReasoning: 'Both about dark mode',
          llmModel: 'google/gemini-2.5-flash',
        })
      )
    })

    it('should create only one suggestion for the best match when multiple confirmed', async () => {
      const cand1 = 'post_cand1' as PostId
      const cand2 = 'post_cand2' as PostId
      mockPostFindFirst.mockResolvedValueOnce({
        id: postId,
        title: 'Add dark mode',
        content: 'Users want dark mode',
        voteCount: 5,
        commentCount: 2,
        createdAt: new Date('2025-01-01'),
        deletedAt: null,
        canonicalPostId: null,
        embedding: [0.1, 0.2],
      })

      mockFindMergeCandidates.mockResolvedValueOnce([
        {
          postId: cand1,
          title: 'Dark theme',
          content: 'Dark theme please',
          voteCount: 20,
          commentCount: 5,
          createdAt: new Date('2025-02-01'),
          vectorScore: 0.85,
          ftsScore: 0.6,
          hybridScore: 0.93,
        },
        {
          postId: cand2,
          title: 'Night mode',
          content: 'Night mode toggle',
          voteCount: 10,
          commentCount: 3,
          createdAt: new Date('2025-03-01'),
          vectorScore: 0.7,
          ftsScore: 0.4,
          hybridScore: 0.82,
        },
      ])

      // LLM confirms both, but cand1 has higher confidence
      mockAssessMergeCandidates.mockResolvedValueOnce([
        { candidatePostId: cand1, confidence: 0.95, reasoning: 'Exact same request' },
        { candidatePostId: cand2, confidence: 0.8, reasoning: 'Also about dark mode' },
      ])

      mockDetermineDirection.mockReturnValueOnce({
        sourcePostId: postId,
        targetPostId: cand1,
      })

      const { checkPostForMergeCandidates } = await import('../merge-check.service')
      await checkPostForMergeCandidates(postId)

      // Should only create ONE suggestion (the best match)
      expect(mockCreateMergeSuggestion).toHaveBeenCalledTimes(1)
      expect(mockCreateMergeSuggestion).toHaveBeenCalledWith(
        expect.objectContaining({
          llmConfidence: 0.95,
          hybridScore: 0.93,
        })
      )
    })

    it('should not create suggestions when LLM rejects all candidates', async () => {
      mockPostFindFirst.mockResolvedValueOnce({
        id: postId,
        title: 'Test post',
        content: 'Test content',
        voteCount: 1,
        commentCount: 0,
        createdAt: new Date(),
        deletedAt: null,
        canonicalPostId: null,
        embedding: [0.1, 0.2],
      })

      mockFindMergeCandidates.mockResolvedValueOnce([
        {
          postId: 'post_cand2' as PostId,
          title: 'Unrelated post',
          content: 'Something else',
          voteCount: 3,
          commentCount: 1,
          createdAt: new Date(),
          vectorScore: 0.5,
          ftsScore: 0.3,
          hybridScore: 0.59,
        },
      ])

      mockAssessMergeCandidates.mockResolvedValueOnce([])

      const { checkPostForMergeCandidates } = await import('../merge-check.service')
      await checkPostForMergeCandidates(postId)

      expect(mockCreateMergeSuggestion).not.toHaveBeenCalled()
    })
  })
})
