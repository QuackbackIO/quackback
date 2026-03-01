/**
 * Tests for merge assessment service (LLM verification + directionality).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostId } from '@quackback/ids'
import type { MergeCandidate } from '../merge-search.service'

// --- Mock OpenAI ---
const mockCreate = vi.fn()
vi.mock('@/lib/server/domains/ai/config', () => ({
  getOpenAI: vi.fn(() => ({
    chat: {
      completions: { create: (...args: unknown[]) => mockCreate(...args) },
    },
  })),
}))

vi.mock('@/lib/server/domains/ai/retry', () => ({
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}))

vi.mock('@/lib/server/domains/ai/parse', () => ({
  stripCodeFences: vi.fn((text: string) => text),
}))

describe('merge-assessment.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const sourcePost = {
    id: 'post_source1' as PostId,
    title: 'Add dark mode',
    content: 'Users want a dark theme option',
  }

  const candidates: MergeCandidate[] = [
    {
      postId: 'post_cand1' as PostId,
      title: 'Dark theme support',
      content: 'Please add dark mode',
      voteCount: 10,
      commentCount: 3,
      createdAt: new Date('2025-01-01'),
      vectorScore: 0.85,
      ftsScore: 0.6,
      hybridScore: 0.93,
    },
    {
      postId: 'post_cand2' as PostId,
      title: 'Night mode toggle',
      content: 'Dark mode would be great',
      voteCount: 2,
      commentCount: 0,
      createdAt: new Date('2025-02-01'),
      vectorScore: 0.5,
      ftsScore: 0.3,
      hybridScore: 0.59,
    },
  ]

  describe('assessMergeCandidates', () => {
    it('should return confirmed duplicates above confidence threshold', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify([
                {
                  candidatePostId: 'post_cand1',
                  isDuplicate: true,
                  confidence: 0.9,
                  reasoning: 'Both request dark mode',
                },
                {
                  candidatePostId: 'post_cand2',
                  isDuplicate: true,
                  confidence: 0.4,
                  reasoning: 'Related but different',
                },
              ]),
            },
          },
        ],
      })

      const { assessMergeCandidates } = await import('../merge-assessment.service')
      const results = await assessMergeCandidates(sourcePost, candidates)

      expect(results).toHaveLength(1)
      expect(results[0].candidatePostId).toBe('post_cand1')
      expect(results[0].confidence).toBe(0.9)
      expect(results[0].reasoning).toBe('Both request dark mode')
    })

    it('should handle { results: [...] } JSON shape', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                results: [
                  {
                    candidatePostId: 'post_cand1',
                    isDuplicate: true,
                    confidence: 0.8,
                    reasoning: 'Same feature request',
                  },
                ],
              }),
            },
          },
        ],
      })

      const { assessMergeCandidates } = await import('../merge-assessment.service')
      const results = await assessMergeCandidates(sourcePost, candidates)

      expect(results).toHaveLength(1)
      expect(results[0].candidatePostId).toBe('post_cand1')
    })

    it('should filter out confidence below 0.75 threshold', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify([
                {
                  candidatePostId: 'post_cand1',
                  isDuplicate: true,
                  confidence: 0.7,
                  reasoning: 'Somewhat related',
                },
              ]),
            },
          },
        ],
      })

      const { assessMergeCandidates } = await import('../merge-assessment.service')
      const results = await assessMergeCandidates(sourcePost, candidates)

      expect(results).toHaveLength(0)
    })

    it('should filter out isDuplicate === false', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify([
                {
                  candidatePostId: 'post_cand1',
                  isDuplicate: false,
                  confidence: 0.9,
                  reasoning: 'Different requests',
                },
              ]),
            },
          },
        ],
      })

      const { assessMergeCandidates } = await import('../merge-assessment.service')
      const results = await assessMergeCandidates(sourcePost, candidates)

      expect(results).toHaveLength(0)
    })

    it('should return empty for empty candidates', async () => {
      const { assessMergeCandidates } = await import('../merge-assessment.service')
      const results = await assessMergeCandidates(sourcePost, [])

      expect(results).toHaveLength(0)
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('should handle invalid JSON response gracefully', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'not json at all' } }],
      })

      const { assessMergeCandidates } = await import('../merge-assessment.service')
      const results = await assessMergeCandidates(sourcePost, candidates)

      expect(results).toHaveLength(0)
    })

    it('should handle empty LLM response', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: null } }],
      })

      const { assessMergeCandidates } = await import('../merge-assessment.service')
      const results = await assessMergeCandidates(sourcePost, candidates)

      expect(results).toHaveLength(0)
    })
  })

  describe('determineDirection', () => {
    it('should pick higher voteCount as target', async () => {
      const { determineDirection } = await import('../merge-assessment.service')
      const result = determineDirection(
        {
          id: 'post_a' as PostId,
          voteCount: 5,
          commentCount: 1,
          createdAt: new Date('2025-01-01'),
        },
        {
          id: 'post_b' as PostId,
          voteCount: 20,
          commentCount: 1,
          createdAt: new Date('2025-02-01'),
        }
      )

      expect(result.targetPostId).toBe('post_b')
      expect(result.sourcePostId).toBe('post_a')
    })

    it('should tiebreak by commentCount', async () => {
      const { determineDirection } = await import('../merge-assessment.service')
      const result = determineDirection(
        {
          id: 'post_a' as PostId,
          voteCount: 5,
          commentCount: 10,
          createdAt: new Date('2025-02-01'),
        },
        { id: 'post_b' as PostId, voteCount: 5, commentCount: 3, createdAt: new Date('2025-01-01') }
      )

      expect(result.targetPostId).toBe('post_a')
      expect(result.sourcePostId).toBe('post_b')
    })

    it('should tiebreak by older createdAt', async () => {
      const { determineDirection } = await import('../merge-assessment.service')
      const result = determineDirection(
        {
          id: 'post_a' as PostId,
          voteCount: 5,
          commentCount: 2,
          createdAt: new Date('2025-01-01'),
        },
        { id: 'post_b' as PostId, voteCount: 5, commentCount: 2, createdAt: new Date('2025-06-01') }
      )

      // Older post (post_a) becomes target
      expect(result.targetPostId).toBe('post_a')
      expect(result.sourcePostId).toBe('post_b')
    })
  })
})
