/** Bounded operational lists over existing records, scoped exactly like the inbox. */
import {
  db,
  conversations,
  tickets,
  assistantInvolvements,
  assistantPendingActions,
  assistantRuns,
  and,
  or,
  eq,
  ne,
  desc,
  gte,
  gt,
  lte,
  exists,
  inArray,
  isNull,
  sql,
} from '@/lib/server/db'
import { conversationFilter } from '@/lib/server/policy/conversations'
import { ticketFilter } from '@/lib/server/policy/tickets'
import type { Actor } from '@/lib/server/policy/types'

/** One row of the Improve queue, whatever kind of item Quinn worked on. */
export interface QuinnReviewRow {
  id: string
  /** Which item this is, so the surface knows what it may offer on the row. */
  parent: 'conversation' | 'ticket'
  subject: string
  lastActivityAt: string
  reason: string
}

export async function getQuinnReviewQueue(
  actor: Actor,
  kind: 'review' | 'live',
  days: 7 | 30,
  limit = 10,
  now = new Date()
): Promise<QuinnReviewRow[]> {
  const bounded = Math.max(1, Math.min(limit, 20))
  const [conversationRows, ticketRows] = await Promise.all([
    conversationQueue(actor, kind, days, bounded, now),
    ticketQueue(actor, kind, days, bounded, now),
  ])
  // One list, newest first, bounded as a whole: an operator reading the top of
  // the Improve page wants the most recent work whichever item it happened on.
  return [...conversationRows, ...ticketRows]
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
    .slice(0, bounded)
}

async function conversationQueue(
  actor: Actor,
  kind: 'review' | 'live',
  days: 7 | 30,
  limit: number,
  now: Date
): Promise<QuinnReviewRow[]> {
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
    .limit(limit)
  return rows.map((row) => ({
    id: row.id,
    parent: 'conversation' as const,
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

/** The runs whose disposition means a person should look at the answer. */
const FLAGGED_RUN_STATUSES = ['failed'] as const

/**
 * Tickets Quinn worked on that a person should read (QUINN-PRODUCT P9).
 *
 * A ticket has no CSAT and no involvement, so the two signals a conversation
 * offers do not exist here. What does exist is the run ledger the inspector
 * already reads: a proposal nobody has decided, and a run that failed or was
 * refused by the validator. Both are the same question the conversation rows
 * ask, asked of the records a ticket actually has.
 */
async function ticketQueue(
  actor: Actor,
  kind: 'review' | 'live',
  days: 7 | 30,
  limit: number,
  now: Date
): Promise<QuinnReviewRow[]> {
  const from = new Date(now.getTime() - days * 86400000)
  const approval = exists(
    db
      .select({ id: assistantPendingActions.id })
      .from(assistantPendingActions)
      .where(
        and(
          eq(assistantPendingActions.ticketId, tickets.id),
          eq(assistantPendingActions.status, 'proposed'),
          gt(assistantPendingActions.expiresAt, now)
        )
      )
  )
  const flagged = exists(
    db
      .select({ id: assistantRuns.id })
      .from(assistantRuns)
      .where(
        and(
          eq(assistantRuns.ticketId, tickets.id),
          gte(assistantRuns.createdAt, from),
          or(
            inArray(assistantRuns.status, [...FLAGGED_RUN_STATUSES]),
            // A validator refusal is a suppressed run with a disposition that
            // names it, which is what the unsupported-answer metric reads too.
            sql`${assistantRuns.disposition} LIKE 'validation:%'`
          )
        )
      )
  )
  const live = exists(
    db
      .select({ id: assistantRuns.id })
      .from(assistantRuns)
      .where(
        and(
          eq(assistantRuns.ticketId, tickets.id),
          inArray(assistantRuns.status, ['queued', 'running', 'waiting_action'])
        )
      )
  )
  const rows = await db
    .select({
      id: tickets.id,
      subject: tickets.title,
      at: tickets.updatedAt,
      approval: sql<boolean>`${approval}`,
    })
    .from(tickets)
    .where(and(ticketFilter(actor), kind === 'live' ? live : or(approval, flagged)))
    .orderBy(desc(tickets.updatedAt), desc(tickets.id))
    .limit(limit)
  return rows.map((row) => ({
    id: row.id,
    parent: 'ticket' as const,
    subject: row.subject,
    lastActivityAt: row.at.toISOString(),
    reason: row.approval ? 'Needs approval' : kind === 'live' ? 'Quinn active' : 'Answer refused',
  }))
}
