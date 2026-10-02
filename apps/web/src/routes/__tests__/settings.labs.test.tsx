// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ReactNode } from 'react'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
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
  it('renders the page with an empty state instead of redirecting', () => {
    expect(options.beforeLoad).toBeUndefined()
    render(
      <IntlProvider locale="en" defaultLocale="en">
        <QueryClientProvider client={new QueryClient()}>{options.component()}</QueryClientProvider>
      </IntlProvider>
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Labs' })).toBeInTheDocument()
    expect(screen.getByText('No experiments right now')).toBeInTheDocument()
    expect(
      screen.getByText('Features you can try before they ship show up here.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('needs the manage settings permission', () => {
    expect(() => options.loader({ context: { permissions: [] } })).toThrow()
    expect(() =>
      options.loader({ context: { permissions: [PERMISSIONS.SETTINGS_MANAGE] } })
    ).not.toThrow()
  })
})
