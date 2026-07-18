/**
 * Moderation domain service.
 *
 * Owns the guarded moderation transitions (pending → published for approve,
 * pending → soft-deleted for reject) plus the pending-queue reads, shared by
 * two callers:
 *   - the admin server functions (`functions/moderation.ts`), which delegate
 *     here with a session actor, and
 *   - the public REST routes (`routes/api/v1/moderation/*`), which delegate
 *     here with a machine (`type: 'service'`, `authMethod: 'api_key'`) actor.
 *
 * The guarded UPDATEs, the comment-count reconciliation transaction, and the
 * deferred announce side effects are too subtle to fork, so they live here
 * once. Callers own only authorization (their own permission gate) and the
 * audit actor they pass in.
 */
import {
  db,
  posts,
  postComments,
  boards,
  principal,
  eq,
  and,
  isNull,
  desc,
  sql,
  exists,
} from '@/lib/server/db'
import type { PostId, PostCommentId } from '@quackback/ids'
import { recordAuditEvent, type AuditActor } from '@/lib/server/audit/log'
import { NotFoundError, ConflictError } from '@/lib/shared/errors'
import { announcePublishedPost } from '@/lib/server/domains/posts/post.announce'
import { announcePublishedComment } from '@/lib/server/domains/comments/comment.announce'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'moderation' })

/** Audit context a caller threads through so both the session and the API-key
 *  path record a correctly-attributed row. `metadata` is merged into the audit
 *  event (the REST path stamps the acting API key id here). */
export interface ModerationAudit {
  actor: AuditActor
  headers?: Headers
  metadata?: Record<string, unknown>
}

/** A pending post row as surfaced to the moderation queue. */
export interface PendingPostRow {
  id: string
  title: string
  content: string
  createdAt: Date
  boardName: string
  authorName: string | null
}

/** A pending comment row as surfaced to the moderation queue. */
export interface PendingCommentRow {
  id: string
  content: string
  createdAt: Date
  postId: string
  postTitle: string
  boardName: string
  boardSlug: string
  authorName: string | null
}

/**
 * Correlated guard: the current `posts` row's board is not soft-deleted.
 * The queue LIST/COUNT queries already filter through `boards.deletedAt`;
 * folding this into the guarded approve/reject UPDATE closes the TOCTOU
 * window between queue display and the write (no ghost-publishing into a
 * board that was soft-deleted out from under the moderator).
 */
function boardAliveForPost() {
  return exists(
    db
      .select({ one: sql`1` })
      .from(boards)
      .where(and(eq(boards.id, posts.boardId), isNull(boards.deletedAt)))
  )
}

/**
 * Correlated guard: the current `comments` row's parent post AND that post's
 * board are both not soft-deleted. Matches the parent-deletedAt filter on the
 * comment LIST/COUNT queries so approve/reject can't write to a comment whose
 * parent was soft-deleted. Composes {@link boardAliveForPost} so the
 * board-alive invariant lives in exactly one place.
 */
function parentChainAliveForComment() {
  return exists(
    db
      .select({ one: sql`1` })
      .from(posts)
      .where(and(eq(posts.id, postComments.postId), isNull(posts.deletedAt), boardAliveForPost()))
  )
}

/** Team-only feed of posts in moderationState='pending', newest first. */
export async function listPendingPosts(): Promise<PendingPostRow[]> {
  return db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
      createdAt: posts.createdAt,
      boardName: boards.name,
      // Mirror post.inbox.ts: author relation is principal joined on posts.principalId
      authorName: principal.displayName,
    })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .leftJoin(principal, eq(posts.principalId, principal.id))
    .where(
      and(eq(posts.moderationState, 'pending'), isNull(posts.deletedAt), isNull(boards.deletedAt))
    )
    .orderBy(desc(posts.createdAt))
}

/** Team-only feed of comments in moderationState='pending', newest first. */
export async function listPendingComments(): Promise<PendingCommentRow[]> {
  return db
    .select({
      id: postComments.id,
      content: postComments.content,
      createdAt: postComments.createdAt,
      postId: postComments.postId,
      postTitle: posts.title,
      boardName: boards.name,
      boardSlug: boards.slug,
      authorName: principal.displayName,
    })
    .from(postComments)
    .innerJoin(posts, eq(postComments.postId, posts.id))
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .leftJoin(principal, eq(postComments.principalId, principal.id))
    .where(
      and(
        eq(postComments.moderationState, 'pending'),
        isNull(postComments.deletedAt),
        isNull(posts.deletedAt),
        isNull(boards.deletedAt)
      )
    )
    .orderBy(desc(postComments.createdAt))
}

/** Both pending queues in one call, for the REST pending endpoint. */
export async function listPending(): Promise<{
  posts: PendingPostRow[]
  comments: PendingCommentRow[]
}> {
  const [pendingPosts, pendingComments] = await Promise.all([
    listPendingPosts(),
    listPendingComments(),
  ])
  return { posts: pendingPosts, comments: pendingComments }
}

/** Guarded transition: a pending post → published. ConflictError if not pending. */
export async function approvePost(postId: PostId, audit: ModerationAudit): Promise<void> {
  const before = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
  if (!before) throw new NotFoundError('POST_NOT_FOUND', `Post ${postId}`)
  const updated = await db
    .update(posts)
    .set({ moderationState: 'published' })
    .where(
      and(
        eq(posts.id, postId),
        eq(posts.moderationState, 'pending'),
        isNull(posts.deletedAt),
        boardAliveForPost()
      )
    )
    .returning({ id: posts.id })
  if (updated.length === 0) {
    throw new ConflictError('POST_NOT_PENDING', 'Post is not awaiting review')
  }
  await recordAuditEvent({
    event: 'post.moderation.approved',
    actor: audit.actor,
    headers: audit.headers,
    target: { type: 'post', id: postId },
    before: { moderationState: before.moderationState },
    after: { moderationState: 'published' },
    metadata: audit.metadata,
  })
  // Dispatch deferred external notifications. The actor must be the post's
  // author — not the moderator — so announcePublishedPost loads author data
  // from the post row (which carries principalId, not the moderator's id).
  //
  // Swallow failures: the post is already published and audited; an error
  // here would surface a 500 to the moderator and the retry path is blocked
  // by the POST_NOT_PENDING guard above, permanently losing webhooks/mentions.
  try {
    await announcePublishedPost(postId)
  } catch (err) {
    log.error({ err }, 'announce published post failed')
  }
}

/** Guarded soft-delete of a pending post; restoring returns it to the queue. */
export async function rejectPost(
  postId: PostId,
  reason: string | undefined,
  audit: ModerationAudit
): Promise<void> {
  const before = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
  if (!before) throw new NotFoundError('POST_NOT_FOUND', `Post ${postId}`)
  const deletedAt = new Date()
  const updated = await db
    .update(posts)
    .set({ deletedAt })
    .where(
      and(
        eq(posts.id, postId),
        eq(posts.moderationState, 'pending'),
        isNull(posts.deletedAt),
        boardAliveForPost()
      )
    )
    .returning({ id: posts.id })
  if (updated.length === 0) {
    throw new ConflictError('POST_NOT_PENDING', 'Post is not awaiting review')
  }
  await recordAuditEvent({
    event: 'post.moderation.rejected',
    actor: audit.actor,
    headers: audit.headers,
    target: { type: 'post', id: postId },
    before: { moderationState: before.moderationState, deletedAt: null },
    after: { moderationState: before.moderationState, deletedAt },
    metadata: { reason: reason ?? null, ...(audit.metadata ?? {}) },
  })
}

/** Guarded transition: a pending comment → published, reconciling commentCount. */
export async function approveComment(
  commentId: PostCommentId,
  audit: ModerationAudit
): Promise<void> {
  const before = await db.query.postComments.findFirst({
    where: eq(postComments.id, commentId),
  })
  if (!before) throw new NotFoundError('COMMENT_NOT_FOUND', `Comment ${commentId}`)
  // Publish the comment and reconcile the public commentCount in ONE
  // transaction: the row lock taken by the guarded UPDATE is held across the
  // increment, so a concurrent softDeleteComment/deleteComment can't observe
  // the comment as published-but-not-yet-counted and decrement first (which,
  // with the GREATEST(0,…) clamp, would otherwise drift the count). The
  // insert path skips the increment for pending comments, so approval is what
  // flips it on; rejected comments stay uncounted.
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(postComments)
      .set({ moderationState: 'published' })
      .where(
        and(
          eq(postComments.id, commentId),
          eq(postComments.moderationState, 'pending'),
          isNull(postComments.deletedAt),
          parentChainAliveForComment()
        )
      )
      .returning({
        id: postComments.id,
        postId: postComments.postId,
        isPrivate: postComments.isPrivate,
      })
    if (!row) return null
    if (!row.isPrivate) {
      await tx
        .update(posts)
        .set({ commentCount: sql`${posts.commentCount} + 1` })
        .where(eq(posts.id, row.postId))
    }
    return row
  })
  if (!updated) {
    throw new ConflictError('COMMENT_NOT_PENDING', 'Comment is not awaiting review')
  }
  await recordAuditEvent({
    event: 'comment.moderation.approved',
    actor: audit.actor,
    headers: audit.headers,
    target: { type: 'comment', id: commentId },
    before: { moderationState: before.moderationState },
    after: { moderationState: 'published' },
    metadata: audit.metadata,
  })
  // Dispatch deferred external notifications. Mirrors approvePost: the
  // comment is already published and audited, so swallow failures rather
  // than surface a 500 to the moderator with no retry path.
  try {
    await announcePublishedComment(commentId)
  } catch (err) {
    log.error({ err }, 'announce published comment failed')
  }
}

/** Guarded soft-delete of a pending comment; restoring returns it to the queue. */
export async function rejectComment(
  commentId: PostCommentId,
  reason: string | undefined,
  audit: ModerationAudit
): Promise<void> {
  const before = await db.query.postComments.findFirst({
    where: eq(postComments.id, commentId),
  })
  if (!before) throw new NotFoundError('COMMENT_NOT_FOUND', `Comment ${commentId}`)
  const deletedAt = new Date()
  const updated = await db
    .update(postComments)
    .set({ deletedAt })
    .where(
      and(
        eq(postComments.id, commentId),
        eq(postComments.moderationState, 'pending'),
        isNull(postComments.deletedAt),
        parentChainAliveForComment()
      )
    )
    .returning({ id: postComments.id })
  if (updated.length === 0) {
    throw new ConflictError('COMMENT_NOT_PENDING', 'Comment is not awaiting review')
  }
  await recordAuditEvent({
    event: 'comment.moderation.rejected',
    actor: audit.actor,
    headers: audit.headers,
    target: { type: 'comment', id: commentId },
    before: { moderationState: before.moderationState, deletedAt: null },
    after: { moderationState: before.moderationState, deletedAt },
    metadata: { reason: reason ?? null, ...(audit.metadata ?? {}) },
  })
}
