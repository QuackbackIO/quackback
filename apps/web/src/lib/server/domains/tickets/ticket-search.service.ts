/**
 * Ticket full-text search (support platform §4.2, "one primitive, every
 * surface"). One `searchTickets(actor, {query, audience})` over the ticket title
 * and its messages' generated `search_vector` (0151), consumed by the portal, the
 * admin, and later the REST/MCP/Quinn surfaces. Audience scoping lives IN the
 * primitive: an agent sees per `ticketFilter`; a requester sees only their own
 * customer tickets, and only customer-visible (non-internal) message matches.
 */
import {
  db,
  tickets,
  conversationMessages,
  ticketConversations,
  sql,
  and,
  eq,
  isNull,
  inArray,
  type Ticket,
} from '@/lib/server/db'
import type { SQL } from 'drizzle-orm'
import type { Actor } from '@/lib/server/policy/types'
import type { TicketId } from '@quackback/ids'
import { ticketFilter } from '@/lib/server/policy/tickets'
import { buildTicketContext, ticketToDTO } from './ticket.dto'
import type { TicketDTO } from './ticket.types'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 50
const HEADLINE_OPTS = 'StartSel=<mark>, StopSel=</mark>, MaxWords=24, MinWords=6'

export interface TicketSearchResult {
  ticket: TicketDTO
  /** A ts_headline snippet of the best-matching message (or the title), with the
   *  matched terms wrapped in <mark>…</mark>. Safe to render as highlighted text. */
  snippet: string
}

export interface SearchTicketsOptions {
  query: string
  /** 'agent' scopes by ticketFilter; 'requester' scopes to the actor's own
   *  customer tickets and strips internal-note matches. */
  audience: 'agent' | 'requester'
  limit?: number
}

/**
 * The `websearch_to_tsquery` + title/message match predicate shared by every
 * ticket FTS entry point: this primitive's `searchTickets`, and the ticket
 * list's `search` filter (`ticket.service.ts` `listTickets`). Audience scoping
 * beyond the internal-note strip (e.g. restricting to the requester's own
 * tickets) is the caller's concern — see `audienceScope` below.
 *
 * CONVERGENCE PHASE 0: a message matches when it hangs off the ticket directly
 * OR off the conversation the ticket is paired with (1:1 on the customer side,
 * 0150 + 0214) — the FTS twin of the pair-thread union read. The internal-note
 * strip applies to both parents alike (one table, one is_internal column).
 */
export function ticketFtsMatch(
  query: string,
  opts: { stripInternal: boolean } = { stripInternal: false }
): { tsq: SQL; condition: SQL } {
  const tsq = sql`websearch_to_tsquery('english', ${query})`
  // A message match must respect the internal-note strip for a requester.
  const msgMatch = sql`EXISTS (
    SELECT 1 FROM conversation_messages cm
    WHERE cm.deleted_at IS NULL
      AND (cm.ticket_id = ${tickets.id} OR cm.conversation_id IN (
        SELECT tc.conversation_id FROM ticket_conversations tc
        WHERE tc.ticket_id = ${tickets.id} AND tc.ticket_type = 'customer'
      ))
      AND cm.search_vector @@ ${tsq} ${opts.stripInternal ? sql`AND cm.is_internal = false` : sql``}
  )`
  const titleMatch = sql`to_tsvector('english', ${tickets.title}) @@ ${tsq}`
  return { tsq, condition: sql`(${titleMatch} OR ${msgMatch})` }
}

export async function searchTickets(
  actor: Actor,
  opts: SearchTicketsOptions
): Promise<TicketSearchResult[]> {
  const q = opts.query.trim()
  if (!q) return []
  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
  const requester = opts.audience === 'requester'

  const { tsq, condition: match } = ticketFtsMatch(q, { stripInternal: requester })
  const titleRank = sql<number>`ts_rank(to_tsvector('english', ${tickets.title}), ${tsq})`
  // Best message rank across BOTH parents of the pair (see ticketFtsMatch).
  const bestMsgRank = sql<number>`coalesce((
    SELECT max(ts_rank(cm.search_vector, ${tsq}))
    FROM conversation_messages cm
    WHERE cm.deleted_at IS NULL
      AND (cm.ticket_id = ${tickets.id} OR cm.conversation_id IN (
        SELECT tc.conversation_id FROM ticket_conversations tc
        WHERE tc.ticket_id = ${tickets.id} AND tc.ticket_type = 'customer'
      ))
      AND cm.search_vector @@ ${tsq} ${requester ? sql`AND cm.is_internal = false` : sql``}
  ), 0)`
  const rank = sql<number>`greatest(${titleRank}, ${bestMsgRank})`

  const audienceScope: SQL = requester
    ? and(
        eq(tickets.type, 'customer'),
        actor.principalId ? eq(tickets.requesterPrincipalId, actor.principalId) : sql`false`,
        isNull(tickets.deletedAt)
      )!
    : ticketFilter(actor)

  // Step 1: the matching tickets, ranked (title OR any visible message).
  const rows = await db
    .select({ row: tickets })
    .from(tickets)
    .where(and(audienceScope, match))
    .orderBy(sql`${rank} DESC`, tickets.id)
    .limit(limit)
  if (rows.length === 0) return []

  const ticketRows = rows.map((r) => r.row as Ticket)
  const ids = ticketRows.map((r) => r.id as TicketId)

  // Step 2: the best-matching message snippet per ticket (distinct-on the
  // ticket). CONVERGENCE PHASE 0: a message's pair parent is its own
  // ticket_id when ticket-parented, else the CUSTOMER ticket linked to its
  // conversation (at most one per conversation — 0150 — so the LEFT JOIN
  // cannot fan out). The coalesce stays inside the JOIN condition so the
  // SELECT/filter/distinct-on all run over the mapped `tickets.id` column —
  // binding branded typeids against a raw coalesce expression would bypass
  // drizzle's typeid<->uuid mapping. A conversation row with no linked ticket
  // coalesces to NULL and the inner join drops it.
  const pairTicketId = sql`coalesce(${conversationMessages.ticketId}, ${ticketConversations.ticketId})`
  const snippetRows = await db
    .selectDistinctOn([tickets.id], {
      ticketId: tickets.id,
      snippet: sql<string>`ts_headline('english', ${conversationMessages.content}, ${tsq}, ${HEADLINE_OPTS})`,
    })
    .from(conversationMessages)
    .leftJoin(
      ticketConversations,
      and(
        eq(ticketConversations.conversationId, conversationMessages.conversationId),
        eq(ticketConversations.ticketType, 'customer')
      )
    )
    .innerJoin(tickets, eq(tickets.id, pairTicketId))
    .where(
      and(
        inArray(tickets.id, ids),
        isNull(conversationMessages.deletedAt),
        sql`${conversationMessages.searchVector} @@ ${tsq}`,
        requester ? eq(conversationMessages.isInternal, false) : undefined
      )
    )
    .orderBy(tickets.id, sql`ts_rank(${conversationMessages.searchVector}, ${tsq}) DESC`)
  const snippetByTicket = new Map(snippetRows.map((s) => [s.ticketId, s.snippet]))

  const ctx = await buildTicketContext(ticketRows)
  return ticketRows.map((row) => ({
    ticket: ticketToDTO(row, ctx),
    // Fall back to the title for a title-only match (no message matched).
    snippet: snippetByTicket.get(row.id) ?? row.title,
  }))
}
