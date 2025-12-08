/**
 * CommentService - Business logic for comment operations
 *
 * This service handles all comment-related business logic including:
 * - Comment creation and updates
 * - Comment deletion
 * - Nested comment threading
 * - Reaction operations
 * - Validation and authorization
 */

import {
  withUnitOfWork,
  CommentRepository,
  PostRepository,
  BoardRepository,
  db,
  eq,
  and,
  asc,
  comments,
  commentReactions,
  type Comment,
  type UnitOfWork,
} from '@quackback/db'
import type { ServiceContext } from '../shared/service-context'
import { ok, err, type Result } from '../shared/result'
import { CommentError } from './comment.errors'
import type {
  CreateCommentInput,
  UpdateCommentInput,
  CommentThread,
  ReactionResult,
  CommentContext,
} from './comment.types'
import { buildCommentTree, aggregateReactions } from '../shared/comment-tree'

/**
 * Service class for comment domain operations
 */
export class CommentService {
  /**
   * Create a new comment
   *
   * Validates that:
   * - Post exists and belongs to the organization
   * - Parent comment exists if specified
   * - Input data is valid
   *
   * @param input - Comment creation data
   * @param ctx - Service context with user/org information
   * @returns Result containing the created comment or an error
   */
  async createComment(
    input: CreateCommentInput,
    ctx: ServiceContext
  ): Promise<Result<Comment, CommentError>> {
    return withUnitOfWork(ctx.organizationId, async (uow: UnitOfWork) => {
      const commentRepo = new CommentRepository(uow.db)
      const postRepo = new PostRepository(uow.db)
      const boardRepo = new BoardRepository(uow.db)

      // Validate post exists
      const post = await postRepo.findById(input.postId)
      if (!post) {
        return err(CommentError.postNotFound(input.postId))
      }

      // Verify post belongs to this organization (via its board)
      const board = await boardRepo.findById(post.boardId)
      if (!board) {
        return err(CommentError.postNotFound(input.postId))
      }

      // Validate parent comment exists if specified
      if (input.parentId) {
        const parentComment = await commentRepo.findById(input.parentId)
        if (!parentComment) {
          return err(CommentError.invalidParent(input.parentId))
        }

        // Ensure parent comment belongs to the same post
        if (parentComment.postId !== input.postId) {
          return err(CommentError.validationError('Parent comment belongs to a different post'))
        }
      }

      // Validate input
      if (!input.content?.trim()) {
        return err(CommentError.validationError('Content is required'))
      }
      if (input.content.length > 5000) {
        return err(CommentError.validationError('Content must be 5,000 characters or less'))
      }

      // Determine if user is a team member
      const isTeamMember = ['owner', 'admin', 'member'].includes(ctx.memberRole)

      // Create the comment with member-scoped identity
      const comment = await commentRepo.create({
        postId: input.postId,
        content: input.content.trim(),
        parentId: input.parentId || null,
        memberId: ctx.memberId,
        // Legacy fields for display compatibility
        authorName: input.authorName || ctx.userName,
        authorEmail: input.authorEmail || ctx.userEmail,
        isTeamMember,
      })

      return ok(comment)
    })
  }

  /**
   * Update an existing comment
   *
   * Validates that:
   * - Comment exists and belongs to the organization
   * - User has permission to update the comment (must be the author or team member)
   * - Update data is valid
   *
   * @param id - Comment ID to update
   * @param input - Update data
   * @param ctx - Service context with user/org information
   * @returns Result containing the updated comment or an error
   */
  async updateComment(
    id: string,
    input: UpdateCommentInput,
    ctx: ServiceContext
  ): Promise<Result<Comment, CommentError>> {
    return withUnitOfWork(ctx.organizationId, async (uow: UnitOfWork) => {
      const commentRepo = new CommentRepository(uow.db)
      const postRepo = new PostRepository(uow.db)
      const boardRepo = new BoardRepository(uow.db)

      // Get existing comment
      const existingComment = await commentRepo.findById(id)
      if (!existingComment) {
        return err(CommentError.notFound(id))
      }

      // Verify comment belongs to this organization (via its post's board)
      const post = await postRepo.findById(existingComment.postId)
      if (!post) {
        return err(CommentError.postNotFound(existingComment.postId))
      }

      const board = await boardRepo.findById(post.boardId)
      if (!board) {
        return err(CommentError.postNotFound(existingComment.postId))
      }

      // Authorization check - user must be comment author or team member
      const isAuthor = existingComment.memberId === ctx.memberId
      const isTeamMember = ['owner', 'admin', 'member'].includes(ctx.memberRole)

      if (!isAuthor && !isTeamMember) {
        return err(CommentError.unauthorized('update this comment'))
      }

      // Validate input
      if (input.content !== undefined) {
        if (!input.content.trim()) {
          return err(CommentError.validationError('Content cannot be empty'))
        }
        if (input.content.length > 5000) {
          return err(CommentError.validationError('Content must be 5,000 characters or less'))
        }
      }

      // Build update data
      const updateData: Partial<Comment> = {}
      if (input.content !== undefined) updateData.content = input.content.trim()

      // Update the comment
      const updatedComment = await commentRepo.update(id, updateData)
      if (!updatedComment) {
        return err(CommentError.notFound(id))
      }

      return ok(updatedComment)
    })
  }

  /**
   * Delete a comment
   *
   * Validates that:
   * - Comment exists and belongs to the organization
   * - User has permission to delete the comment (must be the author or team member)
   *
   * Note: Deleting a comment will cascade delete all replies due to database constraints
   *
   * @param id - Comment ID to delete
   * @param ctx - Service context with user/org information
   * @returns Result indicating success or an error
   */
  async deleteComment(id: string, ctx: ServiceContext): Promise<Result<void, CommentError>> {
    return withUnitOfWork(ctx.organizationId, async (uow: UnitOfWork) => {
      const commentRepo = new CommentRepository(uow.db)
      const postRepo = new PostRepository(uow.db)
      const boardRepo = new BoardRepository(uow.db)

      // Get existing comment
      const existingComment = await commentRepo.findById(id)
      if (!existingComment) {
        return err(CommentError.notFound(id))
      }

      // Verify comment belongs to this organization (via its post's board)
      const post = await postRepo.findById(existingComment.postId)
      if (!post) {
        return err(CommentError.postNotFound(existingComment.postId))
      }

      const board = await boardRepo.findById(post.boardId)
      if (!board) {
        return err(CommentError.postNotFound(existingComment.postId))
      }

      // Authorization check - user must be comment author or team member
      const isAuthor = existingComment.memberId === ctx.memberId
      const isTeamMember = ['owner', 'admin', 'member'].includes(ctx.memberRole)

      if (!isAuthor && !isTeamMember) {
        return err(CommentError.unauthorized('delete this comment'))
      }

      // Delete the comment
      const deleted = await commentRepo.delete(id)
      if (!deleted) {
        return err(CommentError.notFound(id))
      }

      return ok(undefined)
    })
  }

  /**
   * Get a comment by ID
   *
   * @param id - Comment ID to fetch
   * @param ctx - Service context with user/org information
   * @returns Result containing the comment or an error
   */
  async getCommentById(id: string, ctx: ServiceContext): Promise<Result<Comment, CommentError>> {
    return withUnitOfWork(ctx.organizationId, async (uow: UnitOfWork) => {
      const commentRepo = new CommentRepository(uow.db)
      const postRepo = new PostRepository(uow.db)
      const boardRepo = new BoardRepository(uow.db)

      const comment = await commentRepo.findById(id)
      if (!comment) {
        return err(CommentError.notFound(id))
      }

      // Verify comment belongs to this organization (via its post's board)
      const post = await postRepo.findById(comment.postId)
      if (!post) {
        return err(CommentError.postNotFound(comment.postId))
      }

      const board = await boardRepo.findById(post.boardId)
      if (!board) {
        return err(CommentError.postNotFound(comment.postId))
      }

      return ok(comment)
    })
  }

  /**
   * Get all comments for a post as a threaded structure
   *
   * Returns comments organized in a tree structure with nested replies.
   * Includes reaction counts and whether the current user has reacted.
   *
   * @param postId - Post ID to fetch comments for
   * @param ctx - Service context with user/org information
   * @returns Result containing threaded comments or an error
   */
  async getCommentsByPost(
    postId: string,
    ctx: ServiceContext
  ): Promise<Result<CommentThread[], CommentError>> {
    return withUnitOfWork(ctx.organizationId, async (uow: UnitOfWork) => {
      const postRepo = new PostRepository(uow.db)
      const boardRepo = new BoardRepository(uow.db)

      // Verify post exists
      const post = await postRepo.findById(postId)
      if (!post) {
        return err(CommentError.postNotFound(postId))
      }

      // Verify post belongs to this organization
      const board = await boardRepo.findById(post.boardId)
      if (!board) {
        return err(CommentError.postNotFound(postId))
      }

      // Fetch all comments with reactions using a single query
      const commentsWithReactions = await uow.db.query.comments.findMany({
        where: eq(comments.postId, postId),
        with: {
          reactions: true,
        },
        orderBy: asc(comments.createdAt),
      })

      // Transform to the format expected by buildCommentTree
      const formattedComments = commentsWithReactions.map((comment) => ({
        id: comment.id,
        postId: comment.postId,
        parentId: comment.parentId,
        memberId: comment.memberId,
        authorId: comment.authorId,
        authorName: comment.authorName,
        authorEmail: comment.authorEmail,
        content: comment.content,
        isTeamMember: comment.isTeamMember,
        createdAt: comment.createdAt,
        reactions: comment.reactions.map((r) => ({
          emoji: r.emoji,
          userIdentifier: r.userIdentifier,
        })),
      }))

      // Build comment tree with reaction aggregation
      const userIdentifier = ctx.userIdentifier || `member:${ctx.memberId}`
      const commentTree = buildCommentTree(formattedComments, userIdentifier)

      return ok(commentTree as CommentThread[])
    })
  }

  /**
   * Add a reaction to a comment
   *
   * If the user has already reacted with this emoji, this is a no-op.
   * The actual toggle behavior is handled by the database unique constraint.
   *
   * @param commentId - Comment ID to react to
   * @param emoji - Emoji to add
   * @param ctx - Service context with user/org information
   * @returns Result containing reaction status or an error
   */
  async addReaction(
    commentId: string,
    emoji: string,
    ctx: ServiceContext
  ): Promise<Result<ReactionResult, CommentError>> {
    return withUnitOfWork(ctx.organizationId, async (uow: UnitOfWork) => {
      const commentRepo = new CommentRepository(uow.db)
      const postRepo = new PostRepository(uow.db)
      const boardRepo = new BoardRepository(uow.db)

      // Verify comment exists
      const comment = await commentRepo.findById(commentId)
      if (!comment) {
        return err(CommentError.notFound(commentId))
      }

      // Verify comment belongs to this organization (via its post's board)
      const post = await postRepo.findById(comment.postId)
      if (!post) {
        return err(CommentError.postNotFound(comment.postId))
      }

      const board = await boardRepo.findById(post.boardId)
      if (!board) {
        return err(CommentError.postNotFound(comment.postId))
      }

      // Get user identifier for tracking
      const userIdentifier = ctx.userIdentifier || `member:${ctx.memberId}`

      // Check if reaction already exists
      const existingReaction = await uow.db.query.commentReactions.findFirst({
        where: and(
          eq(commentReactions.commentId, commentId),
          eq(commentReactions.userIdentifier, userIdentifier),
          eq(commentReactions.emoji, emoji)
        ),
      })

      let added = false
      if (!existingReaction) {
        // Add reaction
        await uow.db.insert(commentReactions).values({
          commentId,
          userIdentifier,
          emoji,
        })
        added = true
      }

      // Fetch updated reactions
      const reactions = await uow.db.query.commentReactions.findMany({
        where: eq(commentReactions.commentId, commentId),
      })

      const aggregatedReactions = aggregateReactions(
        reactions.map((r) => ({
          emoji: r.emoji,
          userIdentifier: r.userIdentifier,
        })),
        userIdentifier
      )

      return ok({ added, reactions: aggregatedReactions })
    })
  }

  /**
   * Remove a reaction from a comment
   *
   * If the user hasn't reacted with this emoji, this is a no-op.
   *
   * @param commentId - Comment ID to remove reaction from
   * @param emoji - Emoji to remove
   * @param ctx - Service context with user/org information
   * @returns Result containing reaction status or an error
   */
  async removeReaction(
    commentId: string,
    emoji: string,
    ctx: ServiceContext
  ): Promise<Result<ReactionResult, CommentError>> {
    return withUnitOfWork(ctx.organizationId, async (uow: UnitOfWork) => {
      const commentRepo = new CommentRepository(uow.db)
      const postRepo = new PostRepository(uow.db)
      const boardRepo = new BoardRepository(uow.db)

      // Verify comment exists
      const comment = await commentRepo.findById(commentId)
      if (!comment) {
        return err(CommentError.notFound(commentId))
      }

      // Verify comment belongs to this organization (via its post's board)
      const post = await postRepo.findById(comment.postId)
      if (!post) {
        return err(CommentError.postNotFound(comment.postId))
      }

      const board = await boardRepo.findById(post.boardId)
      if (!board) {
        return err(CommentError.postNotFound(comment.postId))
      }

      // Get user identifier for tracking
      const userIdentifier = ctx.userIdentifier || `member:${ctx.memberId}`

      // Check if reaction exists
      const existingReaction = await uow.db.query.commentReactions.findFirst({
        where: and(
          eq(commentReactions.commentId, commentId),
          eq(commentReactions.userIdentifier, userIdentifier),
          eq(commentReactions.emoji, emoji)
        ),
      })

      if (existingReaction) {
        // Remove reaction
        await uow.db.delete(commentReactions).where(eq(commentReactions.id, existingReaction.id))
      }

      // Fetch updated reactions
      const reactions = await uow.db.query.commentReactions.findMany({
        where: eq(commentReactions.commentId, commentId),
      })

      const aggregatedReactions = aggregateReactions(
        reactions.map((r) => ({
          emoji: r.emoji,
          userIdentifier: r.userIdentifier,
        })),
        userIdentifier
      )

      return ok({ added: false, reactions: aggregatedReactions })
    })
  }

  /**
   * Resolve organization context from a comment ID
   *
   * Traverses: Comment -> Post -> Board -> Organization
   * Used by public API routes that need to check permissions without full auth context.
   * This is a PUBLIC method - no authentication required.
   *
   * @param commentId - Comment ID to resolve context for
   * @returns Result containing the full context or an error
   */
  async resolveCommentContext(commentId: string): Promise<Result<CommentContext, CommentError>> {
    try {
      // Fetch comment with its post and board in a single query
      const comment = await db.query.comments.findFirst({
        where: eq(comments.id, commentId),
        with: {
          post: {
            with: {
              board: true,
            },
          },
        },
      })

      if (!comment) {
        return err(CommentError.notFound(commentId))
      }

      if (!comment.post) {
        return err(CommentError.postNotFound(comment.postId))
      }

      if (!comment.post.board) {
        return err(CommentError.validationError('Board not found for post'))
      }

      return ok({
        comment: {
          id: comment.id,
          postId: comment.postId,
          content: comment.content,
          parentId: comment.parentId,
          memberId: comment.memberId,
          authorName: comment.authorName,
          createdAt: comment.createdAt,
        },
        post: {
          id: comment.post.id,
          boardId: comment.post.boardId,
          title: comment.post.title,
        },
        board: {
          id: comment.post.board.id,
          organizationId: comment.post.board.organizationId,
          name: comment.post.board.name,
          slug: comment.post.board.slug,
        },
        organizationId: comment.post.board.organizationId,
      })
    } catch (error) {
      return err(
        CommentError.validationError(
          `Failed to resolve comment context: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Toggle reaction on a comment (add if not exists, remove if exists)
   *
   * Simplifies the API by combining add/remove logic.
   *
   * @param commentId - Comment ID to react to
   * @param emoji - Emoji to toggle
   * @param ctx - Service context with user/org information
   * @returns Result containing reaction status or an error
   */
  async toggleReaction(
    commentId: string,
    emoji: string,
    ctx: ServiceContext
  ): Promise<Result<ReactionResult, CommentError>> {
    return withUnitOfWork(ctx.organizationId, async (uow: UnitOfWork) => {
      const commentRepo = new CommentRepository(uow.db)
      const postRepo = new PostRepository(uow.db)
      const boardRepo = new BoardRepository(uow.db)

      // Verify comment exists
      const comment = await commentRepo.findById(commentId)
      if (!comment) {
        return err(CommentError.notFound(commentId))
      }

      // Verify comment belongs to this organization (via its post's board)
      const post = await postRepo.findById(comment.postId)
      if (!post) {
        return err(CommentError.postNotFound(comment.postId))
      }

      const board = await boardRepo.findById(post.boardId)
      if (!board) {
        return err(CommentError.postNotFound(comment.postId))
      }

      // Get user identifier for tracking
      const userIdentifier = ctx.userIdentifier || `member:${ctx.memberId}`

      // Check if reaction already exists
      const existingReaction = await uow.db.query.commentReactions.findFirst({
        where: and(
          eq(commentReactions.commentId, commentId),
          eq(commentReactions.userIdentifier, userIdentifier),
          eq(commentReactions.emoji, emoji)
        ),
      })

      let added: boolean
      if (existingReaction) {
        // Remove existing reaction
        await uow.db.delete(commentReactions).where(eq(commentReactions.id, existingReaction.id))
        added = false
      } else {
        // Add new reaction
        await uow.db.insert(commentReactions).values({
          commentId,
          userIdentifier,
          emoji,
        })
        added = true
      }

      // Fetch updated reactions
      const reactions = await uow.db.query.commentReactions.findMany({
        where: eq(commentReactions.commentId, commentId),
      })

      const aggregatedReactions = aggregateReactions(
        reactions.map((r) => ({
          emoji: r.emoji,
          userIdentifier: r.userIdentifier,
        })),
        userIdentifier
      )

      return ok({ added, reactions: aggregatedReactions })
    })
  }
}

/**
 * Singleton instance of CommentService
 * Export as default for easy importing
 */
export const commentService = new CommentService()
