import { queryOptions } from '@tanstack/react-query'
import { fetchBillingOverviewFn } from '@/lib/server/functions/billing'

/** Billing state projected into this workspace by the control plane. */
export const billingQueries = {
  all: ['billing'] as const,
  overview: () =>
    queryOptions({
      queryKey: ['billing', 'overview'] as const,
      queryFn: () => fetchBillingOverviewFn(),
      staleTime: 30_000,
    }),
}
