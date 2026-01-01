/**
 * CommentService - Business logic for comment operations
 *
 * This module handles all comment-related business logic including:
 * - Comment creation and updates
 * - Comment deletion
 * - Nested comment threading
 * - Reaction operations
 * - Validation and authorization
 */

import {
  db,
  eq,
  and,
  asc,
  isNull,
  comments,
  commentReactions,
  commentEditHistory,
  posts,
  boards,
  type Comment,
} from '@quackback/db'
import type { CommentId, PostId, MemberId } from '@quackback/ids'
import { ok, err, type Result } from '@/lib/shared'
import { CommentError } from './comment.errors'
import { subscribeToPost } from '@/lib/subscriptions/subscription.service'
import type {
  CreateCommentInput,
  CreateCommentResult,
  UpdateCommentInput,
  CommentThread,
  ReactionResult,
  CommentPermissionCheckResult,
} from './comment.types'
import { buildCommentTree, aggregateReactions } from '@/lib/shared'

// ============================================================================
// Helper Functions (Internal)
// ============================================================================

/**
 * Check if a comment has any reply from a team member
 * Recursively checks all descendants
 */
async function hasTeamMemberReply(commentId: CommentId): Promise<boolean> {
  // Find direct replies that are from team members and not deleted
  const replies = await db.query.comments.findMany({
    where: and(eq(comments.parentId, commentId), isNull(comments.deletedAt)),
  })

  for (const reply of replies) {
    if (reply.isTeamMember) {
      return true
    }
    // Recursively check replies
    const hasNestedTeamReply = await hasTeamMemberReply(reply.id)
    if (hasNestedTeamReply) {
      return true
    }
  }

  return false
}

// ============================================================================
// Comment CRUD Operations
// ============================================================================

/**
 * Create a new comment
 *
 * Validates that:
 * - Post exists and belongs to the organization
 * - Parent comment exists if specified
 * - Input data is valid
 *
 * @param input - Comment creation data
 * @param author - Author information with memberId, name, email, and role
 * @returns Result containing the created comment or an error
 */
export async function createComment(
  input: CreateCommentInput,
  author: {
    memberId: MemberId
    name: string
    email: string
    role: 'owner' | 'admin' | 'member' | 'user'
  }
): Promise<Result<CreateCommentResult, CommentError>> {
  return db.transaction(async (tx) => {
    // Validate post exists
    const post = await tx.query.posts.findFirst({
      where: eq(posts.id, input.postId),
    })
    if (!post) {
      return err(CommentError.postNotFound(input.postId))
    }

    // Verify post belongs to this organization (via its board)
    const board = await tx.query.boards.findFirst({
      where: eq(boards.id, post.boardId),
    })
    if (!board) {
      return err(CommentError.postNotFound(input.postId))
    }

    // Validate parent comment exists if specified
    if (input.parentId) {
      const parentComment = await tx.query.comments.findFirst({
        where: eq(comments.id, input.parentId),
      })
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
    const isTeamMember = ['owner', 'admin', 'member'].includes(author.role)

    // Create the comment
    const [comment] = await tx
      .insert(comments)
      .values({
        postId: input.postId,
        content: input.content.trim(),
        parentId: input.parentId || null,
        memberId: author.memberId,
        authorName: input.authorName || author.name,
        authorEmail: input.authorEmail || author.email,
        isTeamMember,
      })
      .returning()

    // Auto-subscribe commenter to the post (within the same transaction)
    if (author.memberId) {
      await subscribeToPost(author.memberId, input.postId, 'comment', {
        db: tx,
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
 * @param actor - Actor information with memberId and role
 * @returns Result containing the updated comment or an error
 */
export async function updateComment(
  id: CommentId,
  input: UpdateCommentInput,
  actor: { memberId: MemberId; role: 'owner' | 'admin' | 'member' | 'user' }
): Promise<Result<Comment, CommentError>> {
  return db.transaction(async (tx) => {
    // Get existing comment
    const existingComment = await tx.query.comments.findFirst({
      where: eq(comments.id, id),
    })
    if (!existingComment) {
      return err(CommentError.notFound(id))
    }

    // Verify comment belongs to this organization (via its post's board)
    const post = await tx.query.posts.findFirst({
      where: eq(posts.id, existingComment.postId),
    })
    if (!post) {
      return err(CommentError.postNotFound(existingComment.postId))
    }

    const board = await tx.query.boards.findFirst({
      where: eq(boards.id, post.boardId),
    })
    if (!board) {
      return err(CommentError.postNotFound(existingComment.postId))
    }

    // Authorization check - user must be comment author or team member
    const isAuthor = existingComment.memberId === actor.memberId
    const isTeamMember = ['owner', 'admin', 'member'].includes(actor.role)

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
    const [updatedComment] = await tx
      .update(comments)
      .set(updateData)
      .where(eq(comments.id, id))
      .returning()

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
 * @param actor - Actor information with memberId and role
 * @returns Result indicating success or an error
 */
export async function deleteComment(
  id: CommentId,
  actor: { memberId: MemberId; role: 'owner' | 'admin' | 'member' | 'user' }
): Promise<Result<void, CommentError>> {
  return db.transaction(async (tx) => {
    // Get existing comment
    const existingComment = await tx.query.comments.findFirst({
      where: eq(comments.id, id),
    })
    if (!existingComment) {
      return err(CommentError.notFound(id))
    }

    // Verify comment belongs to this organization (via its post's board)
    const post = await tx.query.posts.findFirst({
      where: eq(posts.id, existingComment.postId),
    })
    if (!post) {
      return err(CommentError.postNotFound(existingComment.postId))
    }

    const board = await tx.query.boards.findFirst({
      where: eq(boards.id, post.boardId),
    })
    if (!board) {
      return err(CommentError.postNotFound(existingComment.postId))
    }

    // Authorization check - user must be comment author or team member
    const isAuthor = existingComment.memberId === actor.memberId
    const isTeamMember = ['owner', 'admin', 'member'].includes(actor.role)

    if (!isAuthor && !isTeamMember) {
      return err(CommentError.unauthorized('delete this comment'))
    }

    // Delete the comment
    const result = await tx.delete(comments).where(eq(comments.id, id)).returning()
    if (result.length === 0) {
      return err(CommentError.notFound(id))
    }

    return ok(undefined)
  })
}

/**
 * Get a comment by ID
 *
 * @param id - Comment ID to fetch
 * @returns Result containing the comment or an error
 */
export async function getCommentById(id: CommentId): Promise<Result<Comment, CommentError>> {
  return db.transaction(async (tx) => {
    const comment = await tx.query.comments.findFirst({ where: eq(comments.id, id) })
    if (!comment) {
      return err(CommentError.notFound(id))
    }

    // Verify comment belongs to this organization (via its post's board)
    const post = await tx.query.posts.findFirst({ where: eq(posts.id, comment.postId) })
    if (!post) {
      return err(CommentError.postNotFound(comment.postId))
    }

    const board = await tx.query.boards.findFirst({ where: eq(boards.id, post.boardId) })
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
 * @param userIdentifier - User identifier for tracking reactions
 * @returns Result containing threaded comments or an error
 */
export async function getCommentsByPost(
  postId: PostId,
  userIdentifier: string
): Promise<Result<CommentThread[], CommentError>> {
  return db.transaction(async (tx) => {
    // Verify post exists
    const post = await tx.query.posts.findFirst({ where: eq(posts.id, postId) })
    if (!post) {
      return err(CommentError.postNotFound(postId))
    }

    // Verify post belongs to this organization
    const board = await tx.query.boards.findFirst({ where: eq(boards.id, post.boardId) })
    if (!board) {
      return err(CommentError.postNotFound(postId))
    }

    // Fetch all comments with reactions using a single query
    const commentsWithReactions = await tx.query.comments.findMany({
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
    const commentTree = buildCommentTree(formattedComments, userIdentifier)

    return ok(commentTree as CommentThread[])
  })
}

// ============================================================================
// Reaction Operations
// ============================================================================

/**
 * Add a reaction to a comment
 *
 * If the user has already reacted with this emoji, this is a no-op.
 * The actual toggle behavior is handled by the database unique constraint.
 *
 * @param commentId - Comment ID to react to
 * @param emoji - Emoji to add
 * @param userIdentifier - User identifier for tracking reactions
 * @returns Result containing reaction status or an error
 */
export async function addReaction(
  commentId: CommentId,
  emoji: string,
  userIdentifier: string
): Promise<Result<ReactionResult, CommentError>> {
  return db.transaction(async (tx) => {
    // Verify comment exists
    const comment = await tx.query.comments.findFirst({ where: eq(comments.id, commentId) })
    if (!comment) {
      return err(CommentError.notFound(commentId))
    }

    // Verify comment belongs to this organization (via its post's board)
    const post = await tx.query.posts.findFirst({ where: eq(posts.id, comment.postId) })
    if (!post) {
      return err(CommentError.postNotFound(comment.postId))
    }

    const board = await tx.query.boards.findFirst({ where: eq(boards.id, post.boardId) })
    if (!board) {
      return err(CommentError.postNotFound(comment.postId))
    }

    // Check if reaction already exists
    const existingReaction = await tx.query.commentReactions.findFirst({
      where: and(
        eq(commentReactions.commentId, commentId),
        eq(commentReactions.userIdentifier, userIdentifier),
        eq(commentReactions.emoji, emoji)
      ),
    })

    let added = false
    if (!existingReaction) {
      // Add reaction
      await tx.insert(commentReactions).values({
        commentId,
        userIdentifier,
        emoji,
      })
      added = true
    }

    // Fetch updated reactions
    const reactions = await tx.query.commentReactions.findMany({
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
 * @param userIdentifier - User identifier for tracking reactions
 * @returns Result containing reaction status or an error
 */
export async function removeReaction(
  commentId: CommentId,
  emoji: string,
  userIdentifier: string
): Promise<Result<ReactionResult, CommentError>> {
  return db.transaction(async (tx) => {
    // Verify comment exists
    const comment = await tx.query.comments.findFirst({ where: eq(comments.id, commentId) })
    if (!comment) {
      return err(CommentError.notFound(commentId))
    }

    // Verify comment belongs to this organization (via its post's board)
    const post = await tx.query.posts.findFirst({ where: eq(posts.id, comment.postId) })
    if (!post) {
      return err(CommentError.postNotFound(comment.postId))
    }

    const board = await tx.query.boards.findFirst({ where: eq(boards.id, post.boardId) })
    if (!board) {
      return err(CommentError.postNotFound(comment.postId))
    }

    // Check if reaction exists
    const existingReaction = await tx.query.commentReactions.findFirst({
      where: and(
        eq(commentReactions.commentId, commentId),
        eq(commentReactions.userIdentifier, userIdentifier),
        eq(commentReactions.emoji, emoji)
      ),
    })

    if (existingReaction) {
      // Remove reaction
      await tx.delete(commentReactions).where(eq(commentReactions.id, existingReaction.id))
    }

    // Fetch updated reactions
    const reactions = await tx.query.commentReactions.findMany({
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
 * Toggle reaction on a comment (add if not exists, remove if exists)
 *
 * Simplifies the API by combining add/remove logic.
 *
 * @param commentId - Comment ID to react to
 * @param emoji - Emoji to toggle
 * @param userIdentifier - User identifier for tracking reactions
 * @returns Result containing reaction status or an error
 */
export async function toggleReaction(
  commentId: CommentId,
  emoji: string,
  userIdentifier: string
): Promise<Result<ReactionResult, CommentError>> {
  return db.transaction(async (tx) => {
    // Verify comment exists
    const comment = await tx.query.comments.findFirst({ where: eq(comments.id, commentId) })
    if (!comment) {
      return err(CommentError.notFound(commentId))
    }

    // Verify comment belongs to this organization (via its post's board)
    const post = await tx.query.posts.findFirst({ where: eq(posts.id, comment.postId) })
    if (!post) {
      return err(CommentError.postNotFound(comment.postId))
    }

    const board = await tx.query.boards.findFirst({ where: eq(boards.id, post.boardId) })
    if (!board) {
      return err(CommentError.postNotFound(comment.postId))
    }

    // Check if reaction already exists
    const existingReaction = await tx.query.commentReactions.findFirst({
      where: and(
        eq(commentReactions.commentId, commentId),
        eq(commentReactions.userIdentifier, userIdentifier),
        eq(commentReactions.emoji, emoji)
      ),
    })

    let added: boolean
    if (existingReaction) {
      // Remove existing reaction
      await tx.delete(commentReactions).where(eq(commentReactions.id, existingReaction.id))
      added = false
    } else {
      // Add new reaction
      await tx.insert(commentReactions).values({
        commentId,
        userIdentifier,
        emoji,
      })
      added = true
    }

    // Fetch updated reactions
    const reactions = await tx.query.commentReactions.findMany({
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
// User Edit/Delete Operations
// ============================================================================

/**
 * Check if a user can edit a comment
 * User can edit if: they are the author AND no team member has replied
 *
 * @param commentId - Comment ID to check
 * @param actor - Actor information with memberId and role
 * @returns Result containing permission check result
 */
export async function canEditComment(
  commentId: CommentId,
  actor: { memberId: MemberId; role: 'owner' | 'admin' | 'member' | 'user' }
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
  if (actor.role && ['owner', 'admin', 'member'].includes(actor.role)) {
    return ok({ allowed: true })
  }

  // Must be the author
  if (comment.memberId !== actor.memberId) {
    return ok({ allowed: false, reason: 'You can only edit your own comments' })
  }

  // Check if any team member has replied to this comment
  const hasTeamReply = await hasTeamMemberReply(commentId)
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
 * @param actor - Actor information with memberId and role
 * @returns Result containing permission check result
 */
export async function canDeleteComment(
  commentId: CommentId,
  actor: { memberId: MemberId; role: 'owner' | 'admin' | 'member' | 'user' }
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
  if (actor.role && ['owner', 'admin', 'member'].includes(actor.role)) {
    return ok({ allowed: true })
  }

  // Must be the author
  if (comment.memberId !== actor.memberId) {
    return ok({ allowed: false, reason: 'You can only delete your own comments' })
  }

  // Check if any team member has replied to this comment
  const hasTeamReply = await hasTeamMemberReply(commentId)
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
 * @param actor - Actor information with memberId and role
 * @returns Result containing updated comment or error
 */
export async function userEditComment(
  commentId: CommentId,
  content: string,
  actor: { memberId: MemberId; role: 'owner' | 'admin' | 'member' | 'user' }
): Promise<Result<Comment, CommentError>> {
  // Check permission first
  const permResult = await canEditComment(commentId, actor)
  if (!permResult.success) {
    return err(permResult.error)
  }
  if (!permResult.value.allowed) {
    return err(CommentError.editNotAllowed(permResult.value.reason || 'Edit not allowed'))
  }

  return db.transaction(async (tx) => {
    // Get the existing comment
    const existingComment = await tx.query.comments.findFirst({
      where: eq(comments.id, commentId),
    })
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
    if (actor.memberId) {
      await tx.insert(commentEditHistory).values({
        commentId: commentId,
        editorMemberId: actor.memberId,
        previousContent: existingComment.content,
      })
    }

    // Update the comment (content only, not timestamps per PRD)
    const [updatedComment] = await tx
      .update(comments)
      .set({
        content: content.trim(),
      })
      .where(eq(comments.id, commentId))
      .returning()

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
 * @param actor - Actor information with memberId and role
 * @returns Result indicating success or error
 */
export async function softDeleteComment(
  commentId: CommentId,
  actor: { memberId: MemberId; role: 'owner' | 'admin' | 'member' | 'user' }
): Promise<Result<void, CommentError>> {
  // Check permission first
  const permResult = await canDeleteComment(commentId, actor)
  if (!permResult.success) {
    return err(permResult.error)
  }
  if (!permResult.value.allowed) {
    return err(CommentError.deleteNotAllowed(permResult.value.reason || 'Delete not allowed'))
  }

  return db.transaction(async (tx) => {
    // Set deletedAt
    const [updatedComment] = await tx
      .update(comments)
      .set({
        deletedAt: new Date(),
      })
      .where(eq(comments.id, commentId))
      .returning()

    if (!updatedComment) {
      return err(CommentError.notFound(commentId))
    }

    return ok(undefined)
  })
}
