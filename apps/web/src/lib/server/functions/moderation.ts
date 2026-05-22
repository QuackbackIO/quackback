/**
 * Moderation server functions.
 *
 * - listPendingPostsFn   — team-only feed of posts in moderationState='pending'
 * - approvePostFn        — guarded transition: pending → published (ConflictError if not pending)
 * - rejectPostFn         — guarded soft-delete: sets deletedAt on a pending post with optional
 *                          reason in the audit trail; restoring returns it to the queue.
 *
 * Approve and reject are team-level operations (admin OR member): mirrors
 * Canny/Featurebase where moderators are a separate concept from workspace
 * admins. Changing board-level moderation *policy* (Task 19) is admin-only
 * because granting/revoking visibility is policy-level work.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db, posts, eq, and, isNull } from '@/lib/server/db'
import { requireAuth } from '@/lib/server/functions/auth-helpers'
import { recordAuditEvent, actorFromAuth } from '@/lib/server/audit/log'
import { isTeamMember } from '@/lib/shared/roles'
import { ForbiddenError, NotFoundError, ConflictError } from '@/lib/shared/errors'

const ApproveInput = z.object({ postId: z.string() })
const RejectInput = z.object({ postId: z.string(), reason: z.string().max(500).optional() })

export const listPendingPostsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = await requireAuth()
  if (!isTeamMember(auth.principal.role)) {
    throw new ForbiddenError('FORBIDDEN', 'Team only')
  }
  const rows = await db.select().from(posts).where(eq(posts.moderationState, 'pending'))
  return { posts: rows }
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
      .where(and(eq(posts.id, data.postId as never), eq(posts.moderationState, 'pending')))
      .returning({ id: posts.id })
    if (updated.length === 0) {
      throw new ConflictError('POST_NOT_PENDING', 'Post is not awaiting review')
    }
    await recordAuditEvent({
      event: 'post.moderation.approved',
      actor: actorFromAuth(auth),
      target: { type: 'post', id: data.postId },
      before: { moderationState: before.moderationState },
      after: { moderationState: 'published' },
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
    const updated = await db
      .update(posts)
      .set({ deletedAt: new Date() })
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
      target: { type: 'post', id: data.postId },
      before: { moderationState: before.moderationState, deletedAt: null },
      after: { moderationState: before.moderationState, deletedAt: 'set' },
      metadata: { reason: data.reason ?? null },
    })
    return { ok: true }
  })
