// @vitest-environment happy-dom
/**
 * Every admin navigation, a search-only one included (opening a post or a
 * conversation), hands the tree a fresh route context and location. The rail
 * shows none of that except which item is active, so a search-only
 * navigation renders none of it, and a navigation between pages renders only
 * the two items whose highlight moved.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Profiler, type ComponentType } from 'react'
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
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { DEFAULT_FEATURE_FLAGS, getProductFlagUpdate } from '@/lib/shared/types/settings'
import { TooltipProvider } from '@/components/ui/tooltip'

vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

// Each rail item's icon, wrapped to count the renders of the item it sits in.
const iconRenders: Record<string, number> = {}
vi.mock('@heroicons/react/24/solid', async (importOriginal) => {
  const actual = await importOriginal<Record<string, ComponentType<object>>>()
  const counted = (name: string) => {
    const Icon = actual[name]!
    return (props: object) => {
      iconRenders[name] = (iconRenders[name] ?? 0) + 1
      return <Icon {...props} />
    }
  }
  return {
    ...actual,
    ChatBubbleLeftIcon: counted('ChatBubbleLeftIcon'),
    MapIcon: counted('MapIcon'),
    UsersIcon: counted('UsersIcon'),
    ChartBarIcon: counted('ChartBarIcon'),
  }
})

let bellRenders = 0
vi.mock('@/components/notifications', () => ({
  NotificationBell: () => {
    bellRenders++
    return null
  },
}))
vi.mock('@/lib/client/auth-client', () => ({ signOut: vi.fn() }))
vi.mock('@/lib/server/functions/conversation', () => ({ setAgentAvailabilityFn: vi.fn() }))
vi.mock('@/lib/server/functions/owner-workspaces', () => ({
  listOwnerWorkspacesFn: vi.fn(async () => []),
  openOwnerWorkspaceFn: vi.fn(),
}))

const { AdminSidebar } = await import('../admin-sidebar')

afterEach(() => {
  cleanup()
  for (const key of Object.keys(iconRenders)) delete iconRenders[key]
  bellRenders = 0
})

// The root and admin beforeLoads keep one answer between navigations (their
// route-context memos), so the parts are the same objects each time while the
// route context around them is new.
const rootAnswer = {
  session: { user: { name: 'Ada', email: 'ada@example.com', image: null } },
  settings: {
    featureFlags: { ...DEFAULT_FEATURE_FLAGS, ...getProductFlagUpdate('feedback', true) },
  },
  userRole: 'admin' as const,
  billingEnabled: false,
}
let adminAnswer: { principal: { role: string }; permissions: PermissionKey[] }

let sidebarCommits = 0

function buildRouter() {
  const rootRoute = createRootRouteWithContext<object>()({
    beforeLoad: () => rootAnswer,
    component: () => <Outlet />,
  })
  const adminRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin',
    beforeLoad: () => ({ ...adminAnswer }),
    component: () => (
      <>
        <Profiler id="sidebar" onRender={() => sidebarCommits++}>
          <AdminSidebar />
        </Profiler>
        <Outlet />
      </>
    ),
  })
  const feedback = createRoute({
    getParentRoute: () => adminRoute,
    path: '/feedback',
    validateSearch: (search: Record<string, unknown>) => search as { post?: string },
    component: () => <p>feedback page</p>,
  })
  const roadmap = createRoute({
    getParentRoute: () => adminRoute,
    path: '/roadmap',
    component: () => <p>roadmap page</p>,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([adminRoute.addChildren([feedback, roadmap])]),
    history: createMemoryHistory({ initialEntries: ['/admin/feedback'] }),
    context: {},
  })
}

async function mount() {
  const router = buildRouter()
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </IntlProvider>
    </QueryClientProvider>
  )
  await screen.findByText('feedback page')
  return { router, container: view.container }
}

const activeHrefs = (container: HTMLElement) =>
  [...container.querySelectorAll('aside [data-active]')].map((a) => a.getAttribute('href'))

describe('AdminSidebar renders', () => {
  it('renders nothing for a search-only navigation', async () => {
    adminAnswer = {
      principal: { role: 'admin' },
      permissions: [PERMISSIONS.ASSISTANT_MANAGE, PERMISSIONS.WORKFLOW_MANAGE],
    }
    const { router, container } = await mount()
    expect(activeHrefs(container)).toEqual(['/admin/feedback'])
    const commits = sidebarCommits
    const bell = bellRenders

    await act(() => router.navigate({ to: '/admin/feedback', search: { post: 'post_1' } }))
    await act(() => router.navigate({ to: '/admin/feedback', search: { post: 'post_2' } }))

    expect(router.state.location.search).toEqual({ post: 'post_2' })
    expect(sidebarCommits).toBe(commits)
    expect(bellRenders).toBe(bell)
    expect(activeHrefs(container)).toEqual(['/admin/feedback'])
  })

  it('renders only the items whose highlight moved for a navigation between pages', async () => {
    adminAnswer = {
      principal: { role: 'admin' },
      permissions: [PERMISSIONS.ASSISTANT_MANAGE, PERMISSIONS.WORKFLOW_MANAGE],
    }
    const { router, container } = await mount()
    const before = { ...iconRenders }
    const bell = bellRenders

    await act(() => router.navigate({ to: '/admin/roadmap' }))
    await screen.findByText('roadmap page')

    expect(activeHrefs(container)).toEqual(['/admin/roadmap'])
    // Feedback lost the highlight and Roadmap gained it; nothing else moved.
    expect(iconRenders.ChatBubbleLeftIcon).toBe(before.ChatBubbleLeftIcon! + 1)
    expect(iconRenders.MapIcon).toBe(before.MapIcon! + 1)
    expect(iconRenders.UsersIcon).toBe(before.UsersIcon)
    expect(iconRenders.ChartBarIcon).toBe(before.ChartBarIcon)
    expect(bellRenders).toBe(bell)
  })

  it('shows and hides permission-gated items when the permissions change', async () => {
    adminAnswer = {
      principal: { role: 'member' },
      permissions: [PERMISSIONS.ASSISTANT_MANAGE],
    }
    const { router, container } = await mount()
    expect(container.querySelector('aside a[href="/admin/automation/agent"]')).toBeTruthy()

    adminAnswer = { principal: { role: 'member' }, permissions: [] }
    await act(() => router.invalidate())

    expect(container.querySelector('aside a[href="/admin/automation/agent"]')).toBeNull()
  })
})
