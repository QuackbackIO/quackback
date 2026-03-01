/**
 * Tests for suggestion service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  FeedbackSuggestionId,
  PostId,
  BoardId,
  PrincipalId,
  RawFeedbackItemId,
  FeedbackSignalId,
} from '@quackback/ids'

// --- Mock tracking ---
const insertValuesCalls: unknown[][] = []
const updateSetCalls: unknown[][] = []

function createInsertChain(returnValue?: unknown[]) {
  const chain: Record<string, unknown> = {}
  chain.values = vi.fn((...args: unknown[]) => {
    insertValuesCalls.push(args)
    return chain
  })
  chain.onConflictDoNothing = vi.fn(() => chain)
  chain.returning = vi
    .fn()
    .mockResolvedValue(returnValue ?? [{ id: 'suggestion_1' as FeedbackSuggestionId }])
  return chain
}

function createUpdateChain() {
  const chain: Record<string, unknown> = {}
  chain.set = vi.fn((...args: unknown[]) => {
    updateSetCalls.push(args)
    return chain
  })
  chain.returning = vi.fn().mockResolvedValue([{ id: 'suggestion_1' }])
  chain.where = vi.fn(() => chain)
  return chain
}

const mockSuggestionFindFirst = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      feedbackSuggestions: {
        findFirst: (...args: unknown[]) => mockSuggestionFindFirst(...args),
      },
      postStatuses: {
        findFirst: vi.fn().mockResolvedValue({ id: 'status_default' }),
      },
    },
    insert: vi.fn(() => createInsertChain()),
    update: vi.fn(() => createUpdateChain()),
  },
  eq: vi.fn(),
  and: vi.fn(),
  feedbackSuggestions: {
    id: 'id',
    status: 'status',
    createdAt: 'created_at',
  },
  posts: {
    id: 'id',
    voteCount: 'vote_count',
  },
  votes: {},
  rawFeedbackItems: {},
  postStatuses: {
    isDefault: 'is_default',
  },
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}))

const mockSubscribeToPost = vi.fn()

vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  subscribeToPost: (...args: unknown[]) => mockSubscribeToPost(...args),
}))

const mockSendAttributionEmail = vi.fn()

vi.mock('../feedback-attribution-email', () => ({
  sendFeedbackAttributionEmail: (...args: unknown[]) => mockSendAttributionEmail(...args),
}))

describe('suggestion.service', () => {
  beforeEach(() => {
    insertValuesCalls.length = 0
    updateSetCalls.length = 0
    vi.clearAllMocks()
  })

  const rawItemId = 'raw_item_1' as RawFeedbackItemId
  const signalId = 'signal_1' as FeedbackSignalId
  const postId = 'post_1' as PostId
  const boardId = 'board_1' as BoardId
  const adminPrincipalId = 'principal_admin' as PrincipalId
  const externalPrincipalId = 'principal_ext' as PrincipalId

  describe('createMergeSuggestion', () => {
    it('should insert a merge suggestion', async () => {
      const { createMergeSuggestion } = await import('../suggestion.service')
      const result = await createMergeSuggestion({
        rawFeedbackItemId: rawItemId,
        signalId,
        targetPostId: postId,
        similarityScore: 0.85,
        reasoning: 'Matches existing post',
      })

      expect(result).toBe('suggestion_1')
      expect(insertValuesCalls.length).toBe(1)
      const values = insertValuesCalls[0][0] as Record<string, unknown>
      expect(values.suggestionType).toBe('merge_post')
      expect(values.targetPostId).toBe(postId)
    })

    it('should return null on conflict', async () => {
      const { db } = await import('@/lib/server/db')
      vi.mocked(db.insert).mockReturnValueOnce(createInsertChain([]) as any)

      const { createMergeSuggestion } = await import('../suggestion.service')
      const result = await createMergeSuggestion({
        rawFeedbackItemId: rawItemId,
        targetPostId: postId,
        similarityScore: 0.8,
        reasoning: 'Duplicate',
      })

      expect(result).toBeNull()
    })
  })

  describe('createPostSuggestion', () => {
    it('should insert a create_post suggestion', async () => {
      const { createPostSuggestion } = await import('../suggestion.service')
      const result = await createPostSuggestion({
        rawFeedbackItemId: rawItemId,
        signalId,
        boardId,
        suggestedTitle: 'Add CSV Export',
        suggestedBody: 'Users need CSV export',
        reasoning: 'New feature request',
      })

      expect(result).toBe('suggestion_1')
      const values = insertValuesCalls[0][0] as Record<string, unknown>
      expect(values.suggestionType).toBe('create_post')
      expect(values.suggestedTitle).toBe('Add CSV Export')
    })
  })

  describe('acceptMergeSuggestion', () => {
    it('should set canonicalPostId for quackback source', async () => {
      mockSuggestionFindFirst.mockResolvedValueOnce({
        id: 'suggestion_1',
        status: 'pending',
        suggestionType: 'merge_post',
        targetPostId: postId,
        rawItem: {
          sourceType: 'quackback',
          externalId: 'post:post_source',
          principalId: externalPrincipalId,
        },
      })

      const { acceptMergeSuggestion } = await import('../suggestion.service')
      const result = await acceptMergeSuggestion(
        'suggestion_1' as FeedbackSuggestionId,
        adminPrincipalId
      )

      expect(result.success).toBe(true)
      expect(result.resultPostId).toBe(postId)
      // Should set canonicalPostId on source post
      const mergeUpdate = updateSetCalls.find(
        (call) => (call[0] as Record<string, unknown>).canonicalPostId !== undefined
      )
      expect(mergeUpdate).toBeDefined()
      // Should subscribe the author
      expect(mockSubscribeToPost).toHaveBeenCalledWith(
        externalPrincipalId,
        postId,
        'feedback_author'
      )
      // Should send attribution email
      expect(mockSendAttributionEmail).toHaveBeenCalledWith(
        externalPrincipalId,
        postId,
        adminPrincipalId
      )
    })

    it('should add vote for external source', async () => {
      mockSuggestionFindFirst.mockResolvedValueOnce({
        id: 'suggestion_1',
        status: 'pending',
        suggestionType: 'merge_post',
        targetPostId: postId,
        rawItem: {
          sourceType: 'intercom',
          externalId: 'conv_123',
          principalId: externalPrincipalId,
        },
      })

      const { acceptMergeSuggestion } = await import('../suggestion.service')
      const result = await acceptMergeSuggestion(
        'suggestion_1' as FeedbackSuggestionId,
        adminPrincipalId
      )

      expect(result.success).toBe(true)
      // Should insert vote
      expect(insertValuesCalls.length).toBeGreaterThanOrEqual(1)
      // Should subscribe
      expect(mockSubscribeToPost).toHaveBeenCalled()
      // Should send email
      expect(mockSendAttributionEmail).toHaveBeenCalled()
    })

    it('should throw for invalid suggestion', async () => {
      mockSuggestionFindFirst.mockResolvedValueOnce({
        id: 'suggestion_1',
        status: 'accepted',
        suggestionType: 'merge_post',
      })

      const { acceptMergeSuggestion } = await import('../suggestion.service')
      await expect(
        acceptMergeSuggestion('suggestion_1' as FeedbackSuggestionId, adminPrincipalId)
      ).rejects.toThrow('Invalid suggestion')
    })
  })

  describe('acceptCreateSuggestion', () => {
    it('should create post, vote, subscribe and email', async () => {
      const { db } = await import('@/lib/server/db')
      // Make insert return the new post ID
      vi.mocked(db.insert).mockReturnValueOnce(
        createInsertChain([{ id: 'new_post_1' as PostId }]) as any
      )

      mockSuggestionFindFirst.mockResolvedValueOnce({
        id: 'suggestion_1',
        status: 'pending',
        suggestionType: 'create_post',
        suggestedTitle: 'Add CSV Export',
        suggestedBody: 'Users need CSV export',
        boardId,
        rawItem: {
          principalId: externalPrincipalId,
        },
      })

      const { acceptCreateSuggestion } = await import('../suggestion.service')
      const result = await acceptCreateSuggestion(
        'suggestion_1' as FeedbackSuggestionId,
        adminPrincipalId
      )

      expect(result.success).toBe(true)
      // Should subscribe author
      expect(mockSubscribeToPost).toHaveBeenCalled()
      // Should send email (different principals)
      expect(mockSendAttributionEmail).toHaveBeenCalled()
    })

    it('should use edits over suggestion defaults', async () => {
      const { db } = await import('@/lib/server/db')
      vi.mocked(db.insert).mockReturnValueOnce(
        createInsertChain([{ id: 'new_post_2' as PostId }]) as any
      )

      mockSuggestionFindFirst.mockResolvedValueOnce({
        id: 'suggestion_1',
        status: 'pending',
        suggestionType: 'create_post',
        suggestedTitle: 'Original Title',
        suggestedBody: 'Original body',
        boardId,
        rawItem: { principalId: externalPrincipalId },
      })

      const { acceptCreateSuggestion } = await import('../suggestion.service')
      await acceptCreateSuggestion('suggestion_1' as FeedbackSuggestionId, adminPrincipalId, {
        title: 'Custom Title',
        body: 'Custom body',
      })

      // The first insert call should have the custom title
      const postValues = insertValuesCalls[0][0] as Record<string, unknown>
      expect(postValues.title).toBe('Custom Title')
      expect(postValues.content).toBe('Custom body')
    })

    it('should not send email when author is the admin', async () => {
      const { db } = await import('@/lib/server/db')
      vi.mocked(db.insert).mockReturnValueOnce(
        createInsertChain([{ id: 'new_post_3' as PostId }]) as any
      )

      mockSuggestionFindFirst.mockResolvedValueOnce({
        id: 'suggestion_1',
        status: 'pending',
        suggestionType: 'create_post',
        suggestedTitle: 'Test',
        suggestedBody: 'Test',
        boardId,
        rawItem: { principalId: adminPrincipalId },
      })

      const { acceptCreateSuggestion } = await import('../suggestion.service')
      await acceptCreateSuggestion('suggestion_1' as FeedbackSuggestionId, adminPrincipalId)

      // Should still subscribe
      expect(mockSubscribeToPost).toHaveBeenCalled()
      // Should NOT send email (same principal)
      expect(mockSendAttributionEmail).not.toHaveBeenCalled()
    })

    it('should throw when no board is available', async () => {
      mockSuggestionFindFirst.mockResolvedValueOnce({
        id: 'suggestion_1',
        status: 'pending',
        suggestionType: 'create_post',
        suggestedTitle: 'Test',
        suggestedBody: 'Test',
        boardId: null,
        rawItem: { principalId: externalPrincipalId },
      })

      const { acceptCreateSuggestion } = await import('../suggestion.service')
      await expect(
        acceptCreateSuggestion('suggestion_1' as FeedbackSuggestionId, adminPrincipalId)
      ).rejects.toThrow('Board is required')
    })
  })

  describe('dismissSuggestion', () => {
    it('should mark suggestion as dismissed', async () => {
      const { dismissSuggestion } = await import('../suggestion.service')
      await dismissSuggestion('suggestion_1' as FeedbackSuggestionId, adminPrincipalId)

      expect(updateSetCalls.length).toBe(1)
      const setArgs = updateSetCalls[0][0] as Record<string, unknown>
      expect(setArgs.status).toBe('dismissed')
      expect(setArgs.resolvedAt).toBeInstanceOf(Date)
    })
  })

  describe('expireStaleSuggestions', () => {
    it('should expire old pending suggestions and return count', async () => {
      const { db } = await import('@/lib/server/db')
      const chain = createUpdateChain()
      chain.returning = vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }])
      vi.mocked(db.update).mockReturnValueOnce(chain as any)

      const { expireStaleSuggestions } = await import('../suggestion.service')
      const count = await expireStaleSuggestions()

      expect(count).toBe(2)
      const setArgs = updateSetCalls[0][0] as Record<string, unknown>
      expect(setArgs.status).toBe('expired')
    })
  })
})
