/**
 * Tests for merge suggestion CRUD service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostId, PrincipalId, MergeSuggestionId } from '@quackback/ids'

// --- Mock tracking ---
const insertValuesCalls: unknown[][] = []
const updateSetCalls: unknown[][] = []

function createInsertChain() {
  const chain: Record<string, unknown> = {}
  chain.values = vi.fn((...args: unknown[]) => {
    insertValuesCalls.push(args)
    return chain
  })
  chain.onConflictDoNothing = vi.fn(() => chain)
  return chain
}

function createUpdateChain(returnValue?: unknown[]) {
  const chain: Record<string, unknown> = {}
  chain.set = vi.fn((...args: unknown[]) => {
    updateSetCalls.push(args)
    return chain
  })
  chain.where = vi.fn(() => chain)
  chain.returning = vi.fn().mockResolvedValue(returnValue ?? [])
  return chain
}

const mockMergeSuggestionFindFirst = vi.fn()
const mockMergePost = vi.fn()
const mockDbUpdate = vi.fn((_table?: any) => createUpdateChain())

function createSelectChain() {
  const chain: Record<string, any> = {}
  chain.from = vi.fn(() => chain)
  chain.innerJoin = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.orderBy = vi.fn(() => chain)
  chain.limit = vi.fn().mockResolvedValue([])
  // Also support as() for subquery aliases
  chain.as = vi.fn(() => chain)
  return chain
}

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      mergeSuggestions: {
        findFirst: (...args: unknown[]) => mockMergeSuggestionFindFirst(...args),
      },
    },
    insert: vi.fn(() => createInsertChain()),
    update: (table: any) => mockDbUpdate(table),
    select: vi.fn(() => createSelectChain()),
  },
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  inArray: vi.fn(),
  desc: vi.fn((col: unknown) => col),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
  mergeSuggestions: {
    id: 'id',
    sourcePostId: 'source_post_id',
    targetPostId: 'target_post_id',
    status: 'status',
    hybridScore: 'hybrid_score',
    llmConfidence: 'llm_confidence',
    llmReasoning: 'llm_reasoning',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  posts: {
    id: 'id',
    title: 'title',
    content: 'content',
    voteCount: 'vote_count',
    commentCount: 'comment_count',
    createdAt: 'created_at',
    boardId: 'board_id',
    statusId: 'status_id',
  },
  boards: {
    id: 'id',
    name: 'name',
  },
  postStatuses: {
    id: 'id',
    name: 'name',
    color: 'color',
  },
}))

vi.mock('@/lib/server/domains/posts/post.merge', () => ({
  mergePost: (...args: unknown[]) => mockMergePost(...args),
}))

describe('merge-suggestion.service', () => {
  beforeEach(() => {
    insertValuesCalls.length = 0
    updateSetCalls.length = 0
    vi.clearAllMocks()
    mockDbUpdate.mockImplementation(() => createUpdateChain())
  })

  const sourcePostId = 'post_source1' as PostId
  const targetPostId = 'post_target1' as PostId
  const principalId = 'principal_admin1' as PrincipalId
  const suggestionId = 'merge_sug_test1' as MergeSuggestionId

  describe('createMergeSuggestion', () => {
    it('should insert a merge suggestion with onConflictDoNothing', async () => {
      const { createMergeSuggestion } = await import('../merge-suggestion.service')
      await createMergeSuggestion({
        sourcePostId,
        targetPostId,
        vectorScore: 0.85,
        ftsScore: 0.6,
        hybridScore: 0.93,
        llmConfidence: 0.9,
        llmReasoning: 'Both request dark mode',
        llmModel: 'google/gemini-2.5-flash',
      })

      expect(insertValuesCalls).toHaveLength(1)
      const values = insertValuesCalls[0][0] as Record<string, unknown>
      expect(values.sourcePostId).toBe(sourcePostId)
      expect(values.targetPostId).toBe(targetPostId)
      expect(values.vectorScore).toBe(0.85)
      expect(values.llmConfidence).toBe(0.9)
    })
  })

  describe('acceptMergeSuggestion', () => {
    it('should call mergePost and update status to accepted', async () => {
      mockMergeSuggestionFindFirst.mockResolvedValueOnce({
        id: suggestionId,
        status: 'pending',
        sourcePostId,
        targetPostId,
      })
      mockMergePost.mockResolvedValueOnce({
        canonicalPost: { id: targetPostId, voteCount: 15 },
        duplicatePost: { id: sourcePostId },
      })

      const { acceptMergeSuggestion } = await import('../merge-suggestion.service')
      await acceptMergeSuggestion(suggestionId, principalId)

      // Should call mergePost with correct arguments
      expect(mockMergePost).toHaveBeenCalledWith(sourcePostId, targetPostId, principalId)

      // Should update status to accepted
      expect(updateSetCalls.length).toBeGreaterThanOrEqual(1)
      const acceptUpdate = updateSetCalls[0][0] as Record<string, unknown>
      expect(acceptUpdate.status).toBe('accepted')
      expect(acceptUpdate.resolvedByPrincipalId).toBe(principalId)
      expect(acceptUpdate.resolvedAt).toBeInstanceOf(Date)
    })

    it('should throw for non-pending suggestion', async () => {
      mockMergeSuggestionFindFirst.mockResolvedValueOnce({
        id: suggestionId,
        status: 'accepted',
        sourcePostId,
        targetPostId,
      })

      const { acceptMergeSuggestion } = await import('../merge-suggestion.service')
      await expect(acceptMergeSuggestion(suggestionId, principalId)).rejects.toThrow(
        'not found or already resolved'
      )
    })

    it('should throw for missing suggestion', async () => {
      mockMergeSuggestionFindFirst.mockResolvedValueOnce(null)

      const { acceptMergeSuggestion } = await import('../merge-suggestion.service')
      await expect(acceptMergeSuggestion(suggestionId, principalId)).rejects.toThrow(
        'not found or already resolved'
      )
    })
  })

  describe('dismissMergeSuggestion', () => {
    it('should update status to dismissed', async () => {
      const { dismissMergeSuggestion } = await import('../merge-suggestion.service')
      await dismissMergeSuggestion(suggestionId, principalId)

      expect(updateSetCalls).toHaveLength(1)
      const setArgs = updateSetCalls[0][0] as Record<string, unknown>
      expect(setArgs.status).toBe('dismissed')
      expect(setArgs.resolvedAt).toBeInstanceOf(Date)
      expect(setArgs.resolvedByPrincipalId).toBe(principalId)
    })
  })

  describe('expireStaleMergeSuggestions', () => {
    it('should expire old pending suggestions and return count', async () => {
      const chain = createUpdateChain([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
      mockDbUpdate.mockReturnValueOnce(chain as any)

      const { expireStaleMergeSuggestions } = await import('../merge-suggestion.service')
      const count = await expireStaleMergeSuggestions()

      expect(count).toBe(3)
      const setArgs = updateSetCalls[0][0] as Record<string, unknown>
      expect(setArgs.status).toBe('expired')
    })
  })
})
