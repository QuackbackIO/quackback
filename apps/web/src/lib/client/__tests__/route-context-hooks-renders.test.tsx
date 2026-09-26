// @vitest-environment happy-dom
/**
 * The admin shell and most admin pages ask the route context about the
 * viewer's permissions and the workspace's look. The router hands the tree a
 * fresh context object on every navigation, a search-only one included, so a
 * hook that read the whole object rendered its caller again on each one. The
 * hooks answer from the parts they need, and render their caller again only
 * when that answer changes.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { usePermission } from '../hooks/use-permission'
import { useHasPermission, usePermissions } from '../use-permissions'
import { useRefinedTheme } from '../hooks/use-root-context'

afterEach(cleanup)

// What the root and admin beforeLoads hand back. Their route-context memos
// keep one answer until something expires it, so the parts are the same
// objects from one navigation to the next while the route context around
// them is new each time.
let rootAnswer: { settings: { visualTheme?: 'refined' | 'legacy' } }
let adminAnswer: { principal: { role: string }; permissions: PermissionKey[] }

const renders = { permission: 0, permissions: 0, hasPermission: 0, theme: 0 }
const seen = {
  permission: false,
  permissions: [] as PermissionKey[],
  hasPermission: false,
  refined: false,
}

function PermissionProbe() {
  renders.permission++
  seen.permission = usePermission(PERMISSIONS.ASSISTANT_MANAGE)
  return null
}

function PermissionsProbe() {
  renders.permissions++
  seen.permissions = [...usePermissions()]
  return null
}

function HasPermissionProbe() {
  renders.hasPermission++
  seen.hasPermission = useHasPermission(PERMISSIONS.WORKFLOW_MANAGE)
  return null
}

function ThemeProbe() {
  renders.theme++
  seen.refined = useRefinedTheme()
  return null
}

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
        <PermissionProbe />
        <PermissionsProbe />
        <HasPermissionProbe />
        <ThemeProbe />
        <Outlet />
      </>
    ),
  })
  const pageA = createRoute({
    getParentRoute: () => adminRoute,
    path: '/a',
    validateSearch: (search: Record<string, unknown>) => search as { i?: string },
    component: () => <p>page a</p>,
  })
  const pageB = createRoute({
    getParentRoute: () => adminRoute,
    path: '/b',
    component: () => <p>page b</p>,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([adminRoute.addChildren([pageA, pageB])]),
    history: createMemoryHistory({ initialEntries: ['/admin/a'] }),
    context: {},
  })
}

async function mount() {
  for (const key of Object.keys(renders) as (keyof typeof renders)[]) renders[key] = 0
  const router = buildRouter()
  render(<RouterProvider router={router} />)
  await screen.findByText('page a')
  return router
}

describe('route context hooks', () => {
  it('do not render their callers again for navigations that leave the answer alone', async () => {
    rootAnswer = { settings: { visualTheme: 'refined' } }
    adminAnswer = {
      principal: { role: 'member' },
      permissions: [PERMISSIONS.ASSISTANT_MANAGE, PERMISSIONS.WORKFLOW_MANAGE],
    }
    const router = await mount()
    const settled = { ...renders }

    await act(() => router.navigate({ to: '/admin/a', search: { i: 'one' } } as never))
    await act(() => router.navigate({ to: '/admin/a', search: { i: 'two' } } as never))
    await act(() => router.navigate({ to: '/admin/b' } as never))
    await screen.findByText('page b')

    expect(renders).toEqual(settled)
    expect(seen).toEqual({
      permission: true,
      permissions: [PERMISSIONS.ASSISTANT_MANAGE, PERMISSIONS.WORKFLOW_MANAGE],
      hasPermission: true,
      refined: true,
    })
  })

  it('render their callers again with the new answer when the permissions change', async () => {
    rootAnswer = { settings: { visualTheme: 'legacy' } }
    adminAnswer = {
      principal: { role: 'member' },
      permissions: [PERMISSIONS.ASSISTANT_MANAGE, PERMISSIONS.WORKFLOW_MANAGE],
    }
    const router = await mount()
    expect(seen.permission).toBe(true)
    expect(seen.hasPermission).toBe(true)
    expect(seen.refined).toBe(false)

    // A role change: the next guard answer holds a narrower set.
    adminAnswer = { principal: { role: 'member' }, permissions: [PERMISSIONS.ASSISTANT_MANAGE] }
    rootAnswer = { settings: { visualTheme: 'refined' } }
    await act(() => router.invalidate())

    expect(seen).toEqual({
      permission: true,
      permissions: [PERMISSIONS.ASSISTANT_MANAGE],
      hasPermission: false,
      refined: true,
    })
  })
})
