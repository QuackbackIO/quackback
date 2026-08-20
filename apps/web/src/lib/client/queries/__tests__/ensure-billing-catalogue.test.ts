import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

const fetchBillingCatalogueFn = vi.fn()
vi.mock('@/lib/server/functions/billing', () => ({
  fetchBillingCatalogueFn: () => fetchBillingCatalogueFn(),
  fetchBillingInvoicesFn: vi.fn(),
  fetchBillingOverviewFn: vi.fn(),
  fetchPlanUsageFn: vi.fn(),
}))

const { billingQueries, ensureBillingCatalogue } = await import('../billing')

describe('ensureBillingCatalogue', () => {
  it('does not fetch when billing is off', async () => {
    fetchBillingCatalogueFn.mockClear()
    const queryClient = new QueryClient()
    await expect(ensureBillingCatalogue(queryClient, false)).resolves.toBeNull()
    await expect(ensureBillingCatalogue(queryClient, undefined)).resolves.toBeNull()
    expect(fetchBillingCatalogueFn).not.toHaveBeenCalled()
  })

  it('stores null when the catalogue fetch fails so the offer can still SSR', async () => {
    fetchBillingCatalogueFn.mockRejectedValueOnce(new Error('control plane down'))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await expect(ensureBillingCatalogue(queryClient, true)).resolves.toBeNull()
    expect(queryClient.getQueryData(billingQueries.catalogue().queryKey)).toBeNull()
  })
})
