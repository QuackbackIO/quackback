/**
 * Query-options factory for the unified inbox endpoint (UNIFIED-INBOX-SPEC.md
 * §3.1): the merged conversation+ticket list (`listInboxItemsFn`) and its
 * nav-badge counts (`fetchInboxCountsFn`). Only the scopes `usesUnifiedInboxList`
 * (inbox-scope.ts) recognizes call `itemList` — everything else keeps reading
 * `conversationInboxQueries.conversationList` from conversation-inbox.ts, which
 * this module does not touch.
 */
import { queryOptions } from '@tanstack/react-query'
import { listInboxItemsFn, fetchInboxCountsFn } from '@/lib/server/functions/inbox'
import type { InboxListParams } from '@/lib/client/conversation/inbox-scope'

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
}
