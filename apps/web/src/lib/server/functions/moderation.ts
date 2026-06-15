/**
 * Moderation server functions.
 *
 * - listPendingPostsFn   — team-only feed of posts in moderationState='pending'
 * - approvePostFn        — guarded transition: pending → published (ConflictError if not pending)
 * - rejectPostFn         — guarded soft-delete: sets deletedAt on a pending post with optional
 *                          reason in the audit trail; restoring returns it to the queue.
 *
 * Approve and reject are team-level operations (admin OR member): mirrors
 * industry feedback tools where moderators are a separate concept from workspace
 * admins. Changing the workspace moderation *policy* is admin-only and lives
 * on the Settings → Feedback → Moderation page.
 */
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'moderation' })
import {
  db,
  posts,
  comments,
  boards,
  principal,
  eq,
  and,
  or,
  isNull,
  desc,
  sql,
  exists,
} from '@/lib/server/db'
import { requireAuth } from '@/lib/server/functions/auth-helpers'
import { recordAuditEvent, actorFromAuth } from '@/lib/server/audit/log'
import { isTeamMember } from '@/lib/shared/roles'
import { ForbiddenError, NotFoundError, ConflictError } from '@/lib/shared/errors'
import { getPortalConfig } from '@/lib/server/domains/settings/settings.service'
import { announcePublishedPost } from '@/lib/server/domains/posts/post.announce'
import { announcePublishedComment } from '@/lib/server/domains/comments/comment.announce'

const ApproveInput = z.object({ postId: z.string() })
const RejectInput = z.object({ postId: z.string(), reason: z.string().max(500).optional() })
const ApproveCommentInput = z.object({ commentId: z.string() })
const RejectCommentInput = z.object({
  commentId: z.string(),
  reason: z.string().max(500).optional(),
})

/**
 * Team-only gate shared by every moderation handler. Approve/reject are
 * team-level (admin OR member); changing the moderation *policy* is admin-only
 * and lives on the Settings page.
 */
async function requireTeamAuth() {
  const auth = await requireAuth()
  if (!isTeamMember(auth.principal.role)) {
    throw new ForbiddenError('FORBIDDEN', 'Team only')
  }
  return auth
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
      .where(and(eq(posts.id, comments.postId), isNull(posts.deletedAt), boardAliveForPost()))
  )
}

export const listPendingPostsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireTeamAuth()
  const rows = await db
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
  return { posts: rows }
})

export const listPendingCommentsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireTeamAuth()
  const rows = await db
    .select({
      id: comments.id,
      content: comments.content,
      createdAt: comments.createdAt,
      postId: comments.postId,
      postTitle: posts.title,
      boardName: boards.name,
      boardSlug: boards.slug,
      authorName: principal.displayName,
    })
    .from(comments)
    .innerJoin(posts, eq(comments.postId, posts.id))
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .leftJoin(principal, eq(comments.principalId, principal.id))
    .where(
      and(
        eq(comments.moderationState, 'pending'),
        isNull(comments.deletedAt),
        isNull(posts.deletedAt),
        isNull(boards.deletedAt)
      )
    )
    .orderBy(desc(comments.createdAt))
  return { comments: rows }
})

export const approvePostFn = createServerFn({ method: 'POST' })
  .inputValidator(ApproveInput.parse)
  .handler(async ({ data }) => {
    const auth = await requireTeamAuth()
    const before = await db.query.posts.findFirst({ where: eq(posts.id, data.postId as never) })
    if (!before) throw new NotFoundError('POST_NOT_FOUND', `Post ${data.postId}`)
    const updated = await db
      .update(posts)
      .set({ moderationState: 'published' })
      .where(
        and(
          eq(posts.id, data.postId as never),
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
      actor: actorFromAuth(auth),
      headers: getRequestHeaders(),
      target: { type: 'post', id: data.postId },
      before: { moderationState: before.moderationState },
      after: { moderationState: 'published' },
    })
    // Dispatch deferred external notifications. The actor must be the post's
    // author — not the moderator — so announcePublishedPost loads author data
    // from the post row (which carries principalId, not the moderator's id).
    //
    // Swallow failures: the post is already published and audited; an error
    // here would surface a 500 to the moderator and the retry path is blocked
    // by the POST_NOT_PENDING guard above, permanently losing webhooks/mentions.
    try {
      await announcePublishedPost(data.postId as never)
    } catch (err) {
      log.error({ err }, 'announce published post failed')
    }
    return { ok: true }
  })

export const approveCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(ApproveCommentInput.parse)
  .handler(async ({ data }) => {
    const auth = await requireTeamAuth()
    const before = await db.query.comments.findFirst({
      where: eq(comments.id, data.commentId as never),
    })
    if (!before) throw new NotFoundError('COMMENT_NOT_FOUND', `Comment ${data.commentId}`)
    // Publish the comment and reconcile the public commentCount in ONE
    // transaction: the row lock taken by the guarded UPDATE is held across the
    // increment, so a concurrent softDeleteComment/deleteComment can't observe
    // the comment as published-but-not-yet-counted and decrement first (which,
    // with the GREATEST(0,…) clamp, would otherwise drift the count). The
    // insert path skips the increment for pending comments, so approval is what
    // flips it on; rejected comments stay uncounted.
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(comments)
        .set({ moderationState: 'published' })
        .where(
          and(
            eq(comments.id, data.commentId as never),
            eq(comments.moderationState, 'pending'),
            isNull(comments.deletedAt),
            parentChainAliveForComment()
          )
        )
        .returning({ id: comments.id, postId: comments.postId, isPrivate: comments.isPrivate })
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
      actor: actorFromAuth(auth),
      headers: getRequestHeaders(),
      target: { type: 'comment', id: data.commentId },
      before: { moderationState: before.moderationState },
      after: { moderationState: 'published' },
    })
    // Dispatch deferred external notifications. Mirrors approvePostFn: the
    // comment is already published and audited, so swallow failures rather
    // than surface a 500 to the moderator with no retry path.
    try {
      await announcePublishedComment(data.commentId as never)
    } catch (err) {
      log.error({ err }, 'announce published comment failed')
    }
    return { ok: true }
  })

export const rejectCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(RejectCommentInput.parse)
  .handler(async ({ data }) => {
    const auth = await requireTeamAuth()
    const before = await db.query.comments.findFirst({
      where: eq(comments.id, data.commentId as never),
    })
    if (!before) throw new NotFoundError('COMMENT_NOT_FOUND', `Comment ${data.commentId}`)
    const deletedAt = new Date()
    const updated = await db
      .update(comments)
      .set({ deletedAt })
      .where(
        and(
          eq(comments.id, data.commentId as never),
          eq(comments.moderationState, 'pending'),
          isNull(comments.deletedAt),
          parentChainAliveForComment()
        )
      )
      .returning({ id: comments.id })
    if (updated.length === 0) {
      throw new ConflictError('COMMENT_NOT_PENDING', 'Comment is not awaiting review')
    }
    await recordAuditEvent({
      event: 'comment.moderation.rejected',
      actor: actorFromAuth(auth),
      headers: getRequestHeaders(),
      target: { type: 'comment', id: data.commentId },
      before: { moderationState: before.moderationState, deletedAt: null },
      after: { moderationState: before.moderationState, deletedAt },
      metadata: { reason: data.reason ?? null },
    })
    return { ok: true }
  })

export const rejectPostFn = createServerFn({ method: 'POST' })
  .inputValidator(RejectInput.parse)
  .handler(async ({ data }) => {
    const auth = await requireTeamAuth()
    const before = await db.query.posts.findFirst({ where: eq(posts.id, data.postId as never) })
    if (!before) throw new NotFoundError('POST_NOT_FOUND', `Post ${data.postId}`)
    const deletedAt = new Date()
    const updated = await db
      .update(posts)
      .set({ deletedAt })
      .where(
        and(
          eq(posts.id, data.postId as never),
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
      actor: actorFromAuth(auth),
      headers: getRequestHeaders(),
      target: { type: 'post', id: data.postId },
      before: { moderationState: before.moderationState, deletedAt: null },
      after: { moderationState: before.moderationState, deletedAt },
      metadata: { reason: data.reason ?? null },
    })
    return { ok: true }
  })

export const getModerationStatus = createServerFn({ method: 'GET' }).handler(async () => {
  await requireTeamAuth()
  // Use allSettled so a transient failure of one query does not nuke the
  // entire status badge. Filter through parent deletedAt to stay consistent
  // with the listPending*Fn queries — items on a soft-deleted board (or, for
  // comments, a soft-deleted post) should not contribute to the moderator's
  // workload count.
  const [postsResult, commentsResult] = await Promise.allSettled([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(posts)
      .innerJoin(boards, eq(posts.boardId, boards.id))
      .where(
        and(eq(posts.moderationState, 'pending'), isNull(posts.deletedAt), isNull(boards.deletedAt))
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(comments)
      .innerJoin(posts, eq(comments.postId, posts.id))
      .innerJoin(boards, eq(posts.boardId, boards.id))
      .where(
        and(
          eq(comments.moderationState, 'pending'),
          isNull(comments.deletedAt),
          isNull(posts.deletedAt),
          isNull(boards.deletedAt)
        )
      ),
  ])
  if (postsResult.status === 'rejected') {
    log.error({ err: postsResult.reason }, 'pending posts count failed')
  }
  if (commentsResult.status === 'rejected') {
    log.error({ err: commentsResult.reason }, 'pending comments count failed')
  }
  const postsCount = postsResult.status === 'fulfilled' ? (postsResult.value[0]?.count ?? 0) : 0
  const commentsCount =
    commentsResult.status === 'fulfilled' ? (commentsResult.value[0]?.count ?? 0) : 0
  const pendingCount = postsCount + commentsCount

  const portalConfig = await getPortalConfig()

  // Also surface the badge when any board has a per-board moderation
  // override set to `'on'`, even if the workspace default is 'none' AND
  // the queue is currently empty. Without this, an admin who explicitly
  // enables hold-posts on a single board sees no sidebar affordance until
  // the first submission lands — making the queue discoverable only by
  // chance. We only count `'on'` overrides because `'inherit'` defers to
  // the workspace policy (already covered by the requireApproval check
  // below) and `'off'` actively opts out.
  let approvalCount = 0
  try {
    const approvalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(boards)
      .where(
        and(
          isNull(boards.deletedAt),
          or(
            sql`${boards.access}->'moderation'->>'anonPosts' = 'on'`,
            sql`${boards.access}->'moderation'->>'signedPosts' = 'on'`,
            sql`${boards.access}->'moderation'->>'comments' = 'on'`
          )
        )
      )
    approvalCount = approvalRows[0]?.count ?? 0
  } catch (err) {
    log.error({ err }, 'per-board approval count failed')
  }

  // Self-consistent: if there is a backlog (e.g. per-board approval routes
  // items to pending while the workspace default is 'none'), surface it.
  const enabled =
    portalConfig.moderationDefault.requireApproval !== 'none' ||
    pendingCount > 0 ||
    approvalCount > 0

  return { enabled, pendingCount }
})
