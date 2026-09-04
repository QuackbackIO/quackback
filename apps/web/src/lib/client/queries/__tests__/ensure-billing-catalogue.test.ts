import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

const fetchBillingCatalogueFn = vi.fn()
const fetchUpgradeContextFn = vi.fn()
vi.mock('@/lib/server/functions/billing', () => ({
  fetchBillingCatalogueFn: () => fetchBillingCatalogueFn(),
  fetchUpgradeContextFn: () => fetchUpgradeContextFn(),
  fetchBillingInvoicesFn: vi.fn(),
  fetchBillingOverviewFn: vi.fn(),
  fetchPlanUsageFn: vi.fn(),
  fetchFreeDowngradePreviewFn: vi.fn(),
  fetchDowngradePreviewFn: vi.fn(),
  fetchPendingDowngradeFn: vi.fn(),
  beginPlanDowngradeFn: vi.fn(),
  cancelPlanDowngradeFn: vi.fn(),
  shouldLockAdminToBillingFn: vi.fn(),
  fetchSeatsPreviewFn: vi.fn(),
}))

const { billingQueries, ensureBillingCatalogue } = await import('../billing')

describe('ensureBillingCatalogue', () => {
  it('does not fetch when billing is off', async () => {
    fetchBillingCatalogueFn.mockClear()
    fetchUpgradeContextFn.mockClear()
    const queryClient = new QueryClient()
    await expect(ensureBillingCatalogue(queryClient, false)).resolves.toBeNull()
    await expect(ensureBillingCatalogue(queryClient, undefined)).resolves.toBeNull()
    expect(fetchBillingCatalogueFn).not.toHaveBeenCalled()
    expect(fetchUpgradeContextFn).not.toHaveBeenCalled()
  })

  it('warms the catalogue and the upgrade context together', async () => {
    fetchBillingCatalogueFn.mockResolvedValueOnce({ version: 1, plans: [] })
    fetchUpgradeContextFn.mockResolvedValueOnce({ currentPlan: 'free' })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await expect(ensureBillingCatalogue(queryClient, true)).resolves.toEqual({
      version: 1,
      plans: [],
    })
    expect(queryClient.getQueryData(billingQueries.upgradeContext().queryKey)).toEqual({
      currentPlan: 'free',
    })
  })

  it('stores null when either fetch fails so the offer can still SSR', async () => {
    fetchBillingCatalogueFn.mockRejectedValueOnce(new Error('control plane down'))
    fetchUpgradeContextFn.mockRejectedValueOnce(new Error('settings read failed'))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await expect(ensureBillingCatalogue(queryClient, true)).resolves.toBeNull()
    expect(queryClient.getQueryData(billingQueries.catalogue().queryKey)).toBeNull()
    expect(queryClient.getQueryData(billingQueries.upgradeContext().queryKey)).toBeNull()
  })
})
