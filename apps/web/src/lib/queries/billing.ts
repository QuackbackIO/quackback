import { queryOptions } from '@tanstack/react-query'
import { getBillingOverviewFn, getInvoicesFn } from '@/lib/server-functions/billing'

export const billingQueries = {
  overview: () =>
    queryOptions({
      queryKey: ['billing', 'overview'],
      queryFn: () => getBillingOverviewFn(),
      staleTime: 30 * 1000, // 30 seconds - billing data changes infrequently
    }),

  invoices: (limit = 20) =>
    queryOptions({
      queryKey: ['billing', 'invoices', { limit }],
      queryFn: () => getInvoicesFn({ data: { limit } }),
      staleTime: 60 * 1000, // 1 minute - invoices are relatively static
    }),
}
