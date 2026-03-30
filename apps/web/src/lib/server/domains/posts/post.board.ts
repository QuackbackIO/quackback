/**
 * Post Board Service
 *
 * Handles moving a post from one board to another.
 */

import { db, posts, boards, eq } from '@/lib/server/db'
import { type PostId, type BoardId, type UserId, type PrincipalId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import { createActivity } from '@/lib/server/domains/activity/activity.service'
import type { ChangeBoardResult } from './post.types'

/**
 * Move a post to a different board.
 *
 * Note: Authorization is handled at the action layer before calling this function.
 */
export async function changeBoard(
  postId: PostId,
  newBoardId: BoardId,
  actor: {
    principalId: PrincipalId
    userId?: UserId
    email?: string
    displayName?: string
  }
): Promise<ChangeBoardResult> {
  const existingPost = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
  if (!existingPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  if (existingPost.boardId === newBoardId) {
    return existingPost
  }

  const [currentBoard, newBoard] = await Promise.all([
    db.query.boards.findFirst({ where: eq(boards.id, existingPost.boardId) }),
    db.query.boards.findFirst({ where: eq(boards.id, newBoardId) }),
  ])

  if (!currentBoard) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${existingPost.boardId} not found`)
  }
  if (!newBoard) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${newBoardId} not found`)
  }

  const [updatedPost] = await db
    .update(posts)
    .set({ boardId: newBoardId })
    .where(eq(posts.id, postId))
    .returning()

  if (!updatedPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  createActivity({
    postId,
    principalId: actor.principalId,
    type: 'post.board_changed',
    metadata: {
      fromBoardId: currentBoard.id,
      fromBoardName: currentBoard.name,
      toBoardId: newBoard.id,
      toBoardName: newBoard.name,
    },
  })

  return updatedPost
}
