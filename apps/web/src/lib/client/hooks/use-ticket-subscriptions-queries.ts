/**
 * Ticket subscription query hooks (per-ticket subscriber list).
 * The current actor's subscription state is derived from `listTicketSubscriptionsFn`
 * by filtering on `principalId` client-side until a one-row read fn is added.
 */
import { useQuery } from '@tanstack/react-query'
import type { TicketId } from '@quackback/ids'
import { listTicketSubscriptionsFn } from '@/lib/server/functions/notifications'

export const ticketSubscriptionsKeys = {
  all: ['ticketSubscriptions'] as const,
  forTicket: (ticketId: TicketId) => [...ticketSubscriptionsKeys.all, ticketId] as const,
}

export function useTicketSubscriptions(ticketId: TicketId | null | undefined) {
  return useQuery({
    queryKey: ticketId
      ? ticketSubscriptionsKeys.forTicket(ticketId)
      : ['ticketSubscriptions', 'none'],
    queryFn: () => listTicketSubscriptionsFn({ data: { ticketId: ticketId! } }),
    enabled: !!ticketId,
    staleTime: 30_000,
  })
}
