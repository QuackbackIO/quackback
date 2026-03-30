/**
 * Comment Pin/Unpin and Restore Operations
 *
 * Handles pinning, unpinning, and restoring comments.
 * Only accessible to team members.
 */

import { db, eq, and, sql, comments, posts } from '@/lib/server/db'
import { type CommentId, type PostId, type PrincipalId } from '@quackback/ids'
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/shared/errors'
import { isTeamMember } from '@/lib/shared/roles'
import { createActivity } from '@/lib/server/domains/activity/activity.service'

/**
 * Restore a soft-deleted comment
 * Only team members can restore comments.
 *
 * @param commentId - Comment ID to restore
 * @param actor - Actor information with principalId and role
 */
export async function restoreComment(
  commentId: CommentId,
  actor: { principalId: PrincipalId; role: 'admin' | 'member' | 'user' }
): Promise<void> {
  console.log(`[domain:comments] restoreComment: commentId=${commentId}`)

  if (!isTeamMember(actor.role)) {
    throw new ForbiddenError('UNAUTHORIZED', 'Only team members can restore comments')
  }

  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, commentId),
    with: { post: true },
  })

  if (!comment) {
    throw new NotFoundError('COMMENT_NOT_FOUND', `Comment with ID ${commentId} not found`)
  }

  if (!comment.deletedAt) {
    throw new ValidationError('NOT_DELETED', 'Comment is not deleted')
  }

  // Atomic transaction: restore comment + re-increment comment count
  const wasRestored = await db.transaction(async (tx) => {
    const [updatedComment] = await tx
      .update(comments)
      .set({
        deletedAt: null,
        deletedByPrincipalId: null,
      })
      .where(and(eq(comments.id, commentId), sql`${comments.deletedAt} IS NOT NULL`))
      .returning()

    if (!updatedComment) return false

    // Re-increment comment count (only for public comments)
    if (!comment.isPrivate) {
      await tx
        .update(posts)
        .set({ commentCount: sql`${posts.commentCount} + 1` })
        .where(eq(posts.id, comment.postId))
    }

    return true
  })

  if (!wasRestored) return

  createActivity({
    postId: comment.postId,
    principalId: actor.principalId,
    type: 'comment.restored',
    metadata: {
      commentId,
      commentAuthorPrincipalId: comment.principalId,
    },
  })
}

// ============================================================================
// Pin/Unpin Operations
// ============================================================================

/**
 * Check if a comment can be pinned
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
  console.log(`[domain:comments] canPinComment: commentId=${commentId}`)
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

  if (comment.isPrivate) {
    return { canPin: false, reason: 'Private comments cannot be pinned' }
  }

  return { canPin: true }
}

/**
 * Pin a comment on a post
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
  console.log(`[domain:comments] pinComment: commentId=${commentId}`)
  // Only team members can pin comments
  if (!isTeamMember(actor.role)) {
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
  console.log(`[domain:comments] unpinComment: postId=${postId}`)
  // Only team members can unpin comments
  if (!isTeamMember(actor.role)) {
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
