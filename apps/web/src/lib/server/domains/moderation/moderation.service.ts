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
  auditLog,
  eq,
  and,
  isNull,
  desc,
  sql,
  exists,
} from '@/lib/server/db'
import type { PostId, PostCommentId, PrincipalId } from '@quackback/ids'
import { recordAuditEvent, type AuditActor } from '@/lib/server/audit/log'
import { emitBestEffort } from '@/lib/server/events/emit'
import {
  postApproved,
  postRejected,
  commentApproved,
  commentRejected,
} from '@/lib/server/events/catalogue'
import type { EventDefinition } from '@/lib/server/events/catalogue/define'
import type { ModerationDecisionPayload } from '@/lib/server/events/types'
import { NotFoundError, ConflictError } from '@/lib/shared/errors'
import { announcePublishedPost } from '@/lib/server/domains/posts/post.announce'
import { announcePublishedComment } from '@/lib/server/domains/comments/comment.announce'
import { logger } from '@/lib/server/logger'
import { adjustCanonicalCommentCount } from '@/lib/server/domains/posts/post.merge-ids'
import { notTestPrincipal } from '@/lib/server/test-data'

const log = logger.child({ component: 'moderation' })

async function latestHoldWasPreviouslyPublished(
  eventType: 'post.moderation.held' | 'comment.moderation.held',
  targetId: string
): Promise<boolean> {
  try {
    const [row] = await db
      .select({ metadata: auditLog.metadata })
      .from(auditLog)
      .where(and(eq(auditLog.eventType, eventType), eq(auditLog.targetId, targetId)))
      .orderBy(desc(auditLog.occurredAt))
      .limit(1)
    const metadata = row?.metadata as { previouslyPublished?: boolean } | null
    return metadata?.previouslyPublished === true
  } catch (err) {
    log.error({ err, eventType, targetId }, 'lookup hold audit failed')
    return false
  }
}

/** Audit context a caller threads through so both the session and the API-key
 *  path record a correctly-attributed row. `metadata` is merged into the audit
 *  event (the REST path stamps the acting API key id here). */
export interface ModerationAudit {
  actor: AuditActor
  headers?: Headers
  metadata?: Record<string, unknown>
  /** The moderator's principal (a teammate, or the API key's own principal).
   *  Carried on the decision event so the author notice skips a teammate who
   *  moderates their own item. */
  principalId?: PrincipalId
}

/**
 * Record the team's decision so its author hears about it (email + bell,
 * resolved by the notification sink). Runs after the decision is written and
 * audited, and never throws: like the announce step, a failure here must not
 * turn a done decision into a 500 the guard then refuses to retry.
 */
async function emitModerationDecision(
  def: EventDefinition<Record<string, unknown>>,
  item: { postId: PostId; commentId?: PostCommentId; authorPrincipalId: PrincipalId | null },
  audit: ModerationAudit
): Promise<void> {
  try {
    const [post] = await db
      .select({ title: posts.title, boardId: posts.boardId, boardSlug: boards.slug })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .where(eq(posts.id, item.postId))
      .limit(1)
    if (!post) return
    const payload: ModerationDecisionPayload = {
      postId: item.postId,
      postTitle: post.title,
      boardId: post.boardId,
      boardSlug: post.boardSlug,
      authorPrincipalId: item.authorPrincipalId,
      ...(item.commentId ? { commentId: item.commentId } : {}),
    }
    await emitBestEffort(def, {
      payload: payload as unknown as Record<string, unknown>,
      actor: {
        type: audit.actor.type === 'service' ? 'service' : 'user',
        id: audit.principalId,
      },
      entityId: item.commentId ?? item.postId,
      context: { source: audit.actor.authMethod === 'api_key' ? 'api' : 'admin' },
    })
  } catch (err) {
    log.error({ err, event_type: def.type }, 'record moderation decision failed')
  }
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
  contentJson: import('@/lib/shared/db-types').TiptapContent | null
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
      and(
        eq(posts.moderationState, 'pending'),
        isNull(posts.deletedAt),
        isNull(boards.deletedAt),
        // A test customer's post stays out of the queue, as it does of the counts.
        notTestPrincipal(posts.principalId)
      )
    )
    .orderBy(desc(posts.createdAt))
}

/** Team-only feed of comments in moderationState='pending', newest first. */
export async function listPendingComments(): Promise<PendingCommentRow[]> {
  return db
    .select({
      id: postComments.id,
      content: postComments.content,
      contentJson: postComments.contentJson,
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
        isNull(boards.deletedAt),
        // Same exclusions as the counts: a test customer's comment, or any
        // comment on a test customer's post.
        notTestPrincipal(postComments.principalId),
        notTestPrincipal(posts.principalId)
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
  await emitModerationDecision(
    postApproved,
    { postId, authorPrincipalId: before.principalId as PrincipalId | null },
    audit
  )
  // Dispatch deferred external notifications. The actor must be the post's
  // author — not the moderator — so announcePublishedPost loads author data
  // from the post row (which carries principalId, not the moderator's id).
  //
  // Swallow failures: the post is already published and audited; an error
  // here would surface a 500 to the moderator and the retry path is blocked
  // by the POST_NOT_PENDING guard above, permanently losing webhooks/mentions.
  try {
    const skipCreatedWebhook = await latestHoldWasPreviouslyPublished(
      'post.moderation.held',
      postId
    )
    if (skipCreatedWebhook) {
      await announcePublishedPost(postId, undefined, { skipCreatedWebhook: true })
    } else {
      await announcePublishedPost(postId)
    }
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
  // The reason stays in the audit log; the author is told the decision only.
  await emitModerationDecision(
    postRejected,
    { postId, authorPrincipalId: before.principalId as PrincipalId | null },
    audit
  )
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
        principalId: postComments.principalId,
        isPrivate: postComments.isPrivate,
      })
    if (!row) return null
    if (!row.isPrivate) {
      const counted = await tx
        .update(posts)
        .set({ commentCount: sql`${posts.commentCount} + 1` })
        .where(
          and(
            eq(posts.id, row.postId),
            and(
              notTestPrincipal(posts.principalId),
              notTestPrincipal(
                sql`(SELECT ${principal.id} FROM ${principal} WHERE ${eq(principal.id, row.principalId)})`
              )
            )!
          )
        )
        .returning({ id: posts.id })
      if (counted.length > 0) await adjustCanonicalCommentCount(row.postId, 1, tx)
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
  await emitModerationDecision(
    commentApproved,
    {
      postId: before.postId as PostId,
      commentId,
      authorPrincipalId: before.principalId as PrincipalId | null,
    },
    audit
  )
  // Dispatch deferred external notifications. Mirrors approvePost: the
  // comment is already published and audited, so swallow failures rather
  // than surface a 500 to the moderator with no retry path.
  try {
    const skipCreatedWebhook = await latestHoldWasPreviouslyPublished(
      'comment.moderation.held',
      commentId
    )
    if (!skipCreatedWebhook) await announcePublishedComment(commentId)
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
  await emitModerationDecision(
    commentRejected,
    {
      postId: before.postId as PostId,
      commentId,
      authorPrincipalId: before.principalId as PrincipalId | null,
    },
    audit
  )
}
