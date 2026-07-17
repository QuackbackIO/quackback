/**
 * Query-options factory for the portal Tickets surface (support platform §4.2,
 * 7C): the requester's own tickets + a ticket's thread, over the ownership-gated
 * requester server fns. Keys are stable so a reply/create mutation can invalidate.
 */
import { queryOptions } from '@tanstack/react-query'
import type { TicketId } from '@quackback/ids'
import {
  listMyTicketsFn,
  getMyTicketFn,
  getMyTicketThreadFn,
  getMyTicketWatchStatusFn,
} from '@/lib/server/functions/tickets'

export const portalTicketKeys = {
  all: () => ['portal', 'tickets'] as const,
  list: () => [...portalTicketKeys.all(), 'list'] as const,
  detail: (id: TicketId) => [...portalTicketKeys.all(), 'detail', id] as const,
  thread: (id: TicketId) => [...portalTicketKeys.all(), 'thread', id] as const,
  /** The requester's own watch status on one of their tickets (the bell toggle). */
  watch: (id: TicketId) => [...portalTicketKeys.all(), 'watch', id] as const,
}

export const portalTicketQueries = {
  /** The requester's own tickets, newest activity first. */
  list: () =>
    queryOptions({
      queryKey: portalTicketKeys.list(),
      queryFn: () => listMyTicketsFn(),
      staleTime: 30_000,
    }),

  /** One of the requester's tickets (header + status + stage). */
  detail: (id: TicketId) =>
    queryOptions({
      queryKey: portalTicketKeys.detail(id),
      queryFn: () => getMyTicketFn({ data: { ticketId: id } }),
      staleTime: 30_000,
    }),

  /** The customer-visible thread of one of the requester's tickets. */
  thread: (id: TicketId) =>
    queryOptions({
      queryKey: portalTicketKeys.thread(id),
      queryFn: () => getMyTicketThreadFn({ data: { ticketId: id } }),
      staleTime: 10_000,
    }),

  /** The requester's own watch status on one of their tickets. */
  watch: (id: TicketId) =>
    queryOptions({
      queryKey: portalTicketKeys.watch(id),
      queryFn: () => getMyTicketWatchStatusFn({ data: { ticketId: id } }),
      staleTime: 30_000,
    }),
}
