// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { DEFAULT_FEATURE_FLAGS } from '@/lib/shared/types/settings'

vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'system', setTheme: vi.fn() }) }))
vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopoverSafe: () => ({ openAuthPopover: vi.fn() }),
}))
vi.mock('@/lib/server/functions/conversation', () => ({ getMyConversationsFn: vi.fn() }))
vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({ useAuthBroadcast: () => {} }))
vi.mock('@/lib/client/auth-client', () => ({ signOut: vi.fn() }))
vi.mock('@/components/notifications', () => ({ NotificationBell: () => null }))
vi.mock('@/components/shared/user-stats', () => ({ UserStatsBar: () => null }))

const { PortalHeader } = await import('../portal-header')

afterEach(cleanup)

const LONG_NAME = '🦆 Fernhill Outdoor Supply Co. & Friends (EU/UK) Customer Success'

async function mount(orgName: string) {
  const rootRoute = createRootRouteWithContext<object>()({
    beforeLoad: () => ({
      session: null,
      settings: { featureFlags: DEFAULT_FEATURE_FLAGS },
      registeredAuthProviders: [],
    }),
    component: () => <PortalHeader orgName={orgName} userRole="user" />,
  })
  const home = createRoute({ getParentRoute: () => rootRoute, path: '/' })
  const router = createRouter({
    routeTree: rootRoute.addChildren([home]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: {},
  })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <RouterProvider router={router} />
      </IntlProvider>
    </QueryClientProvider>
  )
}

describe('PortalHeader workspace name', () => {
  it('shows a whole emoji as the avatar when the name starts with one', async () => {
    const { container } = await mount(LONG_NAME)
    await waitFor(() => expect(container.querySelector('.portal-header__logo')).not.toBeNull())
    const logo = container.querySelector('.portal-header__logo')!
    const avatar = logo.querySelector('div')!
    expect(avatar.textContent).toBe('🦆')
  })

  it('skips leading punctuation for the avatar letter', async () => {
    const { container } = await mount('!!Acme')
    await waitFor(() => expect(container.querySelector('.portal-header__logo')).not.toBeNull())
    expect(container.querySelector('.portal-header__logo div')!.textContent).toBe('A')
  })

  it('keeps a long name on one line and exposes it in full', async () => {
    await mount(LONG_NAME)
    const name = await screen.findByText(LONG_NAME)
    expect(name.getAttribute('title')).toBe(LONG_NAME)
    expect(name.textContent).toBe(LONG_NAME)
    expect(name.className).toContain('truncate')
    expect(name.className).not.toContain('line-clamp')
  })
})
