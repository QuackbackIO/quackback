/**
 * Post Status Service
 *
 * Handles status change operations for posts.
 */

import { db, posts, boards, postStatuses, eq } from '@/lib/db'
import { type PostId, type StatusId, type UserId } from '@quackback/ids'
import { dispatchPostStatusChanged } from '@/lib/server/events/dispatch'
import { NotFoundError } from '@/lib/shared/errors'
import type { ChangeStatusResult } from './post.types'

/**
 * Change the status of a post
 *
 * Validates that:
 * - Post exists and belongs to the organization
 * - New status is valid
 *
 * Dispatches a post.status_changed event for webhooks, Slack, etc.
 *
 * Note: Authorization is handled at the action layer before calling this function.
 *
 * @param postId - Post ID to update
 * @param statusId - New status ID
 * @param actor - Who is making the change (userId, email)
 * @returns Result containing the updated post or an error
 */
export async function changeStatus(
  postId: PostId,
  statusId: StatusId,
  actor: { userId: UserId; email: string }
): Promise<ChangeStatusResult> {
  // Get existing post
  const existingPost = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
  if (!existingPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Verify post belongs to this organization and get status info in parallel
  const [board, newStatus, prevStatus] = await Promise.all([
    db.query.boards.findFirst({ where: eq(boards.id, existingPost.boardId) }),
    db.query.postStatuses.findFirst({ where: eq(postStatuses.id, statusId) }),
    existingPost.statusId
      ? db.query.postStatuses.findFirst({ where: eq(postStatuses.id, existingPost.statusId) })
      : Promise.resolve(null),
  ])

  if (!board) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${existingPost.boardId} not found`)
  }

  if (!newStatus) {
    throw new NotFoundError('STATUS_NOT_FOUND', `Status with ID ${statusId} not found`)
  }

  const previousStatusName = prevStatus?.name ?? 'Open'

  // Update the post status
  const [updatedPost] = await db
    .update(posts)
    .set({ statusId })
    .where(eq(posts.id, postId))
    .returning()
  if (!updatedPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  // Dispatch post.status_changed event for webhooks, Slack, etc.
  await dispatchPostStatusChanged(
    { type: 'user', userId: actor.userId, email: actor.email },
    {
      id: updatedPost.id,
      title: updatedPost.title,
      boardId: board.id,
      boardSlug: board.slug,
    },
    previousStatusName,
    newStatus.name
  )

  return {
    ...updatedPost,
    boardSlug: board.slug,
    previousStatus: previousStatusName,
    newStatus: newStatus.name,
  }
}
