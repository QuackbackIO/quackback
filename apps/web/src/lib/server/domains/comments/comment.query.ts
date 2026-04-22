import { db, eq, asc, comments, posts, boards, type Comment } from '@/lib/server/db'
import { type CommentId, type PostId, type PrincipalId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import type { CommentThread } from './comment.types'
import { buildCommentTree, toStatusChange } from '@/lib/shared'

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

  // Fetch all comments with reactions, author info, and status change data
  const commentsWithReactions = await db.query.comments.findMany({
    where: eq(comments.postId, postId),
    with: {
      reactions: true,
      author: {
        columns: { displayName: true },
      },
      statusChangeFrom: {
        columns: { name: true, color: true },
      },
      statusChangeTo: {
        columns: { name: true, color: true },
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
    isPrivate: comment.isPrivate,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt ?? null,
    deletedAt: comment.deletedAt ?? null,
    deletedByPrincipalId: comment.deletedByPrincipalId ?? null,
    statusChange: toStatusChange(comment.statusChangeFrom, comment.statusChangeTo),
    reactions: comment.reactions.map((r) => ({
      emoji: r.emoji,
      principalId: r.principalId,
    })),
  }))

  // Build comment tree with reaction aggregation
  return buildCommentTree(formattedComments, principalId) as CommentThread[]
}
