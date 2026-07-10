/**
 * Query-options factory for the unified inbox endpoint (UNIFIED-INBOX-SPEC.md
 * §3.1): the merged conversation+ticket list (`listInboxItemsFn`) and its
 * nav-badge counts (`fetchInboxCountsFn`). Only the scopes `usesUnifiedInboxList`
 * (inbox-scope.ts) recognizes call `itemList` — everything else keeps reading
 * `conversationInboxQueries.conversationList` from conversation-inbox.ts, which
 * this module does not touch.
 *
 * Also carries the standalone ticket-workspace query keys/options
 * (`ticketKeys`/`ticketQueries`, formerly `lib/client/queries/tickets.ts`,
 * folded in at UNIFIED-INBOX-SPEC.md M6): cache keys are unchanged so existing
 * invalidations keep matching.
 */
import { queryOptions } from '@tanstack/react-query'
import type { ConversationId, TicketId } from '@quackback/ids'
import {
  listInboxItemsFn,
  fetchInboxCountsFn,
  getConversationTicketLinkFn,
} from '@/lib/server/functions/inbox'
import {
  listTicketsFn,
  getTicketFn,
  listTicketStatusesFn,
  getTicketStageLabelsFn,
  listTicketMessagesFn,
  getTicketLinksFn,
  fetchTicketExternalLinksFn,
} from '@/lib/server/functions/tickets'
import type { TicketListFilter } from '@/lib/server/domains/tickets'
import { asAgentMessage } from '@/lib/shared/conversation/types'
import type { InboxListParams } from '@/lib/client/conversation/inbox-scope'

/** A deterministic string key for a ticket-list filter (so the query cache
 *  dedupes). Mirrors `inboxListParamsKey` for the unified list. */
export function ticketListKey(filter: TicketListFilter): string {
  return [
    filter.type ?? 'all',
    filter.statusCategory ?? 'all',
    filter.stage ?? 'all',
    filter.assignee ?? 'all',
    filter.teamId ?? '',
    filter.requesterPrincipalId ?? '',
    filter.companyId ?? '',
    filter.sort ?? 'recent',
    filter.limit ?? '',
  ].join('|')
}

export const ticketKeys = {
  /** Prefix of every ticket query (broad invalidation target). */
  all: () => ['admin', 'tickets'] as const,
  /** Prefix of every ticket-list query (all scopes/filters). */
  lists: () => [...ticketKeys.all(), 'list'] as const,
  /** One ticket list for a specific filter. */
  list: (filterKey: string) => [...ticketKeys.lists(), filterKey] as const,
  /** A single ticket's detail. */
  detail: (id: TicketId) => [...ticketKeys.all(), 'detail', id] as const,
  /** The workspace's status catalogue (drives the status picker). */
  statuses: () => [...ticketKeys.all(), 'statuses'] as const,
  /** The workspace's customer-facing stage labels. */
  stageLabels: () => [...ticketKeys.all(), 'stage-labels'] as const,
  /** A single ticket's message thread. */
  thread: (id: TicketId) => [...ticketKeys.all(), 'thread', id] as const,
  /** A single ticket's tracker links (the tracker it belongs to, or its linked tickets). */
  links: (id: TicketId) => [...ticketKeys.all(), 'links', id] as const,
  /** A single ticket's external issue links (GitHub). */
  externalLinks: (id: TicketId) => [...ticketKeys.all(), 'external-links', id] as const,
}

export const ticketQueries = {
  /** The ticket list for a scope + type/status/sort refinement. `staleTime` keeps
   *  the loader-warmed data from refetching the instant a row mounts. */
  list: (filter: TicketListFilter) =>
    queryOptions({
      queryKey: ticketKeys.list(ticketListKey(filter)),
      queryFn: () => listTicketsFn({ data: filter }),
      staleTime: 60_000,
    }),

  /** The status catalogue, ordered by category then position. */
  statuses: () =>
    queryOptions({
      queryKey: ticketKeys.statuses(),
      queryFn: () => listTicketStatusesFn(),
      staleTime: 60_000,
    }),

  /** The customer-facing stage labels (drives the status picker's stage hints). */
  stageLabels: () =>
    queryOptions({
      queryKey: ticketKeys.stageLabels(),
      queryFn: () => getTicketStageLabelsFn(),
      staleTime: 60_000,
    }),

  /** A ticket's tracker links: for a tracker, the customer tickets it tracks;
   *  for a customer ticket, the tracker it belongs to (or null). */
  links: (id: TicketId) =>
    queryOptions({
      queryKey: ticketKeys.links(id),
      queryFn: () => getTicketLinksFn({ data: { ticketId: id } }),
      staleTime: 30_000,
    }),

  /** A ticket's linked GitHub issues, plus whether the integration is connected. */
  externalLinks: (id: TicketId) =>
    queryOptions({
      queryKey: ticketKeys.externalLinks(id),
      queryFn: () => fetchTicketExternalLinksFn({ data: { ticketId: id } }),
      staleTime: 30_000,
    }),
}

export const inboxKeys = {
  /** Prefix of every unified-inbox query (broad invalidation target). */
  all: () => ['admin', 'inbox', 'unified'] as const,
  /** Prefix of every unified item-list query (all scopes/filters). */
  items: () => [...inboxKeys.all(), 'items'] as const,
  /** One item-list page for a specific filter. */
  item: (filterKey: string) => [...inboxKeys.items(), filterKey] as const,
  /** The nav-badge counts (mine/unassigned/tickets-by-type). */
  counts: () => [...inboxKeys.all(), 'counts'] as const,
}

/** A deterministic string key for a list filter (mirrors `ticketListKey`). */
function inboxListParamsKey(params: InboxListParams): string {
  return [
    params.facet,
    (params.kinds ?? []).join(','),
    params.ticketType ?? '',
    params.priority ?? '',
    params.search ?? '',
    params.assignee ?? '',
    params.teamId ?? '',
    params.companyId ?? '',
    params.sort ?? '',
  ].join('|')
}

export const inboxQueries = {
  /** The unified conversation+ticket list for a scope + facet/priority/search
   *  refinement. No cursor/pagination wiring yet — mirrors the conversation
   *  inbox's current first-page-only behavior (see the M2 report). */
  itemList: (params: InboxListParams) =>
    queryOptions({
      queryKey: inboxKeys.item(inboxListParamsKey(params)),
      queryFn: () => listInboxItemsFn({ data: params }),
    }),

  /** Nav-badge counts (mine/unassigned/tickets-by-type). */
  counts: () =>
    queryOptions({
      queryKey: inboxKeys.counts(),
      queryFn: () => fetchInboxCountsFn(),
      staleTime: 60_000,
    }),

  /** The linked customer ticket for one conversation, or null (unified inbox
   *  §M5): the unified thread header's ticket-status pill + the detail
   *  panel's Ticket card/Links section read this for a plain conversation
   *  item — the one-row rule means a conversation never shows its OWN ticket
   *  row, so this is the only way either surface learns about the link. */
  conversationTicketLink: (conversationId: ConversationId) =>
    queryOptions({
      queryKey: [...inboxKeys.all(), 'conversation-ticket-link', conversationId] as const,
      queryFn: () => getConversationTicketLinkFn({ data: { conversationId } }),
      staleTime: 30_000,
    }),

  // -------------------------------------------------------------------------
  // Ticket thread/detail (§2.5, M4): the unified thread's ticket-kind data.
  // Deliberately keyed under `ticketKeys` (defined above, not a separate
  // `inboxKeys` namespace) — the inbox route's `refreshInbox` already
  // invalidates `ticketKeys.all()`, so one invalidation keeps covering the
  // unified thread with no second cache entry to keep in sync.
  // -------------------------------------------------------------------------

  /** A ticket's message thread (oldest-first), coerced through `asAgentMessage`
   *  so the cache always holds `AgentConversationMessageDTO` regardless of
   *  whether the server response already carries reactions/flags. */
  ticketThread: (id: TicketId) =>
    queryOptions({
      queryKey: ticketKeys.thread(id),
      queryFn: async () => {
        const page = await listTicketMessagesFn({ data: { ticketId: id } })
        return { ...page, messages: page.messages.map(asAgentMessage) }
      },
      staleTime: 10_000,
    }),

  /** A single ticket's properties, for the unified thread's header controls
   *  (status/assignee/priority/type/stage) and the unified `InboxDetailPanel`. */
  ticketDetail: (id: TicketId) =>
    queryOptions({
      queryKey: ticketKeys.detail(id),
      queryFn: () => getTicketFn({ data: { ticketId: id } }),
      staleTime: 60_000,
    }),
}
