/**
 * Comment Permission Operations
 *
 * Handles permission checks and user-facing edit/delete operations for comments.
 */

import {
  db,
  eq,
  and,
  isNull,
  sql,
  comments,
  commentEditHistory,
  posts,
  type Comment,
} from '@/lib/server/db'
import { type CommentId, type PrincipalId } from '@quackback/ids'
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/shared/errors'
import { isTeamMember } from '@/lib/shared/roles'
import { createActivity } from '@/lib/server/domains/activity/activity.service'
import { dispatchCommentUpdated, buildEventActor } from '@/lib/server/events/dispatch'
import type { CommentPermissionCheckResult } from './comment.types'

// ============================================================================
// Helper Functions (Internal)
// ============================================================================

/**
 * Check if a comment has any reply from a team member
 * Recursively checks all descendants
 */
export async function hasTeamMemberReply(commentId: CommentId): Promise<boolean> {
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
// Permission Checks
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
  console.log(`[domain:comments] canEditComment: commentId=${commentId}`)
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
  if (isTeamMember(actor.role)) {
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
  console.log(`[domain:comments] canDeleteComment: commentId=${commentId}`)
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
  if (isTeamMember(actor.role)) {
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

// ============================================================================
// User Edit/Delete Operations
// ============================================================================

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
  console.log(`[domain:comments] userEditComment: commentId=${commentId}`)
  // Check permission first
  const permResult = await canEditComment(commentId, actor)
  if (!permResult.allowed) {
    throw new ForbiddenError('EDIT_NOT_ALLOWED', permResult.reason || 'Edit not allowed')
  }

  const existingComment = await db.query.comments.findFirst({
    where: eq(comments.id, commentId),
    with: { post: { with: { board: true } } },
  })
  if (!existingComment) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${commentId} not found`)
  }
  if (!existingComment.post || !existingComment.post.board) {
    throw new NotFoundError('POST_NOT_FOUND', `Post for comment ${commentId} not found`)
  }

  // Validate input
  if (!content?.trim()) {
    throw new ValidationError('VALIDATION_ERROR', 'Content is required')
  }
  if (content.length > 5000) {
    throw new ValidationError('VALIDATION_ERROR', 'Content must be 5,000 characters or less')
  }

  const updatedComment = await db.transaction(async (tx) => {
    if (actor.principalId) {
      await tx.insert(commentEditHistory).values({
        commentId,
        editorPrincipalId: actor.principalId,
        previousContent: existingComment.content,
      })
    }

    const [result] = await tx
      .update(comments)
      .set({ content: content.trim(), updatedAt: new Date() })
      .where(eq(comments.id, commentId))
      .returning()

    if (!result) {
      throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${commentId} not found`)
    }

    return result
  })

  dispatchCommentUpdated(
    buildEventActor({ principalId: actor.principalId }),
    {
      id: updatedComment.id,
      content: updatedComment.content,
      isPrivate: updatedComment.isPrivate ?? undefined,
    },
    {
      id: existingComment.post.id,
      title: existingComment.post.title,
      boardId: existingComment.post.board.id,
      boardSlug: existingComment.post.board.slug,
    }
  )

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
  console.log(`[domain:comments] softDeleteComment: commentId=${commentId}`)
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

  // Atomic transaction: soft-delete comment + decrement comment count + auto-unpin
  // Guard: only update comments that aren't already soft-deleted (idempotent)
  const wasDeleted = await db.transaction(async (tx) => {
    const [updatedComment] = await tx
      .update(comments)
      .set({
        deletedAt: new Date(),
        deletedByPrincipalId: actor.principalId,
      })
      .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
      .returning()

    if (!updatedComment) {
      // Already soft-deleted or gone — no-op
      return false
    }

    // Decrement comment count (only for public comments) and auto-unpin if this comment was pinned
    // Private comments never incremented the count, so skip decrement for them
    const shouldDecrementCount = !comment.isPrivate
    const shouldUnpin = comment.post?.pinnedCommentId === commentId

    if (shouldDecrementCount || shouldUnpin) {
      await tx
        .update(posts)
        .set({
          ...(shouldDecrementCount
            ? { commentCount: sql`GREATEST(0, ${posts.commentCount} - 1)` }
            : {}),
          ...(shouldUnpin ? { pinnedCommentId: null } : {}),
        })
        .where(eq(posts.id, comment.postId))
    }

    return true
  })

  if (!wasDeleted) return

  // Record activity (fire-and-forget)
  const isSelfDelete = actor.principalId === comment.principalId
  createActivity({
    postId: comment.postId,
    principalId: actor.principalId,
    type: isSelfDelete ? 'comment.deleted' : 'comment.removed',
    metadata: {
      commentId,
      commentAuthorPrincipalId: comment.principalId,
    },
  })
}
