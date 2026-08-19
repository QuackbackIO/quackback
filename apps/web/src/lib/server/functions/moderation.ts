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
import { db, posts, postComments, boards, eq, and, or, isNull, sql } from '@/lib/server/db'
import type { PostId, PostCommentId } from '@quackback/ids'
import { requireAuth } from '@/lib/server/functions/auth-helpers'
import { actorFromAuth } from '@/lib/server/audit/log'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { getPortalConfig } from '@/lib/server/domains/settings/settings.service'
import {
  listPendingPosts,
  listPendingComments,
  approvePost,
  rejectPost,
  approveComment,
  rejectComment,
} from '@/lib/server/domains/moderation/moderation.service'

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
  const auth = await requireAuth({ permission: PERMISSIONS.POST_APPROVE })
  return auth
}

export const listPendingPostsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireTeamAuth()
  return { posts: await listPendingPosts() }
})

export const listPendingCommentsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireTeamAuth()
  return { comments: await listPendingComments() }
})

export const approvePostFn = createServerFn({ method: 'POST' })
  .validator(ApproveInput.parse)
  .handler(async ({ data }) => {
    const auth = await requireTeamAuth()
    await approvePost(data.postId as PostId, {
      actor: actorFromAuth(auth),
      headers: getRequestHeaders(),
    })
    return { ok: true }
  })

export const approveCommentFn = createServerFn({ method: 'POST' })
  .validator(ApproveCommentInput.parse)
  .handler(async ({ data }) => {
    const auth = await requireTeamAuth()
    await approveComment(data.commentId as PostCommentId, {
      actor: actorFromAuth(auth),
      headers: getRequestHeaders(),
    })
    return { ok: true }
  })

export const rejectCommentFn = createServerFn({ method: 'POST' })
  .validator(RejectCommentInput.parse)
  .handler(async ({ data }) => {
    const auth = await requireTeamAuth()
    await rejectComment(data.commentId as PostCommentId, data.reason, {
      actor: actorFromAuth(auth),
      headers: getRequestHeaders(),
    })
    return { ok: true }
  })

export const rejectPostFn = createServerFn({ method: 'POST' })
  .validator(RejectInput.parse)
  .handler(async ({ data }) => {
    const auth = await requireTeamAuth()
    await rejectPost(data.postId as PostId, data.reason, {
      actor: actorFromAuth(auth),
      headers: getRequestHeaders(),
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
      .from(postComments)
      .innerJoin(posts, eq(postComments.postId, posts.id))
      .innerJoin(boards, eq(posts.boardId, boards.id))
      .where(
        and(
          eq(postComments.moderationState, 'pending'),
          isNull(postComments.deletedAt),
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
