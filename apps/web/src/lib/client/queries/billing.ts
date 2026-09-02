import { queryOptions, type QueryClient } from '@tanstack/react-query'
import {
  fetchBillingCatalogueFn,
  fetchBillingInvoicesFn,
  fetchBillingOverviewFn,
  fetchPlanUsageFn,
  fetchFreeDowngradePreviewFn,
  fetchSeatsPreviewFn,
  fetchUpgradeContextFn,
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
  upgradeContext: () =>
    queryOptions({
      queryKey: ['billing', 'upgrade-context'] as const,
      queryFn: () => fetchUpgradeContextFn(),
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
 * Warm everything an upgrade surface reads before it renders: the advertised
 * plan catalogue and the workspace's upgrade context (current plan, trial
 * eligibility). Fail-open: a miss on either stores null so the offer still SSRs
 * with plan-only copy. Resolves to the catalogue, as before.
 */
export async function ensureBillingCatalogue(
  queryClient: QueryClient,
  billingEnabled: boolean | undefined
) {
  if (!billingEnabled) return null
  const [catalogue] = await Promise.all([
    queryClient.ensureQueryData(billingQueries.catalogue()).catch(() => {
      queryClient.setQueryData(billingQueries.catalogue().queryKey, null)
      return null
    }),
    queryClient.ensureQueryData(billingQueries.upgradeContext()).catch(() => {
      queryClient.setQueryData(billingQueries.upgradeContext().queryKey, null)
      return null
    }),
  ])
  return catalogue
}
