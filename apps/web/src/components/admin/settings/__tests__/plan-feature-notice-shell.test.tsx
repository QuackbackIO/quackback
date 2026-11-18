// @vitest-environment happy-dom
/**
 * The paused notice costs nothing with the plan limits flag off: it renders
 * nothing and never loads its body, so no query runs and no chunk is fetched.
 * With the flag on it loads the body.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ flags: {} as Record<string, boolean>, loaded: vi.fn() }))

vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useWorkspaceSettings: () => ({ featureFlags: h.flags }),
}))
vi.mock('../plan-feature-notice-body', () => {
  h.loaded()
  return { default: ({ feature }: { feature: string }) => <p>notice for {feature}</p> }
})

import { PlanFeatureNotice } from '../plan-feature-notice'

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
