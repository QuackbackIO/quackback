/**
 * announcePublishedPost — deferred external dispatch for moderated posts.
 *
 * Fired when a post becomes publicly visible:
 *  - At create time, when the post is NOT held for moderation.
 *  - At approve time (approvePostFn), after a pending post is released.
 *
 * Sends the post.created webhook event and @-mention notifications.
 * The actor is always the post's original author, not the moderator.
 */

import { db, boards, posts, principal as principalTable, eq, type Post } from '@/lib/server/db'
import { realEmail } from '@/lib/shared/anonymous-email'
import { type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { dispatchPostCreated, buildEventActor } from '@/lib/server/events/dispatch'
import { extractMentions, extractMentionExcerpts } from './extract-mentions'
import { syncPostMentions } from './sync-post-mentions'
import { buildPostUrl } from '@/lib/server/integrations/message-utils'
import { getBaseUrl } from '@/lib/server/config'

type PostSnapshot = Pick<Post, 'id' | 'title' | 'content' | 'boardId' | 'contentJson' | 'voteCount'>
type AuthorSnapshot = {
  principalId: PrincipalId
  userId?: UserId
  name?: string
  email?: string
  displayName?: string
}

/**
 * Dispatch the post.created event and @-mention notifications for a post that
 * has just become visible. Called by createPost (published path) and
 * approvePostFn (after a pending post is approved).
 *
 * Pass `assembled` when the data is already in memory (create path). On the
 * approve path, pass only `postId` — the function loads the post, board, and
 * author from the database so the approve call site stays simple.
 */
export async function announcePublishedPost(
  postId: PostId,
  assembled?: {
    post: PostSnapshot
    board: { slug: string; name: string }
    author: AuthorSnapshot
  }
): Promise<void> {
  let post: PostSnapshot
  let board: { slug: string; name: string }
  let author: AuthorSnapshot

  if (assembled) {
    post = assembled.post
    board = assembled.board
    author = assembled.author
  } else {
    const postRow = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
    if (!postRow) return
    const boardRow = await db.query.boards.findFirst({ where: eq(boards.id, postRow.boardId) })
    if (!boardRow) return
    const authorRow = await db.query.principal.findFirst({
      where: eq(principalTable.id, postRow.principalId),
      with: { user: { columns: { id: true, name: true, email: true } } },
    })
    post = {
      id: postRow.id,
      title: postRow.title,
      content: postRow.content,
      boardId: postRow.boardId,
      contentJson: postRow.contentJson,
      voteCount: postRow.voteCount,
    }
    board = { slug: boardRow.slug, name: boardRow.name }
    author = {
      principalId: postRow.principalId,
      userId: authorRow?.user?.id,
      name: authorRow?.user?.name ?? undefined,
      email: authorRow?.user?.email ?? undefined,
      displayName: authorRow?.displayName ?? undefined,
    }
  }

  const actorName = author.displayName ?? author.name
  await dispatchPostCreated(buildEventActor(author), {
    id: post.id,
    title: post.title,
    content: post.content,
    boardId: post.boardId,
    boardSlug: board.slug,
    authorEmail: realEmail(author.email) ?? undefined,
    authorName: actorName,
    voteCount: post.voteCount,
  })

  if (post.contentJson) {
    const mentionedIds = extractMentions(post.contentJson)
    if (mentionedIds.size > 0) {
      await syncPostMentions({
        postId: post.id,
        postTitle: post.title,
        postUrl: buildPostUrl(getBaseUrl(), board.slug, post.id),
        mentionedIds,
        excerptByPrincipalId: extractMentionExcerpts(post.contentJson),
        actor: buildEventActor(author),
      })
    }
  }
}
