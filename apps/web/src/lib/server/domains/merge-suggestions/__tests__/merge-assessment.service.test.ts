/**
 * Tests for merge assessment service (LLM verification + directionality).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostId } from '@quackback/ids'
import type { MergeCandidate } from '../merge-search.service'

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

// Tier-limit gate runs before the LLM call. Stub the resolver so it
// returns OSS defaults (everything unlimited) — these tests exercise
// the merge logic, not the gate.
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(async () => ({
    maxBoards: null,
    maxPosts: null,
    maxTeamSeats: null,
    aiTokensPerMonth: null,
    apiRequestsPerMonth: null,
    apiRequestsPerMinute: null,
    features: {
      customDomain: true,
      customOidcProvider: true,
      ipAllowlist: true,
      webhooks: true,
      mcpServer: true,
      analyticsExports: true,
    },
  })),
}))

describe('merge-assessment.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfig.openaiApiKey = 'test-key'
    mockConfig.openaiBaseUrl = 'http://localhost:9999/v1'
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
      // With outputSchema, chat() always resolves the { results: [...] }
      // object shape — the schema forces the provider to emit it.
      mockChat.mockResolvedValueOnce({
        results: [
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
        ],
      })

      const { assessMergeCandidates } = await import('../merge-assessment.service')
      const results = await assessMergeCandidates(sourcePost, candidates, 'test-model')

      expect(results).toHaveLength(1)
      expect(results[0].candidatePostId).toBe('post_cand1')
      expect(results[0].confidence).toBe(0.9)
      expect(results[0].reasoning).toBe('Both request dark mode')
    })

    it('should handle the { results: [...] } JSON shape', async () => {
      mockChat.mockResolvedValueOnce({
        results: [
          {
            candidatePostId: 'post_cand1',
            isDuplicate: true,
            confidence: 0.8,
            reasoning: 'Same feature request',
          },
        ],
      })

      const { assessMergeCandidates } = await import('../merge-assessment.service')
      const results = await assessMergeCandidates(sourcePost, candidates, 'test-model')

      expect(results).toHaveLength(1)
      expect(results[0].candidatePostId).toBe('post_cand1')
    })

    it('should filter out confidence below 0.75 threshold', async () => {
      mockChat.mockResolvedValueOnce({
        results: [
          {
            candidatePostId: 'post_cand1',
            isDuplicate: true,
            confidence: 0.7,
            reasoning: 'Somewhat related',
          },
        ],
      })

      const { assessMergeCandidates } = await import('../merge-assessment.service')
      const results = await assessMergeCandidates(sourcePost, candidates, 'test-model')

      expect(results).toHaveLength(0)
    })

    it('should filter out isDuplicate === false', async () => {
      mockChat.mockResolvedValueOnce({
        results: [
          {
            candidatePostId: 'post_cand1',
            isDuplicate: false,
            confidence: 0.9,
            reasoning: 'Different requests',
          },
        ],
      })

      const { assessMergeCandidates } = await import('../merge-assessment.service')
      const results = await assessMergeCandidates(sourcePost, candidates, 'test-model')

      expect(results).toHaveLength(0)
    })

    it('should return empty for empty candidates', async () => {
      const { assessMergeCandidates } = await import('../merge-assessment.service')
      const results = await assessMergeCandidates(sourcePost, [], 'test-model')

      expect(results).toHaveLength(0)
      expect(mockChat).not.toHaveBeenCalled()
    })

    it('should return empty when AI is unconfigured', async () => {
      mockConfig.openaiApiKey = undefined
      const { assessMergeCandidates } = await import('../merge-assessment.service')
      const results = await assessMergeCandidates(sourcePost, candidates, 'test-model')

      expect(results).toHaveLength(0)
      expect(mockChat).not.toHaveBeenCalled()
    })

    it('should handle a malformed/unparseable model response gracefully', async () => {
      // chat() throws a tagged Error when the response isn't valid JSON or
      // doesn't match outputSchema — the structured-output analogue of the
      // old JSON.parse-failure branch. That maps to [], not a throw.
      mockChat.mockRejectedValueOnce(
        Object.assign(new Error('response did not match schema'), {
          code: 'structured-output-parse-failed',
        })
      )

      const { assessMergeCandidates } = await import('../merge-assessment.service')
      const results = await assessMergeCandidates(sourcePost, candidates, 'test-model')

      expect(results).toHaveLength(0)
    })

    it('should handle an empty LLM response', async () => {
      mockChat.mockRejectedValueOnce(
        Object.assign(new Error('missing structured result'), {
          code: 'structured-output-missing-result',
        })
      )

      const { assessMergeCandidates } = await import('../merge-assessment.service')
      const results = await assessMergeCandidates(sourcePost, candidates, 'test-model')

      expect(results).toHaveLength(0)
    })

    it('should let a real transport/network error propagate (not swallow it as [])', async () => {
      // Unlike a parse/validation failure, this error carries no `.code` —
      // it's indistinguishable from any other network failure, so the old
      // uncaught-`withRetry`-failure behavior is preserved: it throws.
      mockChat.mockRejectedValueOnce(new Error('fetch failed: ECONNREFUSED'))

      const { assessMergeCandidates } = await import('../merge-assessment.service')
      await expect(assessMergeCandidates(sourcePost, candidates, 'test-model')).rejects.toThrow(
        'fetch failed: ECONNREFUSED'
      )
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
