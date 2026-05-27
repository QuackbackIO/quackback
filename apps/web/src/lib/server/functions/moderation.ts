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
import { db, posts, comments, boards, principal, eq, and, isNull, desc, sql } from '@/lib/server/db'
import { requireAuth } from '@/lib/server/functions/auth-helpers'
import { recordAuditEvent, actorFromAuth } from '@/lib/server/audit/log'
import { isTeamMember } from '@/lib/shared/roles'
import { ForbiddenError, NotFoundError, ConflictError } from '@/lib/shared/errors'
import { getPortalConfig } from '@/lib/server/domains/settings/settings.service'
import { announcePublishedPost } from '@/lib/server/domains/posts/post.announce'

const ApproveInput = z.object({ postId: z.string() })
const RejectInput = z.object({ postId: z.string(), reason: z.string().max(500).optional() })
const ApproveCommentInput = z.object({ commentId: z.string() })
const RejectCommentInput = z.object({
  commentId: z.string(),
  reason: z.string().max(500).optional(),
})

export const listPendingPostsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await requireAuth()
  if (!isTeamMember(auth.principal.role)) {
    throw new ForbiddenError('FORBIDDEN', 'Team only')
  }
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
  const auth = await requireAuth()
  if (!isTeamMember(auth.principal.role)) {
    throw new ForbiddenError('FORBIDDEN', 'Team only')
  }
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
    const auth = await requireAuth()
    if (!isTeamMember(auth.principal.role)) {
      throw new ForbiddenError('FORBIDDEN', 'Team only')
    }
    const before = await db.query.posts.findFirst({ where: eq(posts.id, data.postId as never) })
    if (!before) throw new NotFoundError('POST_NOT_FOUND', `Post ${data.postId}`)
    const updated = await db
      .update(posts)
      .set({ moderationState: 'published' })
      .where(
        and(
          eq(posts.id, data.postId as never),
          eq(posts.moderationState, 'pending'),
          isNull(posts.deletedAt)
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
      console.error('[moderation] announcePublishedPost failed:', err)
    }
    return { ok: true }
  })

export const approveCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(ApproveCommentInput.parse)
  .handler(async ({ data }) => {
    const auth = await requireAuth()
    if (!isTeamMember(auth.principal.role)) {
      throw new ForbiddenError('FORBIDDEN', 'Team only')
    }
    const before = await db.query.comments.findFirst({
      where: eq(comments.id, data.commentId as never),
    })
    if (!before) throw new NotFoundError('COMMENT_NOT_FOUND', `Comment ${data.commentId}`)
    const updated = await db
      .update(comments)
      .set({ moderationState: 'published' })
      .where(
        and(
          eq(comments.id, data.commentId as never),
          eq(comments.moderationState, 'pending'),
          isNull(comments.deletedAt)
        )
      )
      .returning({ id: comments.id })
    if (updated.length === 0) {
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
    return { ok: true }
  })

export const rejectCommentFn = createServerFn({ method: 'POST' })
  .inputValidator(RejectCommentInput.parse)
  .handler(async ({ data }) => {
    const auth = await requireAuth()
    if (!isTeamMember(auth.principal.role)) {
      throw new ForbiddenError('FORBIDDEN', 'Team only')
    }
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
          isNull(comments.deletedAt)
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
    const auth = await requireAuth()
    if (!isTeamMember(auth.principal.role)) {
      throw new ForbiddenError('FORBIDDEN', 'Team only')
    }
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
          isNull(posts.deletedAt)
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
  const auth = await requireAuth()
  if (!isTeamMember(auth.principal.role)) {
    throw new ForbiddenError('FORBIDDEN', 'Team only')
  }
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
    console.error('[moderation] pending posts count failed:', postsResult.reason)
  }
  if (commentsResult.status === 'rejected') {
    console.error('[moderation] pending comments count failed:', commentsResult.reason)
  }
  const postsCount = postsResult.status === 'fulfilled' ? (postsResult.value[0]?.count ?? 0) : 0
  const commentsCount =
    commentsResult.status === 'fulfilled' ? (commentsResult.value[0]?.count ?? 0) : 0
  const pendingCount = postsCount + commentsCount

  const portalConfig = await getPortalConfig()
  // Self-consistent: if there is a backlog (e.g. per-board approval routes
  // items to pending while the workspace default is 'none'), surface it.
  const enabled = portalConfig.moderationDefault.requireApproval !== 'none' || pendingCount > 0

  return { enabled, pendingCount }
})
