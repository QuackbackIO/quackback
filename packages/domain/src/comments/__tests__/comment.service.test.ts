/**
 * CommentService Unit Tests
 *
 * Comprehensive test coverage for CommentService business logic including:
 * - Comment creation with validation
 * - Nested comment validation
 * - Authorization checks
 * - Reaction management
 * - Cross-organization isolation
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommentService } from '../comment.service'
import type { ServiceContext } from '../../shared/service-context'
import type { CreateCommentInput, UpdateCommentInput } from '../comment.types'
import type { Comment, Post, Board } from '@quackback/db'
import type { CommentId, PostId } from '@quackback/ids'

// Use vi.hoisted to create mock instances that are available at mock factory time
const { mockCommentRepoInstance, mockPostRepoInstance, mockBoardRepoInstance, mockDbInstance } =
  vi.hoisted(() => ({
    mockCommentRepoInstance: {
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    mockPostRepoInstance: {
      findById: vi.fn(),
    },
    mockBoardRepoInstance: {
      findById: vi.fn(),
    },
    mockDbInstance: {
      query: {
        comments: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
        commentReactions: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
      },
      insert: vi.fn(() => ({
        values: vi.fn().mockReturnThis(),
      })),
      delete: vi.fn(() => ({
        where: vi.fn().mockReturnThis(),
      })),
    },
  }))

// Mock @quackback/db module
vi.mock('@quackback/db', () => ({
  CommentRepository: vi.fn(),
  PostRepository: vi.fn(),
  BoardRepository: vi.fn(),
  withUnitOfWork: vi.fn(
    async (_orgId: string, callback: (uow: { db: unknown }) => Promise<unknown>) => {
      return callback({ db: mockDbInstance })
    }
  ),
  db: mockDbInstance,
  eq: vi.fn(),
  and: vi.fn(),
  asc: vi.fn(),
  comments: {},
  commentReactions: {},
}))

// Mock comment tree utilities
vi.mock('../../shared/comment-tree', () => ({
  buildCommentTree: vi.fn(
    (
      comments: Array<{ id: string; reactions?: Array<{ emoji: string; userIdentifier: string }> }>
    ) =>
      comments.map((c) => ({
        ...c,
        replies: [],
        reactions: c.reactions || [],
      }))
  ),
  aggregateReactions: vi.fn((reactions: Array<{ emoji: string; userIdentifier: string }>) =>
    reactions.map((r) => ({
      emoji: r.emoji,
      count: 1,
      hasReacted: false,
    }))
  ),
}))

// Mock SubscriptionService to avoid database calls in tests
vi.mock('../../subscriptions/subscription.service', () => {
  const mockSubscribeToPost = vi.fn().mockResolvedValue(undefined)
  return {
    SubscriptionService: class MockSubscriptionService {
      subscribeToPost = mockSubscribeToPost
    },
  }
})

describe('CommentService', () => {
  let commentService: CommentService
  let mockContext: ServiceContext

  // Test data
  const mockOrgId = 'org_123'
  const mockUserId = 'user_123'
  const mockMemberId = 'member_123'
  const mockPostId = 'post_123'
  const mockBoardId = 'board_123'
  const mockCommentId = 'comment_123'

  const mockPost: Post = {
    id: mockPostId,
    organizationId: mockOrgId,
    boardId: mockBoardId,
    title: 'Test Post',
    content: 'Test content',
    contentJson: null,
    statusId: null,
    memberId: mockMemberId,
    authorId: null,
    authorName: 'Test User',
    authorEmail: 'test@example.com',
    ownerMemberId: null,
    ownerId: null,
    estimated: null,
    voteCount: 0,
    officialResponse: null,
    officialResponseMemberId: null,
    officialResponseAuthorId: null,
    officialResponseAuthorName: null,
    officialResponseAt: null,
    deletedAt: null,
    deletedByMemberId: null,
    searchVector: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const mockBoard: Board = {
    id: mockBoardId,
    organizationId: mockOrgId,
    name: 'Test Board',
    slug: 'test-board',
    description: null,
    isPublic: true,
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const mockComment: Comment = {
    id: mockCommentId,
    organizationId: mockOrgId,
    postId: mockPostId,
    parentId: null,
    memberId: mockMemberId,
    authorId: null,
    authorName: 'Test User',
    authorEmail: 'test@example.com',
    content: 'Test comment',
    isTeamMember: false,
    createdAt: new Date(),
    deletedAt: null,
  }

  beforeEach(async () => {
    vi.clearAllMocks()

    // Reset mock implementations
    mockCommentRepoInstance.findById.mockReset()
    mockCommentRepoInstance.create.mockReset()
    mockCommentRepoInstance.update.mockReset()
    mockCommentRepoInstance.delete.mockReset()
    mockPostRepoInstance.findById.mockReset()
    mockBoardRepoInstance.findById.mockReset()
    mockDbInstance.query.comments.findFirst.mockReset()
    mockDbInstance.query.comments.findMany.mockReset()
    mockDbInstance.query.commentReactions.findFirst.mockReset()
    mockDbInstance.query.commentReactions.findMany.mockReset()

    // Default mock context (team member)
    mockContext = {
      organizationId: mockOrgId,
      userId: mockUserId,
      memberId: mockMemberId,
      memberRole: 'member',
      userName: 'Test User',
      userEmail: 'test@example.com',
    }

    commentService = new CommentService()

    // Import the mocked module (use import() not require() for ESM mocking)
    const dbModule = await import('@quackback/db')

    // Setup repository constructors (must use function, not arrow, for constructor mocking)
    vi.mocked(dbModule.CommentRepository).mockImplementation(function () {
      return mockCommentRepoInstance
    })
    vi.mocked(dbModule.PostRepository).mockImplementation(function () {
      return mockPostRepoInstance
    })
    vi.mocked(dbModule.BoardRepository).mockImplementation(function () {
      return mockBoardRepoInstance
    })
  })

  describe('createComment', () => {
    const validInput: CreateCommentInput = {
      postId: mockPostId,
      content: 'This is a test comment',
    }

    beforeEach(() => {
      mockPostRepoInstance.findById.mockResolvedValue(mockPost)
      mockBoardRepoInstance.findById.mockResolvedValue(mockBoard)
      mockCommentRepoInstance.create.mockResolvedValue(mockComment)
    })

    it('should create a comment successfully', async () => {
      const result = await commentService.createComment(validInput, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        // Result now includes both comment and post info for event building
        expect(result.value.comment).toEqual(mockComment)
        expect(result.value.post).toEqual({ id: mockPost.id, title: mockPost.title })
      }
      expect(mockCommentRepoInstance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          postId: mockPostId,
          content: 'This is a test comment',
          parentId: null,
          memberId: mockMemberId,
          isTeamMember: true,
        })
      )
    })

    it('should trim whitespace from content', async () => {
      const inputWithWhitespace = {
        ...validInput,
        content: '  Test comment  ',
      }

      await commentService.createComment(inputWithWhitespace, mockContext)

      expect(mockCommentRepoInstance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Test comment',
        })
      )
    })

    it('should set isTeamMember to true for team members', async () => {
      const teamContext = { ...mockContext, memberRole: 'admin' as const }

      await commentService.createComment(validInput, teamContext)

      expect(mockCommentRepoInstance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          isTeamMember: true,
        })
      )
    })

    it('should set isTeamMember to false for portal users', async () => {
      const userContext = { ...mockContext, memberRole: 'user' as const }

      await commentService.createComment(validInput, userContext)

      expect(mockCommentRepoInstance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          isTeamMember: false,
        })
      )
    })

    it('should return error if post not found', async () => {
      mockPostRepoInstance.findById.mockResolvedValue(null)

      const result = await commentService.createComment(validInput, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('POST_NOT_FOUND')
        expect(result.error.message).toContain(mockPostId)
      }
    })

    it('should return error if board not found', async () => {
      mockBoardRepoInstance.findById.mockResolvedValue(null)

      const result = await commentService.createComment(validInput, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('POST_NOT_FOUND')
      }
    })

    it('should return error if content is empty', async () => {
      const emptyInput = { ...validInput, content: '' }

      const result = await commentService.createComment(emptyInput, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('Content is required')
      }
    })

    it('should return error if content is only whitespace', async () => {
      const whitespaceInput = { ...validInput, content: '   ' }

      const result = await commentService.createComment(whitespaceInput, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('Content is required')
      }
    })

    it('should return error if content exceeds 5000 characters', async () => {
      const longContent = 'a'.repeat(5001)
      const longInput = { ...validInput, content: longContent }

      const result = await commentService.createComment(longInput, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('5,000 characters')
      }
    })

    it('should allow content with exactly 5000 characters', async () => {
      const maxContent = 'a'.repeat(5000)
      const maxInput = { ...validInput, content: maxContent }

      const result = await commentService.createComment(maxInput, mockContext)

      expect(result.success).toBe(true)
    })

    describe('nested comments', () => {
      const parentCommentId = 'comment_parent123' as CommentId
      const parentComment: Comment = {
        ...mockComment,
        id: parentCommentId,
        parentId: null,
      }

      beforeEach(() => {
        mockCommentRepoInstance.findById.mockResolvedValue(parentComment)
      })

      it('should create a nested comment with valid parent', async () => {
        const nestedInput: CreateCommentInput = { ...validInput, parentId: parentCommentId }

        const result = await commentService.createComment(nestedInput, mockContext)

        expect(result.success).toBe(true)
        expect(mockCommentRepoInstance.create).toHaveBeenCalledWith(
          expect.objectContaining({
            parentId: parentCommentId,
          })
        )
      })

      it('should return error if parent comment not found', async () => {
        mockCommentRepoInstance.findById.mockResolvedValue(null)
        const nestedInput: CreateCommentInput = {
          ...validInput,
          parentId: 'comment_nonexistent' as CommentId,
        }

        const result = await commentService.createComment(nestedInput, mockContext)

        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.code).toBe('INVALID_PARENT')
        }
      })

      it('should return error if parent belongs to different post', async () => {
        const wrongPostParent = { ...parentComment, postId: 'post_different' as PostId }
        mockCommentRepoInstance.findById.mockResolvedValue(wrongPostParent)
        const nestedInput: CreateCommentInput = { ...validInput, parentId: parentCommentId }

        const result = await commentService.createComment(nestedInput, mockContext)

        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR')
          expect(result.error.message).toContain('different post')
        }
      })
    })
  })

  describe('updateComment', () => {
    const updateInput: UpdateCommentInput = {
      content: 'Updated comment',
    }

    beforeEach(() => {
      mockCommentRepoInstance.findById.mockResolvedValue(mockComment)
      mockPostRepoInstance.findById.mockResolvedValue(mockPost)
      mockBoardRepoInstance.findById.mockResolvedValue(mockBoard)
      mockCommentRepoInstance.update.mockResolvedValue({
        ...mockComment,
        content: 'Updated comment',
      })
    })

    it('should update comment as author', async () => {
      const result = await commentService.updateComment(mockCommentId, updateInput, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.content).toBe('Updated comment')
      }
    })

    it('should trim whitespace from updated content', async () => {
      const inputWithWhitespace = { content: '  Updated  ' }

      await commentService.updateComment(mockCommentId, inputWithWhitespace, mockContext)

      expect(mockCommentRepoInstance.update).toHaveBeenCalledWith(
        mockCommentId,
        expect.objectContaining({
          content: 'Updated',
        })
      )
    })

    it('should allow team member to update any comment', async () => {
      const otherUserComment = { ...mockComment, memberId: 'other-member' }
      mockCommentRepoInstance.findById.mockResolvedValue(otherUserComment)

      const result = await commentService.updateComment(mockCommentId, updateInput, mockContext)

      expect(result.success).toBe(true)
    })

    it('should allow admin to update any comment', async () => {
      const adminContext = { ...mockContext, memberRole: 'admin' as const }
      const otherUserComment = { ...mockComment, memberId: 'other-member' }
      mockCommentRepoInstance.findById.mockResolvedValue(otherUserComment)

      const result = await commentService.updateComment(mockCommentId, updateInput, adminContext)

      expect(result.success).toBe(true)
    })

    it('should allow owner to update any comment', async () => {
      const ownerContext = { ...mockContext, memberRole: 'owner' as const }
      const otherUserComment = { ...mockComment, memberId: 'other-member' }
      mockCommentRepoInstance.findById.mockResolvedValue(otherUserComment)

      const result = await commentService.updateComment(mockCommentId, updateInput, ownerContext)

      expect(result.success).toBe(true)
    })

    it('should prevent portal user from updating others comments', async () => {
      const userContext = { ...mockContext, memberRole: 'user' as const }
      const otherUserComment = { ...mockComment, memberId: 'other-member' }
      mockCommentRepoInstance.findById.mockResolvedValue(otherUserComment)

      const result = await commentService.updateComment(mockCommentId, updateInput, userContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
      }
    })

    it('should return error if comment not found', async () => {
      mockCommentRepoInstance.findById.mockResolvedValue(null)

      const result = await commentService.updateComment(mockCommentId, updateInput, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('COMMENT_NOT_FOUND')
      }
    })

    it('should return error if content is empty', async () => {
      const emptyInput = { content: '' }

      const result = await commentService.updateComment(mockCommentId, emptyInput, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('cannot be empty')
      }
    })

    it('should return error if content is only whitespace', async () => {
      const whitespaceInput = { content: '   ' }

      const result = await commentService.updateComment(mockCommentId, whitespaceInput, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
      }
    })

    it('should return error if content exceeds 5000 characters', async () => {
      const longInput = { content: 'a'.repeat(5001) }

      const result = await commentService.updateComment(mockCommentId, longInput, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('5,000 characters')
      }
    })

    it('should return error if update returns null', async () => {
      mockCommentRepoInstance.update.mockResolvedValue(null)

      const result = await commentService.updateComment(mockCommentId, updateInput, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('COMMENT_NOT_FOUND')
      }
    })
  })

  describe('deleteComment', () => {
    beforeEach(() => {
      mockCommentRepoInstance.findById.mockResolvedValue(mockComment)
      mockPostRepoInstance.findById.mockResolvedValue(mockPost)
      mockBoardRepoInstance.findById.mockResolvedValue(mockBoard)
      mockCommentRepoInstance.delete.mockResolvedValue(true)
    })

    it('should delete comment as author', async () => {
      const result = await commentService.deleteComment(mockCommentId, mockContext)

      expect(result.success).toBe(true)
      expect(mockCommentRepoInstance.delete).toHaveBeenCalledWith(mockCommentId)
    })

    it('should allow team member to delete any comment', async () => {
      const otherUserComment = { ...mockComment, memberId: 'other-member' }
      mockCommentRepoInstance.findById.mockResolvedValue(otherUserComment)

      const result = await commentService.deleteComment(mockCommentId, mockContext)

      expect(result.success).toBe(true)
    })

    it('should allow admin to delete any comment', async () => {
      const adminContext = { ...mockContext, memberRole: 'admin' as const }
      const otherUserComment = { ...mockComment, memberId: 'other-member' }
      mockCommentRepoInstance.findById.mockResolvedValue(otherUserComment)

      const result = await commentService.deleteComment(mockCommentId, adminContext)

      expect(result.success).toBe(true)
    })

    it('should prevent portal user from deleting others comments', async () => {
      const userContext = { ...mockContext, memberRole: 'user' as const }
      const otherUserComment = { ...mockComment, memberId: 'other-member' }
      mockCommentRepoInstance.findById.mockResolvedValue(otherUserComment)

      const result = await commentService.deleteComment(mockCommentId, userContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('UNAUTHORIZED')
      }
    })

    it('should return error if comment not found', async () => {
      mockCommentRepoInstance.findById.mockResolvedValue(null)

      const result = await commentService.deleteComment(mockCommentId, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('COMMENT_NOT_FOUND')
      }
    })

    it('should return error if delete operation fails', async () => {
      mockCommentRepoInstance.delete.mockResolvedValue(false)

      const result = await commentService.deleteComment(mockCommentId, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('COMMENT_NOT_FOUND')
      }
    })
  })

  describe('getCommentById', () => {
    beforeEach(() => {
      mockCommentRepoInstance.findById.mockResolvedValue(mockComment)
      mockPostRepoInstance.findById.mockResolvedValue(mockPost)
      mockBoardRepoInstance.findById.mockResolvedValue(mockBoard)
    })

    it('should return comment if found', async () => {
      const result = await commentService.getCommentById(mockCommentId, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value).toEqual(mockComment)
      }
    })

    it('should return error if comment not found', async () => {
      mockCommentRepoInstance.findById.mockResolvedValue(null)

      const result = await commentService.getCommentById(mockCommentId, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('COMMENT_NOT_FOUND')
      }
    })

    it('should return error if post not found', async () => {
      mockPostRepoInstance.findById.mockResolvedValue(null)

      const result = await commentService.getCommentById(mockCommentId, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('POST_NOT_FOUND')
      }
    })

    it('should verify organization ownership via board', async () => {
      await commentService.getCommentById(mockCommentId, mockContext)

      expect(mockBoardRepoInstance.findById).toHaveBeenCalledWith(mockBoardId)
    })
  })

  describe('getCommentsByPost', () => {
    beforeEach(() => {
      mockPostRepoInstance.findById.mockResolvedValue(mockPost)
      mockBoardRepoInstance.findById.mockResolvedValue(mockBoard)
      mockDbInstance.query.comments.findMany.mockResolvedValue([
        {
          ...mockComment,
          reactions: [],
        },
      ])
    })

    it('should return threaded comments for a post', async () => {
      const result = await commentService.getCommentsByPost(mockPostId, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(Array.isArray(result.value)).toBe(true)
      }
    })

    it('should return error if post not found', async () => {
      mockPostRepoInstance.findById.mockResolvedValue(null)

      const result = await commentService.getCommentsByPost(mockPostId, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('POST_NOT_FOUND')
      }
    })

    it('should return error if board not found', async () => {
      mockBoardRepoInstance.findById.mockResolvedValue(null)

      const result = await commentService.getCommentsByPost(mockPostId, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('POST_NOT_FOUND')
      }
    })
  })

  describe('addReaction', () => {
    const emoji = '👍'

    beforeEach(() => {
      mockCommentRepoInstance.findById.mockResolvedValue(mockComment)
      mockPostRepoInstance.findById.mockResolvedValue(mockPost)
      mockBoardRepoInstance.findById.mockResolvedValue(mockBoard)
      mockDbInstance.query.commentReactions.findFirst.mockResolvedValue(null)
      mockDbInstance.query.commentReactions.findMany.mockResolvedValue([
        { emoji, userIdentifier: `member:${mockMemberId}` },
      ])
    })

    it('should add a reaction to a comment', async () => {
      const result = await commentService.addReaction(mockCommentId, emoji, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.added).toBe(true)
        expect(Array.isArray(result.value.reactions)).toBe(true)
      }
    })

    it('should not add duplicate reaction', async () => {
      mockDbInstance.query.commentReactions.findFirst.mockResolvedValue({
        id: 'reaction-123',
        commentId: mockCommentId,
        userIdentifier: `member:${mockMemberId}`,
        emoji,
        createdAt: new Date(),
      })

      const result = await commentService.addReaction(mockCommentId, emoji, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.added).toBe(false)
      }
    })

    it('should return error if comment not found', async () => {
      mockCommentRepoInstance.findById.mockResolvedValue(null)

      const result = await commentService.addReaction(mockCommentId, emoji, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('COMMENT_NOT_FOUND')
      }
    })

    it('should use userIdentifier from context if provided', async () => {
      const contextWithIdentifier = {
        ...mockContext,
        userIdentifier: 'anon:abc-123',
      }

      await commentService.addReaction(mockCommentId, emoji, contextWithIdentifier)

      expect(mockDbInstance.query.commentReactions.findFirst).toHaveBeenCalled()
    })
  })

  describe('removeReaction', () => {
    const emoji = '👍'
    const reactionId = 'reaction-123'

    beforeEach(() => {
      mockCommentRepoInstance.findById.mockResolvedValue(mockComment)
      mockPostRepoInstance.findById.mockResolvedValue(mockPost)
      mockBoardRepoInstance.findById.mockResolvedValue(mockBoard)
      mockDbInstance.query.commentReactions.findFirst.mockResolvedValue({
        id: reactionId,
        commentId: mockCommentId,
        userIdentifier: `member:${mockMemberId}`,
        emoji,
        createdAt: new Date(),
      })
      mockDbInstance.query.commentReactions.findMany.mockResolvedValue([])
    })

    it('should remove a reaction from a comment', async () => {
      const result = await commentService.removeReaction(mockCommentId, emoji, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.added).toBe(false)
      }
    })

    it('should handle removing non-existent reaction', async () => {
      mockDbInstance.query.commentReactions.findFirst.mockResolvedValue(null)

      const result = await commentService.removeReaction(mockCommentId, emoji, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.added).toBe(false)
      }
    })

    it('should return error if comment not found', async () => {
      mockCommentRepoInstance.findById.mockResolvedValue(null)

      const result = await commentService.removeReaction(mockCommentId, emoji, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('COMMENT_NOT_FOUND')
      }
    })
  })

  describe('toggleReaction', () => {
    const emoji = '❤️'
    const reactionId = 'reaction-123'

    beforeEach(() => {
      mockCommentRepoInstance.findById.mockResolvedValue(mockComment)
      mockPostRepoInstance.findById.mockResolvedValue(mockPost)
      mockBoardRepoInstance.findById.mockResolvedValue(mockBoard)
      mockDbInstance.query.commentReactions.findMany.mockResolvedValue([])
    })

    it('should add reaction if not exists', async () => {
      mockDbInstance.query.commentReactions.findFirst.mockResolvedValue(null)

      const result = await commentService.toggleReaction(mockCommentId, emoji, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.added).toBe(true)
      }
    })

    it('should remove reaction if exists', async () => {
      mockDbInstance.query.commentReactions.findFirst.mockResolvedValue({
        id: reactionId,
        commentId: mockCommentId,
        userIdentifier: `member:${mockMemberId}`,
        emoji,
        createdAt: new Date(),
      })

      const result = await commentService.toggleReaction(mockCommentId, emoji, mockContext)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.added).toBe(false)
      }
    })

    it('should return error if comment not found', async () => {
      mockCommentRepoInstance.findById.mockResolvedValue(null)

      const result = await commentService.toggleReaction(mockCommentId, emoji, mockContext)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('COMMENT_NOT_FOUND')
      }
    })
  })

  describe('resolveCommentContext', () => {
    beforeEach(() => {
      mockDbInstance.query.comments.findFirst.mockResolvedValue({
        ...mockComment,
        post: {
          ...mockPost,
          board: mockBoard,
        },
      })
    })

    it('should resolve full context from comment ID', async () => {
      const result = await commentService.resolveCommentContext(mockCommentId)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.value.comment.id).toBe(mockCommentId)
        expect(result.value.post.id).toBe(mockPostId)
        expect(result.value.board.id).toBe(mockBoardId)
        expect(result.value.organizationId).toBe(mockOrgId)
      }
    })

    it('should return error if comment not found', async () => {
      mockDbInstance.query.comments.findFirst.mockResolvedValue(null)

      const result = await commentService.resolveCommentContext(mockCommentId)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('COMMENT_NOT_FOUND')
      }
    })

    it('should return error if post not found', async () => {
      mockDbInstance.query.comments.findFirst.mockResolvedValue({
        ...mockComment,
        post: null,
      })

      const result = await commentService.resolveCommentContext(mockCommentId)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('POST_NOT_FOUND')
      }
    })

    it('should return error if board not found', async () => {
      mockDbInstance.query.comments.findFirst.mockResolvedValue({
        ...mockComment,
        post: {
          ...mockPost,
          board: null,
        },
      })

      const result = await commentService.resolveCommentContext(mockCommentId)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('Board not found')
      }
    })

    it('should handle database errors gracefully', async () => {
      mockDbInstance.query.comments.findFirst.mockRejectedValue(new Error('Database error'))

      const result = await commentService.resolveCommentContext(mockCommentId)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR')
        expect(result.error.message).toContain('Failed to resolve comment context')
      }
    })
  })
})
