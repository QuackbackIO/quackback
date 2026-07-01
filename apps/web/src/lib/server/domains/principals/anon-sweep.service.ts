/**
 * Anonymous-principal sweep. Durable anon tokens (P0.1) keep anonymous
 * principals around far longer than the old per-session lifetime, so abandoned
 * empties accumulate and degrade the per-IP anon-vote rate limit (which JOINs
 * sessions + principals). This reclaims them.
 *
 * Only TRULY EMPTY anon principals are deleted — created beyond the retention
 * window, no live session, and no content anywhere (posts/votes/comments/
 * comment_reactions/conversations/messages/subscriptions/notifications). A
 * principal that authored anything is left untouched.
 *
 * The NOT EXISTS list must cover every table where an anon actor can author
 * content, because the FKs are a mix: conversation FKs are onDelete:restrict (a missed
 * one would throw and be caught), but content like comment_reactions is
 * onDelete:CASCADE — a missing guard there would NOT throw; it would silently
 * cascade-delete real content. So the guard, not the catch block, is the
 * safety net for cascade tables. (notification_preferences / unsubscribe_tokens
 * also cascade but are derived preference state, so sweeping them is intended.)
 * Each principal is still removed in its own transaction so an unexpected
 * restrict reference skips just that row rather than failing the batch.
 */
import { db, eq, sql, principal, session, user } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'anon-sweep' })

export interface AnonSweepResult {
  /** Eligible empties found this run (bounded by batchSize). */
  candidates: number
  /** Actually deleted (candidates minus any skipped on an unexpected FK). */
  deleted: number
}

export async function sweepAnonymousPrincipals(opts?: {
  olderThanDays?: number
  batchSize?: number
}): Promise<AnonSweepResult> {
  const olderThanDays = opts?.olderThanDays ?? 30
  const batchSize = opts?.batchSize ?? 500
  const cutoffIso = new Date(Date.now() - olderThanDays * 86_400_000).toISOString()

  const rows = await db.execute(sql`
    SELECT pr.id AS principal_id, pr.user_id AS user_id
    FROM principal pr
    WHERE pr.type = 'anonymous'
      AND pr.user_id IS NOT NULL
      AND pr.created_at < ${cutoffIso}::timestamptz
      AND NOT EXISTS (SELECT 1 FROM session s WHERE s.user_id = pr.user_id AND s.expires_at > now())
      AND NOT EXISTS (SELECT 1 FROM posts WHERE principal_id = pr.id)
      AND NOT EXISTS (SELECT 1 FROM post_votes WHERE principal_id = pr.id)
      AND NOT EXISTS (SELECT 1 FROM post_comments WHERE principal_id = pr.id)
      AND NOT EXISTS (SELECT 1 FROM post_comment_reactions WHERE principal_id = pr.id)
      AND NOT EXISTS (SELECT 1 FROM conversations WHERE visitor_principal_id = pr.id)
      AND NOT EXISTS (SELECT 1 FROM conversation_messages WHERE principal_id = pr.id)
      AND NOT EXISTS (SELECT 1 FROM post_subscriptions WHERE principal_id = pr.id)
      AND NOT EXISTS (SELECT 1 FROM in_app_notifications WHERE principal_id = pr.id)
    LIMIT ${batchSize}
  `)

  const targets = rows as unknown as Array<{ principal_id: string; user_id: string }>
  let deleted = 0
  for (const t of targets) {
    try {
      await db.transaction(async (tx) => {
        await tx.delete(principal).where(eq(principal.id, t.principal_id as never))
        await tx.delete(session).where(eq(session.userId, t.user_id as never))
        await tx.delete(user).where(eq(user.id, t.user_id as never))
      })
      deleted++
    } catch (err) {
      // An unexpected referencing row (FK restrict) — leave it and move on.
      log.warn({ principal_id: t.principal_id, err }, 'anon-sweep skipped principal')
    }
  }

  return { candidates: targets.length, deleted }
}
