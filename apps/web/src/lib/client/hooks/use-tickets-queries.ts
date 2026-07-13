/**
 * Tickets query hooks. Mutations live in the corresponding components and
 * call the server-fns directly with `useMutation` to keep payload typing tight.
 */
import { useQuery } from '@tanstack/react-query'
import type { TicketId } from '@quackback/ids'
import {
  listTicketsFn,
  getTicketFn,
  listThreadsFn,
  listSharesFn,
  listParticipantsFn,
  listTicketStatusesFn,
} from '@/lib/server/functions/tickets'

export const ticketsKeys = {
  all: ['tickets'] as const,
  lists: () => [...ticketsKeys.all, 'list'] as const,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  list: (filters: Record<string, any>) => [...ticketsKeys.lists(), filters] as const,
  detail: (id: TicketId) => [...ticketsKeys.all, 'detail', id] as const,
  threads: (id: TicketId) => [...ticketsKeys.all, 'threads', id] as const,
  shares: (id: TicketId) => [...ticketsKeys.all, 'shares', id] as const,
  participants: (id: TicketId) => [...ticketsKeys.all, 'participants', id] as const,
  statuses: () => [...ticketsKeys.all, 'statuses'] as const,
}

export type TicketScope =
  | 'all'
  | 'my_assigned'
  | 'my_team'
  | 'shared_with_me'
  | 'unassigned'
  | 'my_inbox'
  | 'inbox'

export interface TicketListFilters {
  scope: TicketScope
  statusCategory?: 'open' | 'pending' | 'on_hold' | 'solved' | 'closed'
  search?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any
}

export function useTickets(
  filters: TicketListFilters,
  options: { enabled?: boolean; refetchInterval?: number } = {}
) {
  return useQuery({
    queryKey: ticketsKeys.list(filters),
    queryFn: () => listTicketsFn({ data: filters }),
    enabled: options.enabled ?? true,
    staleTime: 10_000,
    refetchInterval: options.refetchInterval ?? 15_000,
  })
}

export function useTicket(ticketId: TicketId | null | undefined) {
  return useQuery({
    queryKey: ticketId ? ticketsKeys.detail(ticketId) : ['tickets', 'detail', 'none'],
    queryFn: () => getTicketFn({ data: { ticketId: ticketId! } }),
    enabled: !!ticketId,
    staleTime: 10_000,
    refetchInterval: 15_000,
  })
}

export function useTicketThreads(ticketId: TicketId | null | undefined) {
  return useQuery({
    queryKey: ticketId ? ticketsKeys.threads(ticketId) : ['tickets', 'threads', 'none'],
    queryFn: () => listThreadsFn({ data: { ticketId: ticketId! } }),
    enabled: !!ticketId,
    staleTime: 10_000,
    refetchInterval: 15_000,
  })
}

export function useTicketShares(ticketId: TicketId | null | undefined) {
  return useQuery({
    queryKey: ticketId ? ticketsKeys.shares(ticketId) : ['tickets', 'shares', 'none'],
    queryFn: () => listSharesFn({ data: { ticketId: ticketId! } }),
    enabled: !!ticketId,
    staleTime: 30_000,
  })
}

export function useTicketParticipants(ticketId: TicketId | null | undefined) {
  return useQuery({
    queryKey: ticketId ? ticketsKeys.participants(ticketId) : ['tickets', 'participants', 'none'],
    queryFn: () => listParticipantsFn({ data: { ticketId: ticketId! } }),
    enabled: !!ticketId,
    staleTime: 30_000,
  })
}

export function useTicketStatuses(enabled = true) {
  return useQuery({
    queryKey: ticketsKeys.statuses(),
    queryFn: () => listTicketStatusesFn(),
    enabled,
    staleTime: 5 * 60_000,
  })
}
