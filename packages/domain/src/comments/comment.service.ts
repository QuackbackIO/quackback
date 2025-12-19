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
  isNull,
  comments,
  commentReactions,
  commentEditHistory,
  type Comment,
  type UnitOfWork,
} from '@quackback/db'
import type { CommentId, PostId } from '@quackback/ids'
import type { ServiceContext } from '../shared/service-context'
import { ok, err, type Result } from '../shared/result'
import { CommentError } from './comment.errors'
import { SubscriptionService } from '../subscriptions'
import type {
  CreateCommentInput,
  CreateCommentResult,
  UpdateCommentInput,
  CommentThread,
  ReactionResult,
  CommentContext,
  CommentPermissionCheckResult,
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
  ): Promise<Result<CreateCommentResult, CommentError>> {
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
      // Convert member TypeID back to raw UUID for database foreign key
      const comment = await commentRepo.create({
        organizationId: ctx.organizationId,
        postId: input.postId,
        content: input.content.trim(),
        parentId: input.parentId || null,
        memberId: ctx.memberId,
        authorName: input.authorName || ctx.userName,
        authorEmail: input.authorEmail || ctx.userEmail,
        isTeamMember,
      })

      // Auto-subscribe commenter to the post (within the same transaction)
      if (ctx.memberId) {
        const subscriptionService = new SubscriptionService()
        await subscriptionService.subscribeToPost(ctx.memberId, input.postId, 'comment', {
          organizationId: ctx.organizationId,
          db: uow.db,
        })
      }

      // Return comment with post info for event building in API route
      return ok({ comment, post: { id: post.id, title: post.title } })
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
    id: CommentId,
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
  async deleteComment(id: CommentId, ctx: ServiceContext): Promise<Result<void, CommentError>> {
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
  async getCommentById(id: CommentId, ctx: ServiceContext): Promise<Result<Comment, CommentError>> {
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
    postId: PostId,
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
    commentId: CommentId,
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
    commentId: CommentId,
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
  async resolveCommentContext(commentId: CommentId): Promise<Result<CommentContext, CommentError>> {
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
    commentId: CommentId,
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

  // ============================================================================
  // User Edit/Delete Methods
  // ============================================================================

  /**
   * Check if a user can edit a comment
   * User can edit if: they are the author AND no team member has replied
   *
   * @param commentId - Comment ID to check
   * @param ctx - Service context with user/org information
   * @returns Result containing permission check result
   */
  async canEditComment(
    commentId: CommentId,
    ctx: ServiceContext
  ): Promise<Result<CommentPermissionCheckResult, CommentError>> {
    // Get the comment
    const comment = await db.query.comments.findFirst({
      where: eq(comments.id, commentId),
    })

    if (!comment) {
      return err(CommentError.notFound(commentId))
    }

    // Check if comment is deleted
    if (comment.deletedAt) {
      return ok({ allowed: false, reason: 'Cannot edit a deleted comment' })
    }

    // Team members (owner, admin, member) can always edit
    if (ctx.memberRole && ['owner', 'admin', 'member'].includes(ctx.memberRole)) {
      return ok({ allowed: true })
    }

    // Must be the author
    if (comment.memberId !== ctx.memberId) {
      return ok({ allowed: false, reason: 'You can only edit your own comments' })
    }

    // Check if any team member has replied to this comment
    const hasTeamReply = await this.hasTeamMemberReply(commentId)
    if (hasTeamReply) {
      return ok({
        allowed: false,
        reason: 'Cannot edit comments that have received team member replies',
      })
    }

    return ok({ allowed: true })
  }

  /**
   * Check if a user can delete a comment
   * User can delete if: they are the author AND no team member has replied
   *
   * @param commentId - Comment ID to check
   * @param ctx - Service context with user/org information
   * @returns Result containing permission check result
   */
  async canDeleteComment(
    commentId: CommentId,
    ctx: ServiceContext
  ): Promise<Result<CommentPermissionCheckResult, CommentError>> {
    // Get the comment
    const comment = await db.query.comments.findFirst({
      where: eq(comments.id, commentId),
    })

    if (!comment) {
      return err(CommentError.notFound(commentId))
    }

    // Check if comment is already deleted
    if (comment.deletedAt) {
      return ok({ allowed: false, reason: 'Comment has already been deleted' })
    }

    // Team members (owner, admin, member) can always delete
    if (ctx.memberRole && ['owner', 'admin', 'member'].includes(ctx.memberRole)) {
      return ok({ allowed: true })
    }

    // Must be the author
    if (comment.memberId !== ctx.memberId) {
      return ok({ allowed: false, reason: 'You can only delete your own comments' })
    }

    // Check if any team member has replied to this comment
    const hasTeamReply = await this.hasTeamMemberReply(commentId)
    if (hasTeamReply) {
      return ok({
        allowed: false,
        reason: 'Cannot delete comments that have received team member replies',
      })
    }

    return ok({ allowed: true })
  }

  /**
   * User edits their own comment
   * Validates permissions and updates content only (not timestamps)
   *
   * @param commentId - Comment ID to edit
   * @param content - New content
   * @param ctx - Service context with user/org information
   * @returns Result containing updated comment or error
   */
  async userEditComment(
    commentId: CommentId,
    content: string,
    ctx: ServiceContext
  ): Promise<Result<Comment, CommentError>> {
    // Check permission first
    const permResult = await this.canEditComment(commentId, ctx)
    if (!permResult.success) {
      return err(permResult.error)
    }
    if (!permResult.value.allowed) {
      return err(CommentError.editNotAllowed(permResult.value.reason || 'Edit not allowed'))
    }

    return withUnitOfWork(ctx.organizationId, async (uow: UnitOfWork) => {
      const commentRepo = new CommentRepository(uow.db)

      // Get the existing comment
      const existingComment = await commentRepo.findById(commentId)
      if (!existingComment) {
        return err(CommentError.notFound(commentId))
      }

      // Validate input
      if (!content?.trim()) {
        return err(CommentError.validationError('Content is required'))
      }
      if (content.length > 5000) {
        return err(CommentError.validationError('Content must be 5,000 characters or less'))
      }

      // Record edit history (always record for comments)
      if (ctx.memberId) {
        await uow.db.insert(commentEditHistory).values({
          organizationId: ctx.organizationId,
          commentId: commentId,
          editorMemberId: ctx.memberId,
          previousContent: existingComment.content,
        })
      }

      // Update the comment (content only, not timestamps per PRD)
      const updatedComment = await commentRepo.update(commentId, {
        content: content.trim(),
      })

      if (!updatedComment) {
        return err(CommentError.notFound(commentId))
      }

      return ok(updatedComment)
    })
  }

  /**
   * Soft delete a comment
   * Sets deletedAt timestamp, shows placeholder text in threads
   *
   * @param commentId - Comment ID to delete
   * @param ctx - Service context with user/org information
   * @returns Result indicating success or error
   */
  async softDeleteComment(
    commentId: CommentId,
    ctx: ServiceContext
  ): Promise<Result<void, CommentError>> {
    // Check permission first
    const permResult = await this.canDeleteComment(commentId, ctx)
    if (!permResult.success) {
      return err(permResult.error)
    }
    if (!permResult.value.allowed) {
      return err(CommentError.deleteNotAllowed(permResult.value.reason || 'Delete not allowed'))
    }

    return withUnitOfWork(ctx.organizationId, async (uow: UnitOfWork) => {
      const commentRepo = new CommentRepository(uow.db)

      // Set deletedAt
      const updatedComment = await commentRepo.update(commentId, {
        deletedAt: new Date(),
      })

      if (!updatedComment) {
        return err(CommentError.notFound(commentId))
      }

      return ok(undefined)
    })
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Check if a comment has any reply from a team member
   * Recursively checks all descendants
   */
  private async hasTeamMemberReply(commentId: CommentId): Promise<boolean> {
    // Find direct replies that are from team members and not deleted
    const replies = await db.query.comments.findMany({
      where: and(eq(comments.parentId, commentId), isNull(comments.deletedAt)),
    })

    for (const reply of replies) {
      if (reply.isTeamMember) {
        return true
      }
      // Recursively check replies
      const hasNestedTeamReply = await this.hasTeamMemberReply(reply.id)
      if (hasNestedTeamReply) {
        return true
      }
    }

    return false
  }
}

/**
 * Singleton instance of CommentService
 * Export as default for easy importing
 */
export const commentService = new CommentService()
