/**
 * Shared recursive helpers for optimistic comment tree updates.
 */
import type { CommentId } from '@quackback/ids'

/** Minimal comment shape that both admin and portal comment types satisfy */
interface CommentNode {
  id: string
  parentId?: string | null
  content: string
  replies: CommentNode[]
}

/**
 * Recursively add a reply under the correct parent in a comment tree.
 */
export function addReplyToTree<T extends CommentNode>(
  comments: T[],
  parentId: string,
  reply: T
): T[] {
  return comments.map((comment) => {
    if (comment.id === parentId) {
      return { ...comment, replies: [...comment.replies, reply] }
    }
    if (comment.replies.length > 0) {
      return { ...comment, replies: addReplyToTree(comment.replies, parentId, reply) }
    }
    return comment
  })
}

/**
 * Recursively replace a temporary optimistic comment with real server data.
 */
export function replaceOptimisticInTree<T extends CommentNode>(
  comments: T[],
  optimisticPrefix: string,
  parentId: string | null,
  content: string,
  serverData: { id: CommentId; createdAt: Date | string }
): T[] {
  return comments.map((comment) => {
    if (comment.id.startsWith(optimisticPrefix)) {
      const sameParent = (comment.parentId || null) === (parentId || null)
      const sameContent = comment.content === content
      if (sameParent && sameContent) {
        const createdAt =
          typeof serverData.createdAt === 'string'
            ? serverData.createdAt
            : serverData.createdAt.toISOString()
        return { ...comment, id: serverData.id, createdAt }
      }
    }
    if (comment.replies.length > 0) {
      return {
        ...comment,
        replies: replaceOptimisticInTree(
          comment.replies,
          optimisticPrefix,
          parentId,
          content,
          serverData
        ),
      }
    }
    return comment
  })
}
