/**
 * announcePublishedComment — deferred external dispatch for moderated comments.
 *
 * Fired when a comment becomes publicly visible:
 *  - At create time (in comment.service.ts) when the comment is NOT held.
 *  - At approve time (approveCommentFn), after a pending comment is released.
 *
 * Sends the comment.created webhook event. The actor is always the comment's
 * original author, not the moderator. Mirrors announcePublishedPost.
 */

import { db, boards, postComments, posts, principal as principalTable, eq } from '@/lib/server/db'
import { realEmail } from '@/lib/shared/anonymous-email'
import {
  type PostCommentId,
  type PostId,
  type BoardId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'
import { dispatchCommentCreated, buildEventActor } from '@/lib/server/events/dispatch'

/** Author of a published comment, as the `comment.created` event sees it. */
export interface PublishedCommentAuthor {
  principalId: PrincipalId
  userId?: UserId
  name?: string
  email?: string
  displayName?: string
}

/**
 * Map a resolved (author, comment, post) triple onto the `comment.created`
 * event and dispatch it. Single source of truth for the event payload shape
 * shared by the create path (comment.service.ts, comment NOT held) and the
 * approve path ({@link announcePublishedComment}) so the two can't drift —
 * notably the `displayName ?? name` author-name precedence.
 */
export async function dispatchCommentCreatedEvent(
  author: PublishedCommentAuthor,
  comment: { id: PostCommentId; content: string; isPrivate: boolean },
  post: { id: PostId; title: string; boardId: BoardId; boardSlug: string }
): Promise<void> {
  await dispatchCommentCreated(
    buildEventActor(author),
    {
      id: comment.id,
      content: comment.content,
      authorName: author.displayName ?? author.name,
      authorEmail: realEmail(author.email) ?? undefined,
      isPrivate: comment.isPrivate,
    },
    {
      id: post.id,
      title: post.title,
      boardId: post.boardId,
      boardSlug: post.boardSlug,
    }
  )
}

/**
 * Dispatch the comment.created event for a comment that has just become
 * visible after moderator approval. Loads the comment, parent post, board,
 * and author from the database so the approve call site stays simple.
 */
export async function announcePublishedComment(commentId: PostCommentId): Promise<void> {
  const commentRow = await db.query.postComments.findFirst({
    where: eq(postComments.id, commentId),
  })
  if (!commentRow) return
  const postRow = await db.query.posts.findFirst({ where: eq(posts.id, commentRow.postId) })
  if (!postRow) return
  const boardRow = await db.query.boards.findFirst({ where: eq(boards.id, postRow.boardId) })
  if (!boardRow) return
  const authorRow = await db.query.principal.findFirst({
    where: eq(principalTable.id, commentRow.principalId),
    with: { user: { columns: { id: true, name: true, email: true } } },
  })

  await dispatchCommentCreatedEvent(
    {
      principalId: commentRow.principalId,
      userId: authorRow?.user?.id,
      name: authorRow?.user?.name ?? undefined,
      email: authorRow?.user?.email ?? undefined,
      displayName: authorRow?.displayName ?? undefined,
    },
    {
      id: commentRow.id,
      content: commentRow.content,
      isPrivate: commentRow.isPrivate ?? false,
    },
    {
      id: postRow.id,
      title: postRow.title,
      boardId: boardRow.id,
      boardSlug: boardRow.slug,
    }
  )
}
