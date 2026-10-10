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
  flags: { copilotHome: false } as Record<string, boolean>,
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
  it('switches Copilot on Home with the feature flag', async () => {
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
    expect(screen.getByText('Ask questions and propose changes from Home.')).toBeInTheDocument()
    const toggle = screen.getByRole('switch', { name: 'Copilot on Home' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    await waitFor(() => expect(state.updates).toEqual([{ copilotHome: true }]))
    await waitFor(() => expect(state.invalidations).toBe(1))
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  it('needs the manage settings permission', () => {
    expect(() => options.loader({ context: { permissions: [] } })).toThrow()
    expect(() =>
      options.loader({ context: { permissions: [PERMISSIONS.SETTINGS_MANAGE] } })
    ).not.toThrow()
  })
})
