import { queryOptions } from '@tanstack/react-query'
import {
  fetchBillingCatalogueFn,
  fetchBillingInvoicesFn,
  fetchBillingOverviewFn,
  fetchPlanUsageFn,
} from '@/lib/server/functions/billing'

/** Billing state and catalogue from the control plane. */
export const billingQueries = {
  all: ['billing'] as const,
  overview: () =>
    queryOptions({
      queryKey: ['billing', 'overview'] as const,
      queryFn: () => fetchBillingOverviewFn(),
      staleTime: 30_000,
    }),
  catalogue: () =>
    queryOptions({
      queryKey: ['billing', 'catalogue'] as const,
      queryFn: () => fetchBillingCatalogueFn(),
      staleTime: 60_000,
    }),
  invoices: () =>
    queryOptions({
      queryKey: ['billing', 'invoices'] as const,
      queryFn: () => fetchBillingInvoicesFn(),
      staleTime: 30_000,
    }),
  usage: () =>
    queryOptions({
      queryKey: ['billing', 'usage'] as const,
      queryFn: () => fetchPlanUsageFn(),
      staleTime: 30_000,
    }),
}
