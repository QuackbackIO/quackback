// @vitest-environment happy-dom
/**
 * Every admin navigation, a search-only one included (opening a post or a
 * conversation), hands the tree new root and admin route context objects
 * while the parts inside them (the settings, the role, the viewer) stay the
 * same. Admin components read just the parts they use, so a navigation
 * renders none of them, and a settings change still reaches them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Profiler, type ReactNode } from 'react'
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

vi.mock('@/lib/client/hooks/use-activation-action', () => ({ useActivationAction: () => null }))

const { useWorkspaceHomeTitle } = await import('../admin-overview')
const { InboxEmptyState } = await import('../feedback/inbox-empty-state')
const { WhoRepliesFirstCard } = await import('../automation/who-replies-first-card')

afterEach(cleanup)

// The root and admin beforeLoads keep one answer between navigations (their
// route-context memos), so the parts are the same objects each time while the
// route context around them is new.
let rootAnswer: {
  settings: { name: string; featureFlags: { supportInbox: boolean } }
  userRole: 'admin'
}
const adminAnswer: { principal: { role: string }; permissions: PermissionKey[] } = {
  principal: { role: 'admin' },
  permissions: [PERMISSIONS.ASSISTANT_MANAGE, PERMISSIONS.WORKFLOW_MANAGE],
}

function Title() {
  return <h1>{useWorkspaceHomeTitle()}</h1>
}

const commits: Record<string, number> = {}
const counted = (id: string, children: ReactNode) => (
  <Profiler id={id} onRender={() => (commits[id] = (commits[id] ?? 0) + 1)}>
    {children}
  </Profiler>
)

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
        {counted('title', <Title />)}
        {counted('empty', <InboxEmptyState type="no-posts" />)}
        {counted('whoRepliesFirst', <WhoRepliesFirstCard />)}
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
  return createRouter({
    routeTree: rootRoute.addChildren([adminRoute.addChildren([feedback])]),
    history: createMemoryHistory({ initialEntries: ['/admin/feedback'] }),
    context: {},
  })
}

async function mount() {
  for (const key of Object.keys(commits)) delete commits[key]
  const router = buildRouter()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}}>
        <RouterProvider router={router} />
      </IntlProvider>
    </QueryClientProvider>
  )
  await screen.findByText('feedback page')
  return router
}

describe('admin route context readers', () => {
  it('render nothing for a search-only navigation', async () => {
    rootAnswer = {
      settings: { name: 'Acme', featureFlags: { supportInbox: true } },
      userRole: 'admin',
    }
    const router = await mount()
    const settled = { ...commits }

    await act(() => router.navigate({ to: '/admin/feedback', search: { post: 'post_1' } }))
    await act(() => router.navigate({ to: '/admin/feedback', search: { post: 'post_2' } }))

    expect(router.state.location.search).toEqual({ post: 'post_2' })
    expect(commits).toEqual(settled)
  })

  it('show a settings change', async () => {
    rootAnswer = {
      settings: { name: 'Acme', featureFlags: { supportInbox: true } },
      userRole: 'admin',
    }
    const router = await mount()
    expect(screen.getByRole('heading', { name: 'Acme' })).toBeTruthy()

    rootAnswer = {
      settings: { name: 'Initech', featureFlags: { supportInbox: true } },
      userRole: 'admin',
    }
    await act(() => router.invalidate())

    expect(screen.getByRole('heading', { name: 'Initech' })).toBeTruthy()
  })
})
