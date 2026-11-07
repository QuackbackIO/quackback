// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ReactNode } from 'react'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({
    invalidate: async () => {
      state.invalidations++
    },
  }),
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

const state = vi.hoisted(() => ({
  flags: {} as Record<string, boolean>,
  updates: [] as unknown[],
  invalidations: 0,
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({ useFeatureFlags: () => state.flags }))
vi.mock('@/lib/server/functions/feature-flags', () => ({
  updateFeatureFlagsFn: async ({ data }: { data: Record<string, boolean> }) => {
    state.updates.push(data)
    return { ...state.flags, ...data }
  },
}))

const { Route } = await import('../admin/settings.labs')

afterEach(cleanup)

type RouteOptions = {
  beforeLoad?: unknown
  loader: (ctx: { context: { permissions: string[] } }) => unknown
  component: () => ReactNode
}
const options = Route.options as unknown as RouteOptions

describe('settings labs route', () => {
  it('renders the Labs switches instead of redirecting', () => {
    expect(options.beforeLoad).toBeUndefined()
    const Page = options.component as () => ReactNode
    render(
      <IntlProvider locale="en" defaultLocale="en">
        <QueryClientProvider client={new QueryClient()}>
          <Page />
        </QueryClientProvider>
      </IntlProvider>
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Labs' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Copilot on Home' })).toBeNull()
  })

  it('switches the new portal design with its own flag', async () => {
    const Page = options.component as () => ReactNode
    render(
      <IntlProvider locale="en" defaultLocale="en">
        <QueryClientProvider client={new QueryClient()}>
          <Page />
        </QueryClientProvider>
      </IntlProvider>
    )
    const toggle = screen.getByRole('switch', { name: 'New portal design' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    await waitFor(() => expect(state.updates).toContainEqual({ portalDesignV2: true }))
  })

  it('switches refining after a brand match with its own flag, off by default', async () => {
    const Page = options.component as () => ReactNode
    render(
      <IntlProvider locale="en" defaultLocale="en">
        <QueryClientProvider client={new QueryClient()}>
          <Page />
        </QueryClientProvider>
      </IntlProvider>
    )
    expect(
      screen.getByText(
        'Quackback AI reviews the new design and keeps only changes that bring it closer to your site.'
      )
    ).toBeInTheDocument()
    const toggle = screen.getByRole('switch', { name: 'Refine after brand match' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    await waitFor(() => expect(state.updates).toContainEqual({ brandCheckLoop: true }))
  })

  it('needs the manage settings permission', () => {
    expect(() => options.loader({ context: { permissions: [] } })).toThrow()
    expect(() =>
      options.loader({ context: { permissions: [PERMISSIONS.SETTINGS_MANAGE] } })
    ).not.toThrow()
  })
})
