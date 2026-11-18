// @vitest-environment happy-dom
/**
 * A settings page's paused notice costs nothing with the plan limits flag off:
 * the page renders no notice and never loads its body, so no query runs and
 * no chunk is fetched. With the flag on it loads the body. Integrations
 * stands in for the six pages; each one carries the same flag check.
 */
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({
  flags: {} as Record<string, boolean>,
  loaded: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useLoaderData: () => ({ integrationsEnabled: true }),
  }),
}))
vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: () => ({ data: [] }),
  queryOptions: (options: unknown) => options,
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useWorkspaceSettings: () => ({ featureFlags: h.flags }),
}))
vi.mock('@/components/admin/settings/settings-page', () => ({
  SettingsPage: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
}))
vi.mock('@/components/admin/settings/integrations/integrations-settings-body', () => ({
  IntegrationsSettingsBody: () => <p>integrations</p>,
}))
vi.mock('@/components/admin/settings/plan-feature-notice-body', () => {
  h.loaded()
  return { default: ({ feature }: { feature: string }) => <p>notice for {feature}</p> }
})

const { Route } = await import('../settings.integrations.index')
const Page = (Route as unknown as { options: { component: () => ReactNode } }).options.component

afterEach(cleanup)

describe('the paused notice on a settings page', () => {
  it('renders nothing and loads nothing with the flag off', async () => {
    h.flags = { planLimits: false }
    render(<Page />)
    expect(screen.getByText('integrations')).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText(/notice for/)).toBeNull()
    expect(h.loaded).not.toHaveBeenCalled()
  })

  it('loads the notice for its own feature with the flag on', async () => {
    h.flags = { planLimits: true }
    render(<Page />)
    expect(await screen.findByText('notice for integrations')).toBeTruthy()
    expect(h.loaded).toHaveBeenCalledOnce()
  })
})
