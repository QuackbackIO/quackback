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
  sql,
  comments,
  commentReactions,
  commentEditHistory,
  posts,
  boards,
  type Comment,
} from '@/lib/server/db'
import {
  createId,
  toUuid,
  type CommentId,
  type PostId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/shared/errors'
import { subscribeToPost } from '@/lib/server/domains/subscriptions/subscription.service'
import { dispatchCommentCreated, buildEventActor } from '@/lib/server/events/dispatch'
import type {
  CreateCommentInput,
  CreateCommentResult,
  UpdateCommentInput,
  CommentThread,
  ReactionResult,
  CommentPermissionCheckResult,
} from './comment.types'
import { buildCommentTree, aggregateReactions } from '@/lib/shared'
import { getExecuteRows } from '@/lib/server/utils'

// ============================================================================
// Helper Functions (Internal)
// ============================================================================

/**
 * Check if a comment has any reply from a team member
 * Recursively checks all descendants
 */
async function hasTeamMemberReply(commentId: CommentId): Promise<boolean> {
  const replies = await db.query.comments.findMany({
    where: and(eq(comments.parentId, commentId), isNull(comments.deletedAt)),
  })

  for (const reply of replies) {
    if (reply.isTeamMember) {
      return true
    }
    if (await hasTeamMemberReply(reply.id)) {
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
 * Dispatches a comment.created event for webhooks, Slack, etc.
 *
 * @param input - Comment creation data
 * @param author - Author information with principalId, userId, name, email, and role
 * @returns Result containing the created comment or an error
 */
export async function createComment(
  input: CreateCommentInput,
  author: {
    principalId: PrincipalId
    userId?: UserId
    name?: string
    email?: string
    displayName?: string
    role: 'admin' | 'member' | 'user'
  }
): Promise<CreateCommentResult> {
  // Validate post exists and eagerly load board in single query
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, input.postId),
    with: { board: true },
  })
  if (!post || !post.board) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${input.postId} not found`)
  }
  const board = post.board

  // Validate parent comment exists if specified
  if (input.parentId) {
    const parentComment = await db.query.comments.findFirst({
      where: eq(comments.id, input.parentId),
    })
    if (!parentComment) {
      throw new ValidationError(
        'INVALID_PARENT',
        `Parent comment with ID ${input.parentId} not found`
      )
    }

    // Ensure parent comment belongs to the same post
    if (parentComment.postId !== input.postId) {
      throw new ValidationError('VALIDATION_ERROR', 'Parent comment belongs to a different post')
    }
  }

  // Validate input
  if (!input.content?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Content is required')
  }
  if (input.content.length > 5000) {
    throw new ValidationError('VALIDATION_ERROR', 'Content must be 5,000 characters or less')
  }

  // Determine if user is a team member
  const isTeamMember = ['admin', 'member'].includes(author.role)

  // Create the comment
  const [comment] = await db
    .insert(comments)
    .values({
      postId: input.postId,
      content: input.content.trim(),
      parentId: input.parentId || null,
      principalId: author.principalId,
      isTeamMember,
    })
    .returning()

  // Auto-subscribe commenter to the post
  if (author.principalId) {
    await subscribeToPost(author.principalId, input.postId, 'comment')
  }

  // Dispatch comment.created event for webhooks, Slack, etc.
  const actorName = author.displayName ?? author.name
  await dispatchCommentCreated(
    buildEventActor(author),
    {
      id: comment.id,
      content: comment.content,
      authorName: actorName,
      authorEmail: author.email,
    },
    {
      id: post.id,
      title: post.title,
      boardId: board.id,
      boardSlug: board.slug,
    }
  )

  return { comment, post: { id: post.id, title: post.title, boardSlug: board.slug } }
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
 * @param actor - Actor information with principalId and role
 * @returns Result containing the updated comment or an error
 */
export async function updateComment(
  id: CommentId,
  input: UpdateCommentInput,
  actor: { principalId: PrincipalId; role: 'admin' | 'member' | 'user' }
): Promise<Comment> {
  // Get existing comment with post and board in single query
  const existingComment = await db.query.comments.findFirst({
    where: eq(comments.id, id),
    with: {
      post: {
        with: { board: true },
      },
    },
  })
  if (!existingComment) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${id} not found`)
  }
  if (!existingComment.post || !existingComment.post.board) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${existingComment.postId} not found`)
  }

  // Authorization check - user must be comment author or team member
  const isAuthor = existingComment.principalId === actor.principalId
  const isTeamMember = ['admin', 'member'].includes(actor.role)

  if (!isAuthor && !isTeamMember) {
    throw new ForbiddenError('UNAUTHORIZED', 'You are not authorized to update this comment')
  }

  // Validate input
  if (input.content !== undefined) {
    if (!input.content.trim()) {
      throw new ValidationError('VALIDATION_ERROR', 'Content cannot be empty')
    }
    if (input.content.length > 5000) {
      throw new ValidationError('VALIDATION_ERROR', 'Content must be 5,000 characters or less')
    }
  }

  // Build update data
  const updateData: Partial<Comment> = {}
  if (input.content !== undefined) updateData.content = input.content.trim()

  // Update the comment
  const [updatedComment] = await db
    .update(comments)
    .set(updateData)
    .where(eq(comments.id, id))
    .returning()

  if (!updatedComment) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${id} not found`)
  }

  return updatedComment
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
 * @param actor - Actor information with principalId and role
 * @returns Result indicating success or an error
 */
export async function deleteComment(
  id: CommentId,
  actor: { principalId: PrincipalId; role: 'admin' | 'member' | 'user' }
): Promise<void> {
  // Get existing comment with post and board in single query
  const existingComment = await db.query.comments.findFirst({
    where: eq(comments.id, id),
    with: {
      post: {
        with: { board: true },
      },
    },
  })
  if (!existingComment) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${id} not found`)
  }
  if (!existingComment.post || !existingComment.post.board) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${existingComment.postId} not found`)
  }

  // Authorization check - user must be comment author or team member
  const isAuthor = existingComment.principalId === actor.principalId
  const isTeamMember = ['admin', 'member'].includes(actor.role)

  if (!isAuthor && !isTeamMember) {
    throw new ForbiddenError('UNAUTHORIZED', 'You are not authorized to delete this comment')
  }

  // Delete the comment
  const result = await db.delete(comments).where(eq(comments.id, id)).returning()
  if (result.length === 0) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${id} not found`)
  }
}

/**
 * Get a comment by ID
 *
 * @param id - Comment ID to fetch
 * @returns Result containing the comment or an error
 */
export async function getCommentById(
  id: CommentId
): Promise<Comment & { authorName: string | null; authorEmail: string | null }> {
  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, id),
    with: {
      author: {
        columns: { displayName: true },
        with: {
          user: {
            columns: { email: true },
          },
        },
      },
    },
  })
  if (!comment) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${id} not found`)
  }

  // Verify comment belongs to this organization (via its post's board)
  const post = await db.query.posts.findFirst({ where: eq(posts.id, comment.postId) })
  if (!post) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${comment.postId} not found`)
  }

  const board = await db.query.boards.findFirst({ where: eq(boards.id, post.boardId) })
  if (!board) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${comment.postId} not found`)
  }

  return {
    ...comment,
    authorName: comment.author?.displayName ?? null,
    authorEmail: comment.author?.user?.email ?? null,
  }
}

/**
 * Get all comments for a post as a threaded structure
 *
 * Returns comments organized in a tree structure with nested replies.
 * Includes reaction counts and whether the current user has reacted.
 *
 * @param postId - Post ID to fetch comments for
 * @param principalId - Principal ID for tracking reactions (optional)
 * @returns Result containing threaded comments or an error
 */
export async function getCommentsByPost(
  postId: PostId,
  principalId?: PrincipalId
): Promise<CommentThread[]> {
  // Verify post exists
  const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
  if (!post) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Verify post belongs to this organization
  const board = await db.query.boards.findFirst({ where: eq(boards.id, post.boardId) })
  if (!board) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Fetch all comments with reactions and author info via member->user relation
  const commentsWithReactions = await db.query.comments.findMany({
    where: eq(comments.postId, postId),
    with: {
      reactions: true,
      author: {
        columns: { displayName: true },
      },
    },
    orderBy: asc(comments.createdAt),
  })

  // Transform to the format expected by buildCommentTree
  const formattedComments = commentsWithReactions.map((comment) => ({
    id: comment.id,
    postId: comment.postId,
    parentId: comment.parentId,
    principalId: comment.principalId,
    authorName: comment.author?.displayName ?? null,
    content: comment.content,
    isTeamMember: comment.isTeamMember,
    createdAt: comment.createdAt,
    reactions: comment.reactions.map((r) => ({
      emoji: r.emoji,
      principalId: r.principalId,
    })),
  }))

  // Build comment tree with reaction aggregation
  const commentTree = buildCommentTree(formattedComments, principalId)

  return commentTree as CommentThread[]
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
 * @param principalId - Principal ID (required - auth only)
 * @returns Result containing reaction status or an error
 */
export async function addReaction(
  commentId: CommentId,
  emoji: string,
  principalId: PrincipalId
): Promise<ReactionResult> {
  // Verify comment exists with post and board in single query
  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, commentId),
    with: {
      post: {
        with: { board: true },
      },
    },
  })
  if (!comment) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${commentId} not found`)
  }
  if (!comment.post || !comment.post.board) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${comment.postId} not found`)
  }

  // Atomically insert reaction (uses unique constraint to prevent duplicates)
  const inserted = await db
    .insert(commentReactions)
    .values({
      commentId,
      principalId,
      emoji,
    })
    .onConflictDoNothing()
    .returning()

  const added = inserted.length > 0

  // Fetch updated reactions
  const reactions = await db.query.commentReactions.findMany({
    where: eq(commentReactions.commentId, commentId),
  })

  const aggregatedReactions = aggregateReactions(
    reactions.map((r) => ({
      emoji: r.emoji,
      principalId: r.principalId,
    })),
    principalId
  )

  return { added, reactions: aggregatedReactions }
}

/**
 * Remove a reaction from a comment
 *
 * If the user hasn't reacted with this emoji, this is a no-op.
 *
 * @param commentId - Comment ID to remove reaction from
 * @param emoji - Emoji to remove
 * @param principalId - Principal ID (required - auth only)
 * @returns Result containing reaction status or an error
 */
export async function removeReaction(
  commentId: CommentId,
  emoji: string,
  principalId: PrincipalId
): Promise<ReactionResult> {
  // Verify comment exists with post and board in single query
  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, commentId),
    with: {
      post: {
        with: { board: true },
      },
    },
  })
  if (!comment) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${commentId} not found`)
  }
  if (!comment.post || !comment.post.board) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${comment.postId} not found`)
  }

  // Directly delete (no need to check first - idempotent operation)
  await db
    .delete(commentReactions)
    .where(
      and(
        eq(commentReactions.commentId, commentId),
        eq(commentReactions.principalId, principalId),
        eq(commentReactions.emoji, emoji)
      )
    )

  // Fetch updated reactions
  const reactions = await db.query.commentReactions.findMany({
    where: eq(commentReactions.commentId, commentId),
  })

  const aggregatedReactions = aggregateReactions(
    reactions.map((r) => ({
      emoji: r.emoji,
      principalId: r.principalId,
    })),
    principalId
  )

  return { added: false, reactions: aggregatedReactions }
}

/**
 * Toggle reaction on a comment (add if not exists, remove if exists)
 *
 * Simplifies the API by combining add/remove logic.
 *
 * @param commentId - Comment ID to react to
 * @param emoji - Emoji to toggle
 * @param principalId - Principal ID for tracking reactions (required - auth only)
 * @returns Result containing reaction status or an error
 */
export async function toggleReaction(
  commentId: CommentId,
  emoji: string,
  principalId: PrincipalId
): Promise<ReactionResult> {
  // Verify comment exists with post and board in single query
  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, commentId),
    with: {
      post: {
        with: { board: true },
      },
    },
  })
  if (!comment) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${commentId} not found`)
  }
  if (!comment.post || !comment.post.board) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${comment.postId} not found`)
  }

  const commentUuid = toUuid(commentId)
  const principalUuid = toUuid(principalId)
  const reactionId = toUuid(createId('reaction'))

  // Atomic toggle: delete if exists, insert if not
  // Uses CTE to avoid race conditions between check and action
  const toggleResult = await db.execute(sql`
    WITH existing AS (
      SELECT id FROM comment_reactions
      WHERE comment_id = ${commentUuid}
        AND principal_id = ${principalUuid}
        AND emoji = ${emoji}
    ),
    deleted AS (
      DELETE FROM comment_reactions
      WHERE id IN (SELECT id FROM existing)
      RETURNING id
    ),
    inserted AS (
      INSERT INTO comment_reactions (id, comment_id, principal_id, emoji, created_at)
      SELECT ${reactionId}::uuid, ${commentUuid}, ${principalUuid}, ${emoji}, NOW()
      WHERE NOT EXISTS (SELECT 1 FROM existing)
      ON CONFLICT (comment_id, principal_id, emoji) DO NOTHING
      RETURNING id
    )
    SELECT
      EXISTS (SELECT 1 FROM inserted) as added,
      EXISTS (SELECT 1 FROM deleted) as removed
  `)

  const toggleRows = getExecuteRows<{ added: boolean; removed: boolean }>(toggleResult)
  const added = toggleRows[0]?.added ?? false

  // Fetch updated reactions
  const reactions = await db.query.commentReactions.findMany({
    where: eq(commentReactions.commentId, commentId),
  })

  const aggregatedReactions = aggregateReactions(
    reactions.map((r) => ({
      emoji: r.emoji,
      principalId: r.principalId,
    })),
    principalId
  )

  return { added, reactions: aggregatedReactions }
}

// ============================================================================
// User Edit/Delete Operations
// ============================================================================

/**
 * Check if a user can edit a comment
 * User can edit if: they are the author AND no team member has replied
 *
 * @param commentId - Comment ID to check
 * @param actor - Actor information with principalId and role
 * @returns Result containing permission check result
 */
export async function canEditComment(
  commentId: CommentId,
  actor: { principalId: PrincipalId; role: 'admin' | 'member' | 'user' }
): Promise<CommentPermissionCheckResult> {
  // Get the comment
  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, commentId),
  })

  if (!comment) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${commentId} not found`)
  }

  // Check if comment is deleted
  if (comment.deletedAt) {
    return { allowed: false, reason: 'Cannot edit a deleted comment' }
  }

  // Team members (admin, member) can always edit
  if (actor.role && ['admin', 'member'].includes(actor.role)) {
    return { allowed: true }
  }

  // Must be the author
  if (comment.principalId !== actor.principalId) {
    return { allowed: false, reason: 'You can only edit your own comments' }
  }

  // Check if any team member has replied to this comment
  const hasTeamReply = await hasTeamMemberReply(commentId)
  if (hasTeamReply) {
    return {
      allowed: false,
      reason: 'Cannot edit comments that have received team member replies',
    }
  }

  return { allowed: true }
}

/**
 * Check if a user can delete a comment
 * User can delete if: they are the author AND no team member has replied
 *
 * @param commentId - Comment ID to check
 * @param actor - Actor information with principalId and role
 * @returns Result containing permission check result
 */
export async function canDeleteComment(
  commentId: CommentId,
  actor: { principalId: PrincipalId; role: 'admin' | 'member' | 'user' }
): Promise<CommentPermissionCheckResult> {
  // Get the comment
  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, commentId),
  })

  if (!comment) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${commentId} not found`)
  }

  // Check if comment is already deleted
  if (comment.deletedAt) {
    return { allowed: false, reason: 'Comment has already been deleted' }
  }

  // Team members (admin, member) can always delete
  if (actor.role && ['admin', 'member'].includes(actor.role)) {
    return { allowed: true }
  }

  // Must be the author
  if (comment.principalId !== actor.principalId) {
    return { allowed: false, reason: 'You can only delete your own comments' }
  }

  // Check if any team member has replied to this comment
  const hasTeamReply = await hasTeamMemberReply(commentId)
  if (hasTeamReply) {
    return {
      allowed: false,
      reason: 'Cannot delete comments that have received team member replies',
    }
  }

  return { allowed: true }
}

/**
 * User edits their own comment
 * Validates permissions and updates content only (not timestamps)
 *
 * @param commentId - Comment ID to edit
 * @param content - New content
 * @param actor - Actor information with principalId and role
 * @returns Result containing updated comment or error
 */
export async function userEditComment(
  commentId: CommentId,
  content: string,
  actor: { principalId: PrincipalId; role: 'admin' | 'member' | 'user' }
): Promise<Comment> {
  // Check permission first
  const permResult = await canEditComment(commentId, actor)
  if (!permResult.allowed) {
    throw new ForbiddenError('EDIT_NOT_ALLOWED', permResult.reason || 'Edit not allowed')
  }

  // Get the existing comment
  const existingComment = await db.query.comments.findFirst({
    where: eq(comments.id, commentId),
  })
  if (!existingComment) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${commentId} not found`)
  }

  // Validate input
  if (!content?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Content is required')
  }
  if (content.length > 5000) {
    throw new ValidationError('VALIDATION_ERROR', 'Content must be 5,000 characters or less')
  }

  // Record edit history (always record for comments)
  if (actor.principalId) {
    await db.insert(commentEditHistory).values({
      commentId: commentId,
      editorPrincipalId: actor.principalId,
      previousContent: existingComment.content,
    })
  }

  // Update the comment (content only, not timestamps per PRD)
  const [updatedComment] = await db
    .update(comments)
    .set({
      content: content.trim(),
    })
    .where(eq(comments.id, commentId))
    .returning()

  if (!updatedComment) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${commentId} not found`)
  }

  return updatedComment
}

/**
 * Soft delete a comment
 * Sets deletedAt timestamp, shows placeholder text in threads
 *
 * @param commentId - Comment ID to delete
 * @param actor - Actor information with principalId and role
 * @returns Result indicating success or error
 */
export async function softDeleteComment(
  commentId: CommentId,
  actor: { principalId: PrincipalId; role: 'admin' | 'member' | 'user' }
): Promise<void> {
  // Check permission first
  const permResult = await canDeleteComment(commentId, actor)
  if (!permResult.allowed) {
    throw new ForbiddenError('DELETE_NOT_ALLOWED', permResult.reason || 'Delete not allowed')
  }

  // Get the comment to find its post (needed for auto-unpin check)
  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, commentId),
    with: { post: true },
  })

  if (!comment) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${commentId} not found`)
  }

  // Set deletedAt
  const [updatedComment] = await db
    .update(comments)
    .set({
      deletedAt: new Date(),
    })
    .where(eq(comments.id, commentId))
    .returning()

  if (!updatedComment) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${commentId} not found`)
  }

  // Auto-unpin if this comment was pinned as the official response
  if (comment.post?.pinnedCommentId === commentId) {
    await db.update(posts).set({ pinnedCommentId: null }).where(eq(posts.id, comment.postId))
  }
}

// ============================================================================
// Pin/Unpin Operations (Official Response)
// ============================================================================

/**
 * Check if a comment can be pinned as the official response
 *
 * A comment can be pinned if:
 * - It exists and is not deleted
 * - It's a root-level comment (no parent)
 * - It's from a team member (isTeamMember = true)
 *
 * @param commentId - Comment ID to check
 * @returns Whether the comment can be pinned
 */
export async function canPinComment(commentId: CommentId): Promise<{
  canPin: boolean
  reason?: string
}> {
  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, commentId),
  })

  if (!comment) {
    return { canPin: false, reason: 'Comment not found' }
  }

  if (comment.deletedAt) {
    return { canPin: false, reason: 'Cannot pin a deleted comment' }
  }

  if (comment.parentId) {
    return { canPin: false, reason: 'Only root-level comments can be pinned' }
  }

  if (!comment.isTeamMember) {
    return { canPin: false, reason: 'Only team member comments can be pinned' }
  }

  return { canPin: true }
}

/**
 * Pin a comment as the official response for a post
 *
 * Validates that:
 * - The comment can be pinned (team member, root-level, not deleted)
 * - The actor has permission (admin or member role)
 *
 * @param commentId - Comment ID to pin
 * @param actor - Actor information with principalId and role
 * @returns The updated post ID
 */
export async function pinComment(
  commentId: CommentId,
  actor: { principalId: PrincipalId; role: 'admin' | 'member' | 'user' }
): Promise<{ postId: PostId }> {
  // Only team members can pin comments
  if (!['admin', 'member'].includes(actor.role)) {
    throw new ForbiddenError('UNAUTHORIZED', 'Only team members can pin comments')
  }

  // Check if comment can be pinned
  const pinCheck = await canPinComment(commentId)
  if (!pinCheck.canPin) {
    throw new ValidationError('CANNOT_PIN', pinCheck.reason || 'Cannot pin this comment')
  }

  // Get the comment to find its post
  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, commentId),
    with: {
      post: {
        with: { board: true },
      },
    },
  })

  if (!comment || !comment.post) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${commentId} not found`)
  }

  // Update the post to set pinnedCommentId
  await db.update(posts).set({ pinnedCommentId: commentId }).where(eq(posts.id, comment.postId))

  return { postId: comment.postId }
}

/**
 * Unpin the currently pinned comment from a post
 *
 * @param postId - Post ID to unpin the comment from
 * @param actor - Actor information with principalId and role
 */
export async function unpinComment(
  postId: PostId,
  actor: { principalId: PrincipalId; role: 'admin' | 'member' | 'user' }
): Promise<void> {
  // Only team members can unpin comments
  if (!['admin', 'member'].includes(actor.role)) {
    throw new ForbiddenError('UNAUTHORIZED', 'Only team members can unpin comments')
  }

  // Verify post exists
  const post = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
    with: { board: true },
  })

  if (!post) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Clear the pinnedCommentId
  await db.update(posts).set({ pinnedCommentId: null }).where(eq(posts.id, postId))
}
