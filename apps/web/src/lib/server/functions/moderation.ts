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
import { db, posts, postComments, boards, sql } from '@/lib/server/db'
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
  // One round trip for all three counts, so the rail's badge costs the page
  // that carries it a single query. Filter through parent deletedAt to stay
  // consistent with the listPending*Fn queries: items on a soft-deleted board
  // (or, for comments, a soft-deleted post) should not contribute to the
  // moderator's workload count.
  //
  // The third count lets the status surface when any board has a per-board
  // moderation override set to `'on'`, even if the workspace default is 'none'
  // AND the queue is currently empty. Without it, an admin who explicitly
  // enables hold-posts on a single board sees no sidebar affordance until the
  // first submission lands, making the queue discoverable only by chance. Only
  // `'on'` overrides count because `'inherit'` defers to the workspace policy
  // (covered by the requireApproval check below) and `'off'` opts out.
  let postsCount = 0
  let commentsCount = 0
  let approvalCount = 0
  try {
    const result = await db.execute(sql`
      select
        (select count(*)::int from ${posts}
          inner join ${boards} on ${posts.boardId} = ${boards.id}
          where ${posts.moderationState} = 'pending'
            and ${posts.deletedAt} is null and ${boards.deletedAt} is null) as posts,
        (select count(*)::int from ${postComments}
          inner join ${posts} on ${postComments.postId} = ${posts.id}
          inner join ${boards} on ${posts.boardId} = ${boards.id}
          where ${postComments.moderationState} = 'pending'
            and ${postComments.deletedAt} is null
            and ${posts.deletedAt} is null and ${boards.deletedAt} is null) as comments,
        (select count(*)::int from ${boards}
          where ${boards.deletedAt} is null
            and (${boards.access}->'moderation'->>'anonPosts' = 'on'
              or ${boards.access}->'moderation'->>'signedPosts' = 'on'
              or ${boards.access}->'moderation'->>'comments' = 'on')) as approvals
    `)
    const [counts] = result as unknown as Array<{
      posts: number
      comments: number
      approvals: number
    }>
    postsCount = counts?.posts ?? 0
    commentsCount = counts?.comments ?? 0
    approvalCount = counts?.approvals ?? 0
  } catch (err) {
    // A transient failure must not nuke the whole status badge.
    log.error({ err }, 'moderation counts failed')
  }
  const pendingCount = postsCount + commentsCount

  const portalConfig = await getPortalConfig()

  // Self-consistent: if there is a backlog (e.g. per-board approval routes
  // items to pending while the workspace default is 'none'), surface it.
  const enabled =
    portalConfig.moderationDefault.requireApproval !== 'none' ||
    portalConfig.moderationDefault.holdImages === true ||
    portalConfig.moderationDefault.holdLinks === true ||
    pendingCount > 0 ||
    approvalCount > 0

  return { enabled, pendingCount }
})
