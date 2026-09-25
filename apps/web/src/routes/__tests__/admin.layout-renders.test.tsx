// @vitest-environment happy-dom
/**
 * The admin layout (rail, banners, the entity modals' slot) wraps every admin
 * page. Every navigation hands the tree a fresh route context and location, a
 * search-only one included (opening a conversation), and the layout shows
 * none of what changed, so it renders nothing again for one; its loader's
 * answer and the viewer's permissions still reach it when they change.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import {
  Outlet,
  RouterProvider,
  type AnyRoute,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { DEFAULT_FEATURE_FLAGS } from '@/lib/shared/types/settings'

vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

const shell = vi.hoisted(() => ({
  sidebarRenders: 0,
  widgetRenders: 0,
  avatarUrl: 'https://cdn.example.com/a.png',
  sidebarAvatar: null as string | null,
  guard: null as null | {
    user: { id: string; name: string; email: string; image: null }
    principal: { id: string; role: string; chatAvailability: 'online' }
    permissions: string[]
  },
}))

vi.mock('@/components/admin/admin-sidebar', () => ({
  AdminSidebar: ({ initialUserData }: { initialUserData?: { avatarUrl: string | null } }) => {
    shell.sidebarRenders++
    shell.sidebarAvatar = initialUserData?.avatarUrl ?? null
    return null
  },
}))
vi.mock('@/components/shared/cloud-quackback-widget', () => ({
  CloudQuackbackWidget: () => {
    shell.widgetRenders++
    return null
  },
}))
vi.mock('@/lib/client/hooks/use-admin-presence', () => ({ useAdminPresence: () => {} }))
vi.mock('@/lib/server/functions/workspace-utils', () => ({
  requireWorkspaceRole: async () => shell.guard,
}))
vi.mock('@/lib/server/functions/portal', () => ({
  fetchUserAvatar: async () => ({ avatarUrl: shell.avatarUrl }),
}))
vi.mock('@/lib/server/functions/version', () => ({
  getLatestVersion: async () => null,
  isNewerVersion: () => false,
}))
vi.mock('@/lib/server/functions/plan-notice', () => ({ getPlanNotice: async () => null }))

const { Route: AdminRouteImport } = await import('../admin')
const { expireRouteContext } = await import('@/lib/client/route-context-memo')

afterEach(() => {
  cleanup()
  expireRouteContext()
})

const rootAnswer = {
  settings: { featureFlags: { ...DEFAULT_FEATURE_FLAGS, supportInbox: true } },
  acceptLanguageLocale: 'en',
}

function grant(permissions: PermissionKey[]) {
  shell.guard = {
    user: { id: 'user_1', name: 'Ada', email: 'ada@example.com', image: null },
    principal: { id: 'principal_1', role: 'member', chatAvailability: 'online' },
    permissions,
  }
}

function buildRouter() {
  const rootRoute = createRootRouteWithContext<object>()({
    beforeLoad: () => rootAnswer,
    component: () => <Outlet />,
  })
  // The real admin route, mounted under a stand-in root as the route tree does.
  const adminRoute = AdminRouteImport.update({
    id: '/admin',
    path: '/admin',
    getParentRoute: () => rootRoute,
  } as never) as unknown as AnyRoute
  const inbox = createRoute({
    getParentRoute: () => adminRoute,
    path: '/inbox',
    validateSearch: (search: Record<string, unknown>) => search as { i?: string },
    component: () => <p>inbox page</p>,
  })
  const roadmap = createRoute({
    getParentRoute: () => adminRoute,
    path: '/roadmap',
    component: () => <p>roadmap page</p>,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([adminRoute.addChildren([inbox, roadmap])]),
    history: createMemoryHistory({ initialEntries: ['/admin/inbox'] }),
    context: {},
  })
}

async function mount() {
  shell.sidebarRenders = 0
  shell.widgetRenders = 0
  const router = buildRouter()
  render(<RouterProvider router={router as never} />)
  await screen.findByText('inbox page')
  return router
}

describe('admin layout renders', () => {
  it('renders nothing again for a search-only navigation or a navigation between pages', async () => {
    grant([PERMISSIONS.CHANGELOG_VIEW_DRAFT])
    const router = await mount()
    const settled = { sidebar: shell.sidebarRenders, widget: shell.widgetRenders }

    await act(() => router.navigate({ to: '/admin/inbox', search: { i: 'one' } } as never))
    await act(() => router.navigate({ to: '/admin/inbox', search: { i: 'two' } } as never))
    await act(() => router.navigate({ to: '/admin/roadmap' } as never))
    await screen.findByText('roadmap page')

    expect({ sidebar: shell.sidebarRenders, widget: shell.widgetRenders }).toEqual(settled)
  })

  it('still hands the rail what its loader answers after a refresh', async () => {
    grant([PERMISSIONS.CHANGELOG_VIEW_DRAFT])
    shell.avatarUrl = 'https://cdn.example.com/a.png'
    const router = await mount()
    expect(shell.sidebarAvatar).toBe('https://cdn.example.com/a.png')

    shell.avatarUrl = 'https://cdn.example.com/b.png'
    await act(() => router.invalidate())

    expect(shell.sidebarAvatar).toBe('https://cdn.example.com/b.png')
  })
})
