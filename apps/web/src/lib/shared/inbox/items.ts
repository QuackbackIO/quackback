/**
 * Unified inbox item model (UNIFIED-INBOX-SPEC.md §2.1). An inbox item is
 * either a conversation or a ticket — a thin discriminated union over the
 * existing per-kind DTOs, plus the "one-row rule" enrichment (a conversation
 * wearing its linked customer ticket's chip). Client-safe: types + pure
 * helpers only, no server imports, so the admin bundle can import this
 * directly.
 */
import { isValidTypeId } from '@quackback/ids'
import type { ConversationId, TicketId } from '@quackback/ids'
import type { ConversationDTO, ConversationStatus } from '@/lib/shared/conversation/types'
import type { TicketStatusCategory } from '@/lib/shared/db-types'
import type { TicketDTO } from '@/lib/server/domains/tickets/ticket.types'

// ---------------------------------------------------------------------------
// Item refs + DTOs
// ---------------------------------------------------------------------------

/** A reference to one inbox item, discriminated by kind. */
export type InboxItemRef =
  | { kind: 'conversation'; id: ConversationId }
  | { kind: 'ticket'; id: TicketId }

/** The linked customer ticket's summary, carried on a conversation item so the
 *  list row can render its chip (`#N · <status name>`) without a second fetch
 *  per row (batched in inbox.query.ts). */
export interface LinkedTicketSummary {
  id: TicketId
  number: number
  statusName: string
  statusCategory: TicketStatusCategory
}

/** The wire shape for one unified inbox row. */
export type InboxItemDTO =
  | {
      kind: 'conversation'
      conversation: ConversationDTO
      linkedTicket: LinkedTicketSummary | null
    }
  | { kind: 'ticket'; ticket: TicketDTO; unreadCount: number }

// ---------------------------------------------------------------------------
// Triage facet
// ---------------------------------------------------------------------------

/** The list's triage chips (replaces the conversation-only status chips). */
export const INBOX_TRIAGE_FACETS = ['open', 'waiting', 'closed', 'all'] as const
export type InboxTriageFacet = (typeof INBOX_TRIAGE_FACETS)[number]

export function isInboxTriageFacet(v: unknown): v is InboxTriageFacet {
  return typeof v === 'string' && (INBOX_TRIAGE_FACETS as readonly string[]).includes(v)
}

/**
 * Facet → conversation status (§2.1 table). `all` applies no status filter,
 * so it maps to `undefined` — the conversation branch simply omits `status`.
 */
export function facetToConversationStatus(facet: InboxTriageFacet): ConversationStatus | undefined {
  switch (facet) {
    case 'open':
      return 'open'
    case 'waiting':
      return 'snoozed'
    case 'closed':
      return 'closed'
    case 'all':
    default:
      return undefined
  }
}

/**
 * Facet → ticket status category (§2.1 table: the facet only reads the
 * category axis, never the per-item customizable status). `all` maps to
 * `undefined` — no category filter.
 */
export function facetToTicketStatusCategory(
  facet: InboxTriageFacet
): TicketStatusCategory | undefined {
  switch (facet) {
    case 'open':
      return 'open'
    case 'waiting':
      return 'pending'
    case 'closed':
      return 'closed'
    case 'all':
    default:
      return undefined
  }
}

// ---------------------------------------------------------------------------
// Ref resolution
// ---------------------------------------------------------------------------

/**
 * Discriminate an opaque TypeID string into an `InboxItemRef` by its prefix.
 * Returns null for anything that isn't a valid `conversation_…` or
 * `ticket_…` TypeID (e.g. an empty string, a foreign-prefix id, or a legacy
 * `c=` param value already normalized elsewhere).
 */
export function inboxItemRefFromId(id: string): InboxItemRef | null {
  if (isValidTypeId(id, 'conversation')) return { kind: 'conversation', id: id as ConversationId }
  if (isValidTypeId(id, 'ticket')) return { kind: 'ticket', id: id as TicketId }
  return null
}
