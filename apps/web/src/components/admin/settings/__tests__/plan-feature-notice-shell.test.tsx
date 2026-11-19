// @vitest-environment happy-dom
/**
 * Whether a page carries the paused notice costs nothing on an install
 * without plan billing: no query runs. With plan billing on it shares the
 * notice's query.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const h = vi.hoisted(() => ({
  planBilling: false,
  getPlanLimitsFn: vi.fn(),
}))

vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useCloudEnabled: () => h.planBilling,
}))
vi.mock('@/lib/server/functions/plan-limits', () => ({ getPlanLimitsFn: h.getPlanLimitsFn }))

import { usePlanFeatureNoticeShown } from '../plan-feature-notice'

afterEach(cleanup)

describe('usePlanFeatureNoticeShown', () => {
  const state = (phase: string, keys: string[]) => ({
    enabled: true,
    phase,
    planName: 'Free',
    graceEndsAt: '2026-11-25T12:00:00.000Z',
    deadlineDay: '2026-11-24',
    featureIssues: keys.map((key) => ({ key })),
    canManageBilling: true,
  })
  function shown(feature: 'customDomain' | 'customCss') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    return { client, ...renderHook(() => usePlanFeatureNoticeShown(feature), { wrapper }) }
  }

  it('is false and asks nothing without plan billing', async () => {
    h.planBilling = false
    h.getPlanLimitsFn.mockReset()
    const { result, client } = shown('customDomain')
    // No fetch starts at all, and none lands after the query's own import.
    expect(client.isFetching()).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(result.current).toBe(false)
    expect(h.getPlanLimitsFn).not.toHaveBeenCalled()
  })

  it.each(['grace', 'enforced'])(
    'is true for a feature set up past the plan (%s)',
    async (phase) => {
      h.planBilling = true
      h.getPlanLimitsFn.mockReset().mockResolvedValue(state(phase, ['customDomain']))
      const { result } = shown('customDomain')
      await waitFor(() => expect(result.current).toBe(true))
    }
  )

  it('is false for a feature that is not over, and when nothing is', async () => {
    h.planBilling = true
    h.getPlanLimitsFn.mockReset().mockResolvedValue(state('grace', ['customDomain']))
    const css = shown('customCss')
    await waitFor(() => expect(h.getPlanLimitsFn).toHaveBeenCalled())
    expect(css.result.current).toBe(false)
    h.getPlanLimitsFn.mockReset().mockResolvedValue(state('ok', ['customDomain']))
    const ok = shown('customDomain')
    await waitFor(() => expect(h.getPlanLimitsFn).toHaveBeenCalled())
    await Promise.resolve()
    expect(ok.result.current).toBe(false)
  })
})
