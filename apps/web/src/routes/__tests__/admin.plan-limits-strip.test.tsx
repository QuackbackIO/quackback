// @vitest-environment happy-dom
/**
 * The plan limits banner sits over every admin page, for every teammate, in
 * the slot the ended-trial strip uses, and stands in for that strip while the
 * workspace is over its plan. The sidebar gets the same state. Both follow
 * the live summary: once the workspace fits again (an upgrade, or the last
 * fix), the banner goes without a reload.
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  Outlet,
  RouterProvider,
  type AnyRoute,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { SYSTEM_ROLE_PERMISSIONS } from '@/lib/shared/permissions'
import { DEFAULT_FEATURE_FLAGS } from '@/lib/shared/types/settings'
import { overLimits } from '@/components/admin/settings/billing/__tests__/plan-limits-fixtures'

vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

const shell = vi.hoisted(() => ({
  sidebarLimits: undefined as unknown,
  permissions: [] as string[],
  notice: null as unknown,
  summary: vi.fn(),
}))

vi.mock('@/components/admin/admin-sidebar', () => ({
  AdminSidebar: ({ planLimits }: { planLimits?: unknown }) => {
    shell.sidebarLimits = planLimits
    return null
  },
}))
vi.mock('@/components/shared/cloud-quackback-widget', () => ({ CloudQuackbackWidget: () => null }))
vi.mock('@/lib/client/hooks/use-admin-presence', () => ({ useAdminPresence: () => {} }))
vi.mock('@/lib/server/functions/workspace-utils', () => ({
  requireWorkspaceRole: async () => ({
    user: { id: 'user_1', name: 'Ada', email: 'ada@example.com', image: null },
    principal: { id: 'principal_1', role: 'member', chatAvailability: 'online' },
    permissions: shell.permissions,
  }),
}))
vi.mock('@/lib/server/functions/portal', () => ({
  fetchUserAvatar: async () => ({ avatarUrl: null }),
}))
vi.mock('@/lib/server/functions/version', () => ({
  getLatestVersion: async () => null,
  isNewerVersion: () => false,
}))
vi.mock('@/lib/server/functions/plan-notice', () => ({ getPlanNotice: async () => shell.notice }))
vi.mock('@/lib/server/functions/notifications', () => ({
  getUnreadCountFn: async () => ({ count: 0 }),
  getNotificationsFn: async () => ({ notifications: [], total: 0, unreadCount: 0 }),
}))
vi.mock('@/lib/server/functions/plan-limits', () => ({
  getPlanLimitsSummaryFn: () => shell.summary(),
  getPlanLimitsFn: vi.fn(),
}))

const { Route: AdminRouteImport } = await import('../admin')
const { expireRouteContext } = await import('@/lib/client/route-context-memo')

const ENDED_TRIAL = {
  label: 'Your Pro trial has ended',
  message: 'Choose a plan to continue.',
  expiresAt: '2026-11-10T00:00:00.000Z',
  actionUrl: '/admin/settings/billing',
  actionLabel: 'See plans',
  ended: true,
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'))
  shell.permissions = SYSTEM_ROLE_PERMISSIONS.contributor
  shell.notice = ENDED_TRIAL
  shell.summary.mockReset()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  expireRouteContext()
})

function buildRouter(queryClient: QueryClient, flags: { billing: boolean; planLimits: boolean }) {
  const rootRoute = createRootRouteWithContext<object>()({
    beforeLoad: () => ({
      settings: { featureFlags: { ...DEFAULT_FEATURE_FLAGS, planLimits: flags.planLimits } },
      billingEnabled: flags.billing,
      acceptLanguageLocale: 'en',
    }),
    component: () => <Outlet />,
  })
  const adminRoute = AdminRouteImport.update({
    id: '/admin',
    path: '/admin',
    getParentRoute: () => rootRoute,
  } as never) as unknown as AnyRoute
  const page = (path: string) =>
    createRoute({
      getParentRoute: () => adminRoute,
      path,
      component: () => <p>{path} page</p>,
    })
  return createRouter({
    routeTree: rootRoute.addChildren([adminRoute.addChildren([page('/inbox'), page('/roadmap')])]),
    history: createMemoryHistory({ initialEntries: ['/admin/inbox'] }),
    context: { queryClient },
  })
}

async function mount(flags = { billing: true, planLimits: true }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = buildRouter(queryClient, flags)
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
  // The first mount loads the layout's lazy parts.
  await screen.findByText('/inbox page', {}, { timeout: 5000 })
  return { router, queryClient }
}

const banner = () => document.querySelector('[data-plan-limits-banner]')

describe('the plan limits strip in the admin layout', () => {
  it('shows on every page for a teammate without billing rights, in place of the ended trial', async () => {
    shell.summary.mockResolvedValue(overLimits({ canManageBilling: false }))
    const { router } = await mount()
    await waitFor(() => expect(banner()).toHaveAttribute('data-plan-limits-banner', 'grace'))
    expect(banner()).toHaveTextContent('Ask someone who manages billing to upgrade.')
    expect(screen.queryByText('Your Pro trial has ended')).toBeNull()
    expect(shell.sidebarLimits).toMatchObject({ phase: 'grace' })

    await act(() => router.navigate({ to: '/admin/roadmap' } as never))
    await screen.findByText('/roadmap page')
    expect(banner()).toHaveAttribute('data-plan-limits-banner', 'grace')
  })

  it('keeps the ended trial strip when the workspace fits its plan', async () => {
    shell.summary.mockResolvedValue(overLimits({ phase: 'ok', issues: [] }))
    await mount()
    expect(await screen.findByText('Your Pro trial has ended')).toBeInTheDocument()
    expect(banner()).toBeNull()
  })

  it('shows neither strip once only paused features remain after the date', async () => {
    // Spec 5.1: once no cap is over, the global banner goes and each settings
    // page carries its own line, so the ended trial strip stays hidden too.
    shell.summary.mockResolvedValue(overLimits({ phase: 'enforced', issues: [] }))
    await mount()
    await waitFor(() => expect(shell.summary).toHaveBeenCalled())
    await act(async () => {})
    expect(banner()).toBeNull()
    expect(screen.queryByText('Your Pro trial has ended')).toBeNull()
  })

  it('shows nothing and asks nothing without plan billing', async () => {
    await mount({ billing: false, planLimits: true })
    expect(await screen.findByText('Your Pro trial has ended')).toBeInTheDocument()
    expect(shell.summary).not.toHaveBeenCalled()
    expect(banner()).toBeNull()
    expect(shell.sidebarLimits).toBeNull()
  })

  it('goes away without a reload once the workspace fits again', async () => {
    shell.summary.mockResolvedValue(overLimits())
    const { queryClient } = await mount()
    await waitFor(() => expect(banner()).not.toBeNull())
    // An upgrade or the last fix: the next read of the summary is ok.
    shell.summary.mockResolvedValue(overLimits({ phase: 'ok', issues: [], graceEndsAt: null }))
    await act(() => queryClient.invalidateQueries({ queryKey: ['plan-limits'] }))
    await waitFor(() => expect(banner()).toBeNull())
  })
})
