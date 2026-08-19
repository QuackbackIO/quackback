import { queryOptions } from '@tanstack/react-query'
import { listTicketStatusesFn, getTicketStageLabelsFn } from '@/lib/server/functions/tickets'
import { listTicketTypesFn } from '@/lib/server/functions/ticket-types'

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

/**
 * The ticket-types registry (convergence Phase 4) for the settings manager:
 * live + archived rows with per-type usage counts (the manager's category-lock
 * notice). `includeArchived`/`withUsage` gate the read on `ticket.manage_types`
 * server-side, which the route loader already requires.
 */
export const ticketTypesQuery = queryOptions({
  queryKey: ['settings', 'ticket-types'],
  queryFn: () => listTicketTypesFn({ data: { includeArchived: true, withUsage: true } }),
  staleTime: 60_000,
})
