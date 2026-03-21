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
  chain.returning = vi
    .fn()
    .mockResolvedValue([{ id: 'suggestion_1', rawFeedbackItemId: 'raw_item_1' }])
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

vi.mock('@/lib/server/domains/activity/activity.service', () => ({
  createActivity: vi.fn(),
}))

vi.mock('../pipeline-log', () => ({
  logPipelineEvent: vi.fn().mockResolvedValue(undefined),
}))

describe('suggestion.service', () => {
  beforeEach(() => {
    insertValuesCalls.length = 0
    updateSetCalls.length = 0
    vi.clearAllMocks()
  })

  const rawItemId = 'raw_item_1' as RawFeedbackItemId
  const signalId = 'signal_1' as FeedbackSignalId
  const boardId = 'board_1' as BoardId
  const adminPrincipalId = 'principal_admin' as PrincipalId
  const externalPrincipalId = 'principal_ext' as PrincipalId

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

  describe('acceptCreateSuggestion', () => {
    it('should create post, vote, subscribe and email', async () => {
      const { db } = await import('@/lib/server/db')
      // Make insert return the new post ID
      vi.mocked(db.insert).mockReturnValueOnce(
        createInsertChain([{ id: 'new_post_1' as PostId }]) as unknown as ReturnType<
          (typeof db)['insert']
        >
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

      // Should log suggestion.accepted pipeline event
      const { logPipelineEvent } = await import('../pipeline-log')
      expect(logPipelineEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'suggestion.accepted',
          suggestionId: 'suggestion_1',
          detail: expect.objectContaining({
            suggestionType: 'create_post',
            resolvedByPrincipalId: adminPrincipalId,
            edits: expect.objectContaining({
              titleChanged: false,
              bodyChanged: false,
            }),
          }),
        })
      )
    })

    it('should use edits over suggestion defaults', async () => {
      const { db } = await import('@/lib/server/db')
      vi.mocked(db.insert).mockReturnValueOnce(
        createInsertChain([{ id: 'new_post_2' as PostId }]) as unknown as ReturnType<
          (typeof db)['insert']
        >
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

      // Should log edit deltas in suggestion.accepted
      const { logPipelineEvent } = await import('../pipeline-log')
      expect(logPipelineEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'suggestion.accepted',
          detail: expect.objectContaining({
            edits: expect.objectContaining({
              titleChanged: true,
              bodyChanged: true,
            }),
          }),
        })
      )
    })

    it('should not send email when author is the admin', async () => {
      const { db } = await import('@/lib/server/db')
      vi.mocked(db.insert).mockReturnValueOnce(
        createInsertChain([{ id: 'new_post_3' as PostId }]) as unknown as ReturnType<
          (typeof db)['insert']
        >
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

      // Should log suggestion.dismissed pipeline event
      const { logPipelineEvent } = await import('../pipeline-log')
      expect(logPipelineEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'suggestion.dismissed',
          suggestionId: 'suggestion_1',
          detail: expect.objectContaining({
            resolvedByPrincipalId: adminPrincipalId,
          }),
        })
      )
    })
  })

  describe('expireStaleSuggestions', () => {
    it('should expire old pending suggestions and return count', async () => {
      const { db } = await import('@/lib/server/db')
      const chain = createUpdateChain()
      chain.returning = vi.fn().mockResolvedValue([
        { id: 'a', rawFeedbackItemId: 'raw_1', createdAt: new Date(Date.now() - 45 * 86400000) },
        { id: 'b', rawFeedbackItemId: 'raw_2', createdAt: new Date(Date.now() - 60 * 86400000) },
      ])
      vi.mocked(db.update).mockReturnValueOnce(
        chain as unknown as ReturnType<(typeof db)['update']>
      )

      const { expireStaleSuggestions } = await import('../suggestion.service')
      const count = await expireStaleSuggestions()

      expect(count).toBe(2)
      const setArgs = updateSetCalls[0][0] as Record<string, unknown>
      expect(setArgs.status).toBe('expired')

      // Should log one suggestion.expired event per expired suggestion
      const { logPipelineEvent } = await import('../pipeline-log')
      expect(logPipelineEvent).toHaveBeenCalledTimes(2)
      expect(logPipelineEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'suggestion.expired',
          detail: expect.objectContaining({
            expiredBy: 'system',
            reasonCode: 'stale',
            ageDays: expect.any(Number),
          }),
        })
      )
    })
  })
})
