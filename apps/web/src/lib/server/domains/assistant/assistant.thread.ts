/**
 * Rows-to-turns mapper for the Quinn messenger wiring: conversation message DTOs
 * become the `AssistantThreadMessage[]` the runtime reasons over. Kept as a pure
 * mapper (unit-tested) plus a thin read-only loader over the shared
 * `listMessages` read.
 *
 * Sender mapping:
 *   - a 'visitor' message           → 'customer'
 *   - an 'agent' message by Quinn    → 'assistant' (matched on the service
 *                                      principal id)
 *   - an 'agent' message by anyone   → 'human_agent'
 * System notices and text-less messages are not turns and are skipped; internal
 * notes and soft-deleted rows are filtered in SQL, so they never reach the
 * mapper (and no longer consume window slots).
 */
import type { PrincipalId, ConversationId, TicketId } from '@quackback/ids'
import {
  db,
  conversations,
  conversationMessages,
  tickets,
  ticketStatuses,
  eq,
  and,
  or,
  isNull,
  desc,
} from '@/lib/server/db'
import {
  listMessages,
  listConversationMessagesForGrounding,
} from '@/lib/server/domains/conversation/conversation.query'
import { resolvePairConversationId } from '@/lib/server/domains/tickets/pair-thread.service'
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'
import type { AssistantThreadMessage } from './assistant.runtime'

/** Newest recent turns to hand the model — enough context without unbounded prompt growth. */
export const ASSISTANT_THREAD_WINDOW = 40

/** Map conversation-message DTOs (oldest-first) to assistant thread turns. */
export function mapRowsToThreadMessages(
  messages: ConversationMessageDTO[],
  assistantPrincipalId: PrincipalId
): AssistantThreadMessage[] {
  const out: AssistantThreadMessage[] = []
  for (const m of messages) {
    // System notices are status records, not turns.
    if (m.senderType === 'system') continue
    const content = m.content?.trim()
    // Image/embed-only messages carry no text for the model to reason over.
    if (!content) continue
    if (m.senderType === 'visitor') {
      out.push({ sender: 'customer', content })
    } else {
      out.push({
        sender: m.author?.principalId === assistantPrincipalId ? 'assistant' : 'human_agent',
        content,
      })
    }
  }
  return out
}

/**
 * Load a conversation's recent thread (oldest-first) as message DTOs. Internal
 * notes are excluded in SQL by default (`includeInternal: false`), so the window
 * is spent only on customer-visible turns — the byte-identical default every
 * existing caller (the summary paths, attribute classification, the
 * orchestrator) relies on. The copilot grounding block opts into
 * `includeInternal: true` so Quinn can see a teammate's notes on the open thread
 * (D1); no other caller passes it, and no non-team surface ever should. The
 * caller pairs these with the assistant principal id through
 * `mapRowsToThreadMessages` — the raw read is principal-independent, so it can
 * run in parallel with the principal lookup.
 *
 * `all: true` bypasses the newest-`ASSISTANT_THREAD_WINDOW` window and loads the
 * whole thread (oldest-first), for the copilot grounding block whose
 * `budgetTranscript` needs the thread head as well as its tail; the windowed
 * default would drop the customer's original request on a long conversation.
 * `limit` is ignored when `all` is set.
 */
export async function loadConversationThread(
  conversationId: ConversationId,
  opts: { limit?: number; includeInternal?: boolean; all?: boolean } = {}
): Promise<ConversationMessageDTO[]> {
  if (opts.all) {
    return listConversationMessagesForGrounding(conversationId, {
      includeInternal: opts.includeInternal ?? false,
    })
  }
  const { messages } = await listMessages(conversationId, {
    includeInternal: opts.includeInternal ?? false,
    limit: opts.limit ?? ASSISTANT_THREAD_WINDOW,
  })
  return messages
}

/**
 * What a pre-turn gate needs to know about a conversation/ticket without
 * loading its thread (see `loadAssistantItemState`).
 */
export interface AssistantItemState {
  /**
   * Whether the item is closed: `conversations.status === 'closed'`, or the
   * ticket's status rolls up to the `'closed'` category (the coarse axis of
   * the two-axis ticket status model — see `ticketStatuses.category`).
   */
  closed: boolean
  /**
   * The item's latest customer-authored message id, or null when the item has
   * none: the newest `senderType: 'visitor'` row that is neither an internal
   * note nor soft-deleted, by (createdAt, id). For a ticket item this reads
   * the pair UNION (both parents when the ticket is conversation-linked) —
   * matching the union thread the client rendered and the orchestrator's own
   * union-loaded ticket grounding (assistant.runtime.ts). These filter
   * semantics are deliberately identical to the orchestrator's in-memory
   * equivalent over its already-loaded thread rows (assistant.orchestrator.ts,
   * the `latestCustomerMessageId` fold: `loadConversationThread` excludes
   * internal/deleted rows in SQL, then it takes the last 'visitor' row) —
   * change one and you must change the other.
   */
  latestCustomerMessageId: string | null
}

/**
 * Targeted pre-turn read for the suggest route's gates (staleness + closed
 * state), replacing a full thread load (messages + authors + attachments)
 * that was consumed for a single id — `runAssistantTurn` re-loads the thread
 * itself as grounding, so anything read here beyond these two facts is paid
 * for twice. Exactly one of `conversationId`/`ticketId` must be set (the
 * route's item ref guarantees it). Returns null when the item row does not
 * exist — defensive only; callers run behind an item-viewability gate.
 */
export async function loadAssistantItemState(
  conversationId: ConversationId | null,
  ticketId: TicketId | null
): Promise<AssistantItemState | null> {
  // CONVERGENCE PHASE 3: a ticket item that is conversation-linked shares ONE
  // thread with its pair, and the newest customer message can hang off EITHER
  // parent (post-1a requester replies land on the conversation). The staleness
  // id must be the union's latest — a ticket-parent-only read disagrees with
  // the union thread the client rendered (and with the orchestrator's own
  // union-loaded fold) and false-409s every suggest on a pair. An unlinked
  // ticket degenerates to the ticket parent alone.
  const pairConversationId = ticketId ? await resolvePairConversationId(ticketId) : null
  const latestCustomerMessageQuery = db
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .where(
      and(
        conversationId
          ? eq(conversationMessages.conversationId, conversationId)
          : pairConversationId
            ? or(
                eq(conversationMessages.ticketId, ticketId as TicketId),
                eq(conversationMessages.conversationId, pairConversationId)
              )
            : eq(conversationMessages.ticketId, ticketId as TicketId),
        eq(conversationMessages.senderType, 'visitor'),
        eq(conversationMessages.isInternal, false),
        isNull(conversationMessages.deletedAt)
      )
    )
    .orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.id))
    .limit(1)

  // Both branches project the one closed-determining value onto the same
  // `state` key: the conversation's own status, or the ticket status row's
  // coarse category.
  const closedQuery = conversationId
    ? db
        .select({ state: conversations.status })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1)
    : db
        .select({ state: ticketStatuses.category })
        .from(tickets)
        .innerJoin(ticketStatuses, eq(ticketStatuses.id, tickets.statusId))
        .where(and(eq(tickets.id, ticketId as TicketId), isNull(tickets.deletedAt)))
        .limit(1)

  const [[itemRow], [messageRow]] = await Promise.all([closedQuery, latestCustomerMessageQuery])
  if (!itemRow) return null
  return { closed: itemRow.state === 'closed', latestCustomerMessageId: messageRow?.id ?? null }
}
