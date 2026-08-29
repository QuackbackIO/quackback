import { queryOptions, type QueryClient } from '@tanstack/react-query'
import {
  fetchBillingCatalogueFn,
  fetchBillingInvoicesFn,
  fetchBillingOverviewFn,
  fetchPlanUsageFn,
  fetchFreeDowngradePreviewFn,
  fetchSeatsPreviewFn,
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
  freeDowngradePreview: () =>
    queryOptions({
      queryKey: ['billing', 'free-downgrade'] as const,
      queryFn: () => fetchFreeDowngradePreviewFn(),
      staleTime: 10_000,
    }),
  seatsPreview: (quantity: number) =>
    queryOptions({
      queryKey: ['billing', 'seats-preview', quantity] as const,
      queryFn: () => fetchSeatsPreviewFn({ data: { quantity } }),
      staleTime: 10_000,
    }),
}

/**
 * Warm the advertised-plan catalogue before an upgrade surface renders.
 * Fail-open: a control-plane miss stores null so the offer still SSRs.
 */
export async function ensureBillingCatalogue(
  queryClient: QueryClient,
  billingEnabled: boolean | undefined
) {
  if (!billingEnabled) return null
  try {
    return await queryClient.ensureQueryData(billingQueries.catalogue())
  } catch {
    queryClient.setQueryData(billingQueries.catalogue().queryKey, null)
    return null
  }
}
