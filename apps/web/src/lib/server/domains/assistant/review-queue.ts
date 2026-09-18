/** Bounded operational lists over existing records, scoped exactly like the inbox. */
import {
  db,
  conversations,
  assistantInvolvements,
  assistantPendingActions,
  and,
  or,
  eq,
  ne,
  desc,
  gte,
  gt,
  lte,
  exists,
  isNull,
  sql,
} from '@/lib/server/db'
import { conversationFilter } from '@/lib/server/policy/conversations'
import type { Actor } from '@/lib/server/policy/types'

export async function getQuinnReviewQueue(
  actor: Actor,
  kind: 'review' | 'live',
  days: 7 | 30,
  limit = 10,
  now = new Date()
) {
  const from = new Date(now.getTime() - days * 86400000)
  const latest = db
    .selectDistinctOn([assistantInvolvements.conversationId], {
      conversationId: assistantInvolvements.conversationId,
      status: assistantInvolvements.status,
      createdAt: assistantInvolvements.createdAt,
      endedAt: assistantInvolvements.endedAt,
    })
    .from(assistantInvolvements)
    .orderBy(
      assistantInvolvements.conversationId,
      desc(assistantInvolvements.createdAt),
      desc(assistantInvolvements.id)
    )
    .as('quinn_latest')
  const approval = exists(
    db
      .select({ id: assistantPendingActions.id })
      .from(assistantPendingActions)
      .where(
        and(
          eq(assistantPendingActions.conversationId, conversations.id),
          eq(assistantPendingActions.status, 'proposed'),
          gt(assistantPendingActions.expiresAt, now)
        )
      )
  )
  const negative = and(
    lte(conversations.csatRating, 2),
    gte(conversations.csatSubmittedAt, from),
    gte(conversations.csatSubmittedAt, latest.createdAt)
  )!
  const handoff = and(eq(latest.status, 'handed_off'), gte(latest.endedAt, from))!
  const rows = await db
    .select({
      id: conversations.id,
      subject: conversations.subject,
      at: conversations.lastMessageAt,
      approval: sql<boolean>`${approval}`,
      negative: sql<boolean>`coalesce(${negative}, false)`,
    })
    .from(conversations)
    .leftJoin(latest, eq(latest.conversationId, conversations.id))
    .where(
      and(
        conversationFilter(actor),
        or(isNull(conversations.endReason), ne(conversations.endReason, 'spam')),
        kind === 'live'
          ? and(eq(latest.status, 'active'), eq(conversations.status, 'open'))
          : or(approval, negative, handoff)
      )
    )
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
    .limit(Math.max(1, Math.min(limit, 20)))
  return rows.map((row) => ({
    id: row.id,
    subject: row.subject ?? 'Conversation',
    lastActivityAt: row.at.toISOString(),
    reason: row.approval
      ? 'Needs approval'
      : row.negative
        ? 'Negative rating'
        : kind === 'live'
          ? 'Quinn active'
          : 'Handed to team',
  }))
}
