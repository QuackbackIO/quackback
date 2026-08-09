import { queryOptions } from '@tanstack/react-query'
import { fetchBillingOverviewFn } from '@/lib/server/functions/billing'

/**
 * Billing query options.
 *
 * `overview` resolves to `null` on any deployment with no billing provider
 * configured, so a caller never has to branch on whether the feature exists —
 * it renders nothing.
 */
export const billingQueries = {
  all: ['billing'] as const,
  overview: () =>
    queryOptions({
      queryKey: ['billing', 'overview'] as const,
      queryFn: () => fetchBillingOverviewFn(),
      // Invoices and payment methods come from the provider, so a short
      // staleness window keeps a page revisit from re-fetching them.
      staleTime: 30_000,
    }),
}
