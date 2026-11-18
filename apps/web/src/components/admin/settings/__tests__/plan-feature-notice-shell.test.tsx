// @vitest-environment happy-dom
/**
 * The paused notice costs nothing with the plan limits flag off: it renders
 * nothing and never loads its body, so no query runs and no chunk is fetched.
 * With the flag on it loads the body.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const h = vi.hoisted(() => ({
  flags: {} as Record<string, boolean>,
  loaded: vi.fn(),
  getPlanLimitsFn: vi.fn(),
}))

vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useWorkspaceSettings: () => ({ featureFlags: h.flags }),
}))
vi.mock('../plan-feature-notice-body', () => {
  h.loaded()
  return { default: ({ feature }: { feature: string }) => <p>notice for {feature}</p> }
})

vi.mock('@/lib/server/functions/plan-limits', () => ({ getPlanLimitsFn: h.getPlanLimitsFn }))

import { PlanFeatureNotice, usePlanFeatureNoticeShown } from '../plan-feature-notice'

afterEach(cleanup)

describe('PlanFeatureNotice', () => {
  it('renders nothing and loads nothing with the flag off', async () => {
    h.flags = { planLimits: false }
    const { container } = render(<PlanFeatureNotice feature="workflows" />)
    await Promise.resolve()
    expect(container.innerHTML).toBe('')
    expect(h.loaded).not.toHaveBeenCalled()
  })

  it('loads the notice with the flag on', async () => {
    h.flags = { planLimits: true }
    render(<PlanFeatureNotice feature="workflows" />)
    expect(await screen.findByText('notice for workflows')).toBeTruthy()
    expect(h.loaded).toHaveBeenCalledOnce()
  })
})

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

  it('is false and asks nothing with the flag off', async () => {
    h.flags = { planLimits: false }
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
      h.flags = { planLimits: true }
      h.getPlanLimitsFn.mockReset().mockResolvedValue(state(phase, ['customDomain']))
      const { result } = shown('customDomain')
      await waitFor(() => expect(result.current).toBe(true))
    }
  )

  it('is false for a feature that is not over, and when nothing is', async () => {
    h.flags = { planLimits: true }
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
