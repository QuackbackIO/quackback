/**
 * The customer ticket types and their customer-visible fields, read through
 * the visitor surface (portal or widget). One query definition for every
 * reader of the shared cache entry (the ticket form block and the ticket
 * header card), so they cannot disagree on its fetcher or retry rules.
 */
import { queryOptions } from '@tanstack/react-query'
import type { VisitorSurfaceRpc } from '@/lib/client/visitor-surface-rpc'

export function ticketIntakeFormQuery(
  rpc: VisitorSurfaceRpc,
  getAuthHeaders: () => Record<string, string>
) {
  return queryOptions({
    queryKey: ['ticket-intake-form'] as const,
    queryFn: () => rpc.getMyTicketForm({ headers: getAuthHeaders() }),
    staleTime: 300_000,
  })
}
