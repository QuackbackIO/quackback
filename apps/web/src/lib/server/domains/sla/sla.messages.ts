/**
 * What a conversation's own messages say about its response clocks.
 *
 * The SLA reaction runs from a queued job per event, and those jobs can run
 * late or out of order (see events/event-reactions.ts). The message rows never
 * reorder, so the clocks read them rather than trusting the order the jobs
 * arrive in.
 *
 * The split is the one recordSlaFromEvent makes on the event: a human reply is
 * a public agent message from anyone but a service principal (the assistant,
 * API keys and workflow blocks never satisfy a response clock), and every
 * other public message opens a next-response cycle: a visitor's, or a service
 * principal's. Internal notes and system notices are neither.
 *
 * One known difference from the event: a reply sent through the REST API with
 * an older API key whose principal is a person is stored exactly like that
 * person's inbox reply, so the rows count it as a human reply, while its own
 * event carries a service actor. Its own reaction settles no first response,
 * but it does settle an armed next-response cycle at its own time, since the
 * cycles are rebuilt from the rows. A later human reply's reaction then settles
 * the first response at that API reply's time too. The row records nothing
 * that tells the two apart.
 */
import {
  db,
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  lt,
  or,
  sql,
  conversationMessages,
  principal,
} from '@/lib/server/db'
import type { SQL } from 'drizzle-orm'
import type { ConversationId } from '@quackback/ids'

/**
 * Whether the message's author is a service principal. A membership test
 * against the (few) service principals rather than a join: a join lets the
 * planner hash the whole principal table for a long conversation, whatever
 * the time bound. A message without a principal is not a service's.
 */
const byService = sql`coalesce(${conversationMessages.principalId} in (select ${principal.id} from ${principal} where ${principal.type} = 'service'), false)`

const humanReply = and(eq(conversationMessages.senderType, 'agent'), sql`not ${byService}`)

const cycleOpener = or(
  eq(conversationMessages.senderType, 'visitor'),
  and(eq(conversationMessages.senderType, 'agent'), byService)
)

async function earliestMessageTime(
  conversationId: ConversationId,
  where: (SQL | undefined)[]
): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: conversationMessages.createdAt })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.isInternal, false),
        ...where
      )
    )
    .orderBy(asc(conversationMessages.createdAt))
    .limit(1)
  return row?.createdAt ?? null
}

/** When the first human reply written after `after` was written, or null when there is none yet. */
export function earliestHumanReplyAfter(
  conversationId: ConversationId,
  after: Date
): Promise<Date | null> {
  return earliestMessageTime(conversationId, [
    humanReply,
    gt(conversationMessages.createdAt, after),
  ])
}

/** A message as the response clocks read it: a human reply, or one that opens a cycle. */
export interface ResponseMessage {
  at: Date
  kind: 'reply' | 'opener'
}

/** The conversation's human replies and cycle openers written from `since` on, oldest first. */
export async function responseMessagesSince(
  conversationId: ConversationId,
  since: Date
): Promise<ResponseMessage[]> {
  const rows = await db
    .select({ at: conversationMessages.createdAt, reply: sql<boolean>`${humanReply}` })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.isInternal, false),
        gte(conversationMessages.createdAt, since),
        or(humanReply, cycleOpener)
      )
    )
    .orderBy(asc(conversationMessages.createdAt))
  return rows.map((row) => ({ at: row.at, kind: row.reply ? 'reply' : 'opener' }))
}

/**
 * The cycle openers written after `after` and before `before`, latest first,
 * at most `limit` of them: a bounded backward read of the conversation's
 * index.
 */
export async function latestOpenersBetween(
  conversationId: ConversationId,
  after: Date,
  before: Date,
  limit: number
): Promise<Date[]> {
  const rows = await db
    .select({ at: conversationMessages.createdAt })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.isInternal, false),
        gt(conversationMessages.createdAt, after),
        lt(conversationMessages.createdAt, before),
        cycleOpener
      )
    )
    .orderBy(desc(conversationMessages.createdAt))
    .limit(limit)
  return rows.map((row) => row.at)
}

/** A next-response cycle: the message that opened it, and the reply that answered it, if any. */
export interface ResponseCycle {
  opener: Date
  reply: Date | null
}

/**
 * The next-response cycles the messages make after the first response: the
 * one given, else the first human reply after `since`. A cycle opens at the
 * last opener before the next reply (each customer message restarts the
 * wait, so the latest wins), and that reply answers it. An opener written at
 * or before a reply is answered by it. The last cycle is open when no reply
 * follows it.
 */
export function responseCycles(
  messages: ResponseMessage[],
  since: Date,
  firstResponse: Date | null
): ResponseCycle[] {
  const ordered = [...messages].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || (a.kind === 'reply' ? -1 : 1)
  )
  let lastReply =
    firstResponse ??
    ordered.find((message) => message.kind === 'reply' && message.at > since)?.at ??
    null
  if (!lastReply) return []
  const cycles: ResponseCycle[] = []
  let opener: Date | null = null
  for (const message of ordered) {
    if (message.at <= lastReply) continue
    if (message.kind === 'opener') {
      opener = message.at
      continue
    }
    if (opener) cycles.push({ opener, reply: message.at })
    opener = null
    lastReply = message.at
  }
  if (opener) cycles.push({ opener, reply: null })
  return cycles
}
