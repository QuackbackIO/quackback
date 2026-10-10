// @vitest-environment happy-dom
/**
 * The public status page's past-incidents section and its gated-page state.
 *
 * - A quiet fortnight says so ("No incidents in the last 14 days") rather
 *   than rendering nothing.
 * - "Incident history" continues after the recent window (the page passes
 *   the window's start), and says when there is nothing older.
 * - A page published for signed-in visitors offers a signed-out visitor a
 *   way in, instead of only "not available".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const ctx = vi.hoisted(() => ({
  session: null as null | { user: { principalType: string } },
  settings: {
    featureFlags: { statusPage: true },
    statusConfig: { enabled: true, audience: 'public', pageDescription: null },
  } as Record<string, unknown>,
  openAuthPopover: vi.fn(),
  getStatusPageFn: vi.fn(),
  listStatusHistoryFn: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    <T extends object>(options: T) => ({ ...options, options }),
  notFound: () => new Error('not found'),
  useRouteContext: (opts?: { select?: (context: never) => unknown }) =>
    opts?.select ? opts.select(ctx as never) : ctx,
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopoverSafe: () => ({ openAuthPopover: ctx.openAuthPopover }),
}))
vi.mock('@/lib/server/functions/public-cache', () => ({
  setPublicDocumentCacheHeaders: vi.fn(),
}))
vi.mock('@/lib/server/functions/status', () => ({
  getStatusPageFn: ctx.getStatusPageFn,
  listStatusHistoryFn: ctx.listStatusHistoryFn,
}))
vi.mock('@/lib/server/functions/status-subscriptions', () => ({
  getMyStatusSubscriptionFn: vi.fn(),
  subscribeStatusFn: vi.fn(),
  unsubscribeStatusFn: vi.fn(),
}))

const { Route } = await import('../status.index')
const options = Route as unknown as {
  component: React.ComponentType
  notFoundComponent: React.ComponentType
}

const WINDOW_START = '2026-09-26T12:00:00.000Z'

function pageData(recentIncidents: unknown[] = []) {
  return {
    snapshot: {
      topLevel: {
        status: 'operational',
        worstComponentStatus: 'operational',
        activeIncidentCount: 0,
      },
      groups: [],
      ungroupedComponents: [],
      activeIncidents: [],
      upcomingMaintenance: [],
      recentIncidents,
      recentWindow: { start: WINDOW_START, days: 14 },
    },
    settings: { pageDescription: null, audience: 'public' },
    uptime: [],
  }
}

function renderWith(Component: React.ComponentType) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" defaultLocale="en">
        <Component />
      </IntlProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  ctx.session = null
  ctx.settings = {
    featureFlags: { statusPage: true },
    statusConfig: { enabled: true, audience: 'public', pageDescription: null },
  }
  ctx.openAuthPopover.mockReset()
  ctx.getStatusPageFn.mockReset().mockResolvedValue(pageData())
  ctx.listStatusHistoryFn
    .mockReset()
    .mockResolvedValue({ items: [], nextCursor: null, hasMore: false })
})
afterEach(cleanup)

describe('past incidents', () => {
  it('says the recent window was quiet instead of showing nothing', async () => {
    renderWith(options.component)
    expect(await screen.findByText('No incidents in the last 14 days.')).toBeInTheDocument()
  })

  it('continues history after the recent window, and says when there is nothing older', async () => {
    renderWith(options.component)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Incident history →' }))
    expect(await screen.findByText('No earlier incidents.')).toBeInTheDocument()
    expect(ctx.listStatusHistoryFn).toHaveBeenCalledWith({
      data: { cursor: undefined, limit: 20, before: WINDOW_START },
    })
  })
})

describe('a page the visitor cannot see', () => {
  it('offers sign-in when the page is for signed-in visitors and this one is signed out', async () => {
    ctx.settings = {
      featureFlags: { statusPage: true },
      statusConfig: { enabled: true, audience: 'authenticated', pageDescription: null },
    }
    window.history.replaceState(null, '', '/status')
    renderWith(options.notFoundComponent)
    expect(screen.getByRole('heading', { name: 'Sign in to view status' })).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }))
    expect(ctx.openAuthPopover).toHaveBeenCalledWith({ mode: 'login', callbackUrl: '/status' })
  })

  it('stays "not available" when signing in would not help', () => {
    // Public audience: the page is unpublished or gone, not gated.
    renderWith(options.notFoundComponent)
    expect(screen.getByRole('heading', { name: 'Status page not available' })).toBeInTheDocument()
    cleanup()

    // Already signed in: signing in again changes nothing.
    ctx.settings = {
      featureFlags: { statusPage: true },
      statusConfig: { enabled: true, audience: 'authenticated', pageDescription: null },
    }
    ctx.session = { user: { principalType: 'user' } }
    renderWith(options.notFoundComponent)
    expect(screen.getByRole('heading', { name: 'Status page not available' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
  })
})
