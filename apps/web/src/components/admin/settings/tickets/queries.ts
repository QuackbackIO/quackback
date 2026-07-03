import { queryOptions } from '@tanstack/react-query'
import {
  listTicketStatusesFn,
  getTicketStageLabelsFn,
  getTicketFormsFn,
} from '@/lib/server/functions/tickets'

/**
 * Shared query options for the ticket settings pages. Route loaders prefetch
 * these; the cards read them with `useSuspenseQuery` and write straight to the
 * cache after each mutation so edits show without a refetch.
 */
export const ticketStatusesQuery = queryOptions({
  queryKey: ['settings', 'ticket-statuses'],
  queryFn: () => listTicketStatusesFn(),
  staleTime: 60_000,
})

export const ticketStageLabelsQuery = queryOptions({
  queryKey: ['settings', 'ticket-stage-labels'],
  queryFn: () => getTicketStageLabelsFn(),
  staleTime: 60_000,
})

export const ticketFormsQuery = queryOptions({
  queryKey: ['settings', 'ticket-forms'],
  queryFn: () => getTicketFormsFn(),
  staleTime: 60_000,
})
