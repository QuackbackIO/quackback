// @vitest-environment happy-dom
/**
 * Every portal navigation, a search-only one included (a sort or a filter),
 * hands the tree a fresh route context and location. The header shows none of
 * that except which tab is active, so a navigation leaves the account menu,
 * the bell and the theme menu alone (rendered once, never torn down and built
 * again), and moving between pages renders only the tabs whose highlight
 * moved.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Profiler } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { DEFAULT_FEATURE_FLAGS, getProductFlagUpdate } from '@/lib/shared/types/settings'

const { counts } = vi.hoisted(() => ({ counts: { bell: 0, themeMenu: 0 } }))

vi.mock('next-themes', () => ({
  useTheme: () => {
    counts.themeMenu++
    return { theme: 'system', setTheme: vi.fn() }
  },
}))
vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopoverSafe: () => ({ openAuthPopover: vi.fn() }),
}))
vi.mock('@/lib/server/functions/conversation', () => ({ getMyConversationsFn: vi.fn() }))
vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({ useAuthBroadcast: () => {} }))
vi.mock('@/lib/client/auth-client', () => ({ signOut: vi.fn() }))
vi.mock('@/components/notifications', () => ({
  NotificationBell: () => {
    counts.bell++
    return null
  },
}))
vi.mock('@/components/shared/user-stats', () => ({ UserStatsBar: () => null }))

const { PortalHeader } = await import('../portal-header')

afterEach(() => {
  cleanup()
  counts.bell = 0
  counts.themeMenu = 0
})

// The root beforeLoad keeps one answer between navigations (its route-context
// memo), so the parts are the same objects each time while the route context
// around them is new.
const rootAnswer = {
  session: {
    user: {
      id: 'user_1',
      name: 'Ada',
      email: 'ada@example.com',
      image: null,
      principalType: 'user',
    },
  },
  settings: {
    featureFlags: {
      ...DEFAULT_FEATURE_FLAGS,
      ...getProductFlagUpdate('feedback', true),
      ...getProductFlagUpdate('changelog', true),
    },
  },
  registeredAuthProviders: [],
}

let headerCommits = 0

function buildRouter() {
  const rootRoute = createRootRouteWithContext<object>()({
    beforeLoad: () => rootAnswer,
    component: () => (
      <>
        <Profiler id="header" onRender={() => headerCommits++}>
          <PortalHeader orgName="Acme" userRole="user" />
        </Profiler>
        <Outlet />
      </>
    ),
  })
  const home = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    validateSearch: (search: Record<string, unknown>) => search as { sort?: string },
    component: () => <p>feedback page</p>,
  })
  const roadmap = createRoute({
    getParentRoute: () => rootRoute,
    path: '/roadmap',
    component: () => <p>roadmap page</p>,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([home, roadmap]),
    history: createMemoryHistory({ initialEntries: ['/?sort=top'] }),
    context: {},
  })
}

async function mount() {
  const router = buildRouter()
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <RouterProvider router={router} />
      </IntlProvider>
    </QueryClientProvider>
  )
  await screen.findByText('feedback page')
  // The theme toggle renders again once its mount effect has run; wait for
  // it, so every count starts from a settled header.
  await screen.findByRole('button', { name: 'Toggle theme' })
  return { router, container: view.container }
}

const accountMenu = () => screen.getByRole('button', { name: 'Open account menu' })
const activeTabs = (container: HTMLElement) =>
  [...container.querySelectorAll('.portal-nav__item--active')].map((a) => a.getAttribute('href'))

describe('PortalHeader renders', () => {
  it('renders nothing for a search-only navigation', async () => {
    const { router, container } = await mount()
    expect(activeTabs(container)).toEqual(['/'])
    const menu = accountMenu()
    const commits = headerCommits
    const bell = counts.bell

    await act(() => router.navigate({ to: '/', search: { sort: 'new' } }))
    await act(() => router.navigate({ to: '/', search: { sort: 'trending' } }))

    expect(router.state.location.search).toEqual({ sort: 'trending' })
    expect(headerCommits).toBe(commits)
    expect(counts.bell).toBe(bell)
    expect(accountMenu()).toBe(menu)
    expect(activeTabs(container)).toEqual(['/'])
  })

  it('keeps its menus mounted and moves the highlight between pages', async () => {
    const { router, container } = await mount()
    const menu = accountMenu()
    const bell = counts.bell
    const themeMenu = counts.themeMenu

    await act(() => router.navigate({ to: '/roadmap' }))
    await screen.findByText('roadmap page')

    expect(activeTabs(container)).toEqual(['/roadmap'])
    expect(accountMenu()).toBe(menu)
    expect(counts.bell).toBe(bell)
    expect(counts.themeMenu).toBe(themeMenu)
  })
})
