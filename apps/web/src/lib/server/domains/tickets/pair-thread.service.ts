/**
 * Pair-thread union loader (convergence Phase 0 — scratchpad/convergence-design.md,
 * mechanics appendix "Read (Phase 0)").
 *
 * PAIR RULE. A customer ticket and the conversation it was created from are ONE
 * thread. The pair is 1:1 through `ticket_conversations` — one customer ticket
 * per conversation (0150's `ticket_conversations_customer_uq`) AND one
 * conversation per customer ticket (0214's
 * `ticket_conversations_customer_ticket_uq`) — resolved here from the ticket
 * side. Back-office/tracker tickets are never conversation-linked
 * (`linkTicketToConversation` rejects them), so for them, and for a
 * not-yet-linked standalone customer ticket, the union degenerates to the
 * legacy ticket-parented thread alone — byte-identical to the pre-convergence
 * read.
 *
 * MERGE CONTRACT. Messages are strictly polymorphic-XOR (`conversation_messages`
 * carries conversation_id XOR ticket_id, CHECK from 0151), so the shared thread
 * is a READ-path union of two parents in the SAME table: each parent's page is
 * fetched with its own keyset on (created_at, id) against its own per-parent
 * index, then merged in code (precedent: the inbox's two-branch merge,
 * inbox.query.ts). Because both parents share one table and one (created_at,
 * id) keyset shape, a SINGLE message-id cursor anchors both — the `before`
 * contract `listTicketMessages` already had (the inbox needs two cursors only
 * because its branches are different tables). The cursor id resolves unscoped
 * (exactly as `listTicketMessages` always resolved it): either parent's rows
 * keyset against the same anchor. The merged page is the top
 * `MESSAGE_PAGE_SIZE` rows of the concatenation in (created_at DESC, id DESC),
 * returned oldest-first for rendering. Each parent is fetched with limit+1, so
 * the merged row count exceeding a page is EXACTLY "more rows exist"
 * (overflow in either parent, or two non-overflowing parents whose rows
 * interleave past the page boundary — the cut rows re-emerge on the next page
 * because the merge preserves per-parent order below the cursor anchor).
 * Every returned DTO carries a `source` provenance hint
 * ('ticket' | 'conversation'); the DTO's conversationId/ticketId fields already
 * discriminate the parent — `source` just makes it explicit for renderers and
 * tests. It is additive: pre-union renderers ignore it.
 *
 * AUDIENCE RULE. `includeInternal: false` (requester portal/widget, summaries,
 * public surfaces) applies `is_internal = false` to BOTH parents — an internal
 * note is internal whichever parent it hangs off (`ticket_id + is_internal =
 * true` notes stay out of the customer view even after Phase 1a redirects
 * customer-visible writes to the conversation). `includeInternal: true`
 * (agent) returns everything from both parents.
 *
 * PHASE 0 vs 1a BOUNDARY. This loader is read-only: it changes NOTHING about
 * where new writes land. Phase 1a's write redirect re-parents new
 * customer-visible writes to the conversation; legacy ticket-parented rows are
 * never migrated, so this union read is load-bearing from the moment it ships
 * (reverting Phase 1a's redirect never reverts this loader). Agent-view
 * enrichment (reactions/flags) stays layered in ticket-message.service's
 * `listTicketMessagesForAgent`.
 *
 * PHASE 2 — assistant-turn flagging. `isAssistant` resolves here exactly the
 * way the conversation view does (`listMessages`): the shared memoized
 * assistant-principal lookup (messages/assistant-principal) is passed to
 * `toMessageDTO`, so Quinn's turns carry the AI flag on BOTH parents of the
 * pair — a Quinn reply read through the ticket-side union renders identically
 * to the same row in the conversation view (agent pair view, and the
 * requester surfaces that already render the flag).
 */
import {
  db,
  conversationMessages,
  ticketConversations,
  eq,
  and,
  or,
  lt,
  asc,
  desc,
  inArray,
  isNull,
  type ConversationMessage,
} from '@/lib/server/db'
import type { ConversationId, ConversationMessageId, TicketId } from '@quackback/ids'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'
import { toMessageDTO } from '@/lib/server/messages/message-core'
import { assistantPrincipalIdOnce } from '@/lib/server/messages/assistant-principal'
import { loadAuthors, fallbackAuthor } from '../principals/principal-display'

/** Same page size as the pre-convergence ticket thread (ticket-message.service). */
const MESSAGE_PAGE_SIZE = 30

/** Which parent of the pair a merged thread row hangs off. */
export type PairThreadMessageSource = 'ticket' | 'conversation'

/** A thread DTO plus its parent provenance (additive — see the module doc). */
export type PairThreadMessageDTO = ConversationMessageDTO & {
  source: PairThreadMessageSource
}

export interface PairThreadMessagePage {
  messages: PairThreadMessageDTO[]
  hasMore: boolean
}

/** One parent of the pair: the ticket itself, or its linked conversation. */
type PairParent =
  | { source: 'ticket'; ticketId: TicketId }
  | { source: 'conversation'; conversationId: ConversationId }

/** A keyset anchor on (created_at, id) — one shape serves both parents. */
interface PairCursor {
  createdAt: Date
  id: ConversationMessageId
}

/**
 * The conversation a CUSTOMER ticket is paired with, or null when the ticket
 * is standalone (or back-office/tracker — those are never linked, and the
 * `ticket_type` predicate keeps even a stray non-customer link row from
 * creating a pair). At most one row can match (0214's partial unique index).
 */
export async function resolvePairConversationId(
  ticketId: TicketId
): Promise<ConversationId | null> {
  const [link] = await db
    .select({ conversationId: ticketConversations.conversationId })
    .from(ticketConversations)
    .where(
      and(
        eq(ticketConversations.ticketId, ticketId),
        eq(ticketConversations.ticketType, 'customer')
      )
    )
    .limit(1)
  return link?.conversationId ?? null
}

/**
 * Batched sibling of `resolvePairConversationId` for page loaders (the ticket
 * DTO's activity read, the requester unread map) — one query resolves a whole
 * page of tickets instead of an N+1. Same pair rule: only `ticket_type =
 * 'customer'` links resolve, and unlinked tickets are simply absent from the
 * returned map.
 */
export async function resolvePairConversationIds(
  ticketIds: TicketId[]
): Promise<Map<TicketId, ConversationId>> {
  const map = new Map<TicketId, ConversationId>()
  if (ticketIds.length === 0) return map
  const links = await db
    .select({
      ticketId: ticketConversations.ticketId,
      conversationId: ticketConversations.conversationId,
    })
    .from(ticketConversations)
    .where(
      and(
        inArray(ticketConversations.ticketId, ticketIds),
        eq(ticketConversations.ticketType, 'customer')
      )
    )
  for (const link of links) map.set(link.ticketId, link.conversationId)
  return map
}

/**
 * The conversation-side twin of `resolvePairConversationId`: the CUSTOMER
 * ticket a conversation is paired with, or null when none is linked yet (the
 * pre-conversion case — the create-ticket dialog's auto-fill grounding,
 * convergence Phase 5, resolves the pair this way and then reads the union
 * through `listPairThreadMessages` exactly as the ticket side does). At most
 * one row can match (0150's partial unique index).
 */
export async function resolvePairTicketIdForConversation(
  conversationId: ConversationId
): Promise<TicketId | null> {
  const [link] = await db
    .select({ ticketId: ticketConversations.ticketId })
    .from(ticketConversations)
    .where(
      and(
        eq(ticketConversations.conversationId, conversationId),
        eq(ticketConversations.ticketType, 'customer')
      )
    )
    .limit(1)
  return link?.ticketId ?? null
}

/**
 * Resolve a `before` message-id cursor to its (created_at, id) keyset anchor.
 * Unscoped by parent — a message id is globally unique (one table), and either
 * parent's rows keyset correctly against the same anchor (see the MERGE
 * CONTRACT note). An unknown/deleted id degrades to "no cursor", mirroring
 * listTicketMessages' pre-convergence resolution.
 */
async function resolvePairCursor(before: string | undefined): Promise<PairCursor | null> {
  if (!before) return null
  const [row] = await db
    .select({ createdAt: conversationMessages.createdAt, id: conversationMessages.id })
    .from(conversationMessages)
    .where(eq(conversationMessages.id, before as ConversationMessageId))
    .limit(1)
  return row ?? null
}

/** The WHERE clause one parent's page shares: parent predicate + audience + keyset. */
function pairParentWhere(
  parent: PairParent,
  opts: { includeInternal: boolean; cursor: PairCursor | null }
) {
  const { cursor } = opts
  return and(
    parent.source === 'ticket'
      ? eq(conversationMessages.ticketId, parent.ticketId)
      : eq(conversationMessages.conversationId, parent.conversationId),
    isNull(conversationMessages.deletedAt),
    // AUDIENCE RULE: the internal strip applies to both parents alike.
    opts.includeInternal ? undefined : eq(conversationMessages.isInternal, false),
    cursor
      ? or(
          lt(conversationMessages.createdAt, cursor.createdAt),
          and(
            eq(conversationMessages.createdAt, cursor.createdAt),
            lt(conversationMessages.id, cursor.id)
          )
        )
      : undefined
  )
}

/** One parent's keyset page (newest-first, `limit + 1` rows) against its own index. */
async function fetchParentPage(
  parent: PairParent,
  opts: { includeInternal: boolean; cursor: PairCursor | null; limit: number }
): Promise<ConversationMessage[]> {
  return db
    .select()
    .from(conversationMessages)
    .where(pairParentWhere(parent, opts))
    .orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.id))
    .limit(opts.limit + 1)
}

/** One parent's ENTIRE remaining thread (oldest-first) — the `all: true` read. */
async function fetchParentAll(
  parent: PairParent,
  opts: { includeInternal: boolean }
): Promise<ConversationMessage[]> {
  return db
    .select()
    .from(conversationMessages)
    .where(pairParentWhere(parent, { ...opts, cursor: null }))
    .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id))
}

/**
 * Total order across both parents, newest-first: (created_at DESC, id DESC).
 * Ids share one sequence space (same table, same column type), so the JS
 * string tiebreak matches the SQL `id DESC` ordering for the typeid values.
 */
function compareNewestFirst(a: ConversationMessage, b: ConversationMessage): number {
  const t = b.createdAt.getTime() - a.createdAt.getTime()
  if (t !== 0) return t
  return a.id > b.id ? -1 : a.id < b.id ? 1 : 0
}

/** Map merged rows to DTOs, tagging each with its parent's provenance. Quinn's
 *  turns are flagged (`isAssistant`) via the shared memoized assistant id —
 *  the same resolution `listMessages` applies on the conversation side. */
async function toPairDtos(
  sourced: Array<{ row: ConversationMessage; source: PairThreadMessageSource }>
): Promise<PairThreadMessageDTO[]> {
  const [authors, assistantPrincipalId] = await Promise.all([
    loadAuthors(sourced.map((s) => s.row.principalId)),
    assistantPrincipalIdOnce(),
  ])
  return sourced.map(({ row, source }) => ({
    ...toMessageDTO(
      row,
      row.principalId ? (authors.get(row.principalId) ?? fallbackAuthor(row.principalId)) : null,
      assistantPrincipalId
    ),
    source,
  }))
}

/**
 * The pair thread of a ticket: the time-ordered union of its legacy
 * ticket-parented messages and its linked conversation's messages. Same
 * contract as the pre-convergence `listTicketMessages` (which now delegates
 * here): newest-loaded page returned oldest-first, `before` is a message-id
 * cursor, `all: true` returns the entire ordered thread (oldest-first, no page
 * window) for grounding-style callers. See the module doc for the pair rule,
 * merge contract, audience rule, and the Phase 0/1a boundary.
 */
export async function listPairThreadMessages(
  ticketId: TicketId,
  opts: { before?: string; includeInternal?: boolean; all?: boolean } = {}
): Promise<PairThreadMessagePage> {
  const includeInternal = opts.includeInternal ?? false
  const conversationId = await resolvePairConversationId(ticketId)
  const parents: PairParent[] = [
    { source: 'ticket', ticketId },
    ...(conversationId ? [{ source: 'conversation', conversationId } as PairParent] : []),
  ]

  if (opts.all) {
    const perParent = await Promise.all(
      parents.map(async (parent) =>
        (await fetchParentAll(parent, { includeInternal })).map((row) => ({
          row,
          source: parent.source,
        }))
      )
    )
    // Oldest-first across both parents (the `all` read's rendering order).
    const merged = perParent.flat().sort((a, b) => compareNewestFirst(b.row, a.row))
    return { messages: await toPairDtos(merged), hasMore: false }
  }

  const cursor = await resolvePairCursor(opts.before)
  const perParent = await Promise.all(
    parents.map(async (parent) =>
      (await fetchParentPage(parent, { includeInternal, cursor, limit: MESSAGE_PAGE_SIZE })).map(
        (row) => ({ row, source: parent.source })
      )
    )
  )
  const merged = perParent.flat().sort((a, b) => compareNewestFirst(a.row, b.row))
  // Each parent was fetched with limit+1, so overflow of the MERGED set is
  // exactly "more rows exist" (see the MERGE CONTRACT note).
  const hasMore = merged.length > MESSAGE_PAGE_SIZE
  const page = hasMore ? merged.slice(0, MESSAGE_PAGE_SIZE) : merged
  // Oldest-first for rendering; the parents pulled newest-first for the keyset.
  page.reverse()
  return { messages: await toPairDtos(page), hasMore }
}
