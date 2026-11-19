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
import { PERMISSIONS, SYSTEM_ROLE_PERMISSIONS } from '@/lib/shared/permissions'
import { PLAN_LIMITS_PATH } from '@/lib/shared/billing/plan-limits-path'
import type { PlanLimitsNotice } from '@/lib/server/domains/plan-limits/plan-limits.notice'
import { DEFAULT_FEATURE_FLAGS } from '@/lib/shared/types/settings'
import { overLimits } from '@/components/admin/settings/billing/__tests__/plan-limits-fixtures'

vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

const shell = vi.hoisted(() => ({
  sidebarLimits: undefined as unknown,
  permissions: [] as string[],
  notice: null as unknown,
  summary: vi.fn(),
  limitsNotice: vi.fn(),
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
// The summary refuses a viewer without member.view, as its real gate does.
vi.mock('@/lib/server/functions/plan-limits', () => ({
  getPlanLimitsSummaryFn: () =>
    shell.permissions.includes('member.view')
      ? shell.summary()
      : Promise.reject(new Error("Access denied: Requires permission 'member.view'")),
  getPlanLimitsNoticeFn: () => shell.limitsNotice(),
  getPlanLimitsFn: vi.fn(),
}))

const { Route: AdminRouteImport } = await import('../admin')
const { expireRouteContext } = await import('@/lib/client/route-context-memo')

const { trialEndedNotice } = await import('@/lib/server/domains/settings/cloud/commercial-notice')

/** The ended-trial strip as the plan notice builds it for a billing manager. */
const ENDED_TRIAL = trialEndedNotice(
  {
    enabled: true,
    plan: 'free',
    trialActive: false,
    trialExpiresAt: '2026-11-10T00:00:00.000Z',
    subscriptionStatus: null,
    canUpgrade: true,
  } as never,
  { trialPlanName: 'Pro', canManageBilling: true, now: new Date('2026-11-18T12:00:00.000Z') }
)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-18T12:00:00.000Z'))
  shell.permissions = SYSTEM_ROLE_PERMISSIONS.contributor
  shell.notice = ENDED_TRIAL
  shell.summary.mockReset()
  shell.limitsNotice.mockReset()
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
    expect(screen.queryByText('Pro trial ended')).toBeNull()
    expect(shell.sidebarLimits).toMatchObject({ phase: 'grace' })

    await act(() => router.navigate({ to: '/admin/roadmap' } as never))
    await screen.findByText('/roadmap page')
    expect(banner()).toHaveAttribute('data-plan-limits-banner', 'grace')
  })

  it('keeps the ended trial strip when the workspace fits its plan', async () => {
    shell.summary.mockResolvedValue(overLimits({ phase: 'ok', issues: [] }))
    await mount()
    expect(await screen.findByText('Pro trial ended')).toBeInTheDocument()
    expect(banner()).toBeNull()
  })

  it('keeps the ended trial strip once only paused features remain after the date', async () => {
    // No cap is over, so the plan limits banner has nothing to say; the ended
    // trial strip says why those features stopped and how to compare plans.
    const limits = overLimits({ phase: 'enforced', issues: [] })
    expect(limits.featureIssues.length).toBeGreaterThan(0)
    shell.summary.mockResolvedValue(limits)
    await mount()
    expect(await screen.findByText('Pro trial ended')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Compare plans' })).toHaveAttribute(
      'href',
      '/admin/settings/billing'
    )
    expect(banner()).toBeNull()
  })

  it('stands in for the ended trial strip while caps are over after the date', async () => {
    shell.summary.mockResolvedValue(overLimits({ phase: 'enforced' }))
    await mount()
    await waitFor(() => expect(banner()).toHaveAttribute('data-plan-limits-banner', 'enforced'))
    expect(screen.queryByText('Pro trial ended')).toBeNull()
  })

  it('shows nothing and asks nothing without plan billing', async () => {
    await mount({ billing: false, planLimits: true })
    expect(await screen.findByText('Pro trial ended')).toBeInTheDocument()
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

/** The narrowed read, as `getPlanLimitsNoticeFn` returns it: seats are over, and withheld. */
function limitsNotice(over: Partial<PlanLimitsNotice> = {}): PlanLimitsNotice {
  return {
    canViewPage: false,
    enabled: true,
    phase: 'grace',
    graceEndsAt: '2026-11-25T12:00:00.000Z',
    deadlineDay: '2026-11-24',
    planName: 'Free',
    fromPlanName: 'Pro',
    canManageBilling: false,
    issues: [{ key: 'maxBoards', used: 3, cap: 1 }],
    withheldIssues: ['maxTeamSeats'],
    featureIssues: [],
    ...over,
  }
}

describe('the plan limits strip for a custom role without member.view', () => {
  const customRole = [PERMISSIONS.POST_VIEW_PRIVATE, PERMISSIONS.CONVERSATION_VIEW]

  it('keeps the ended trial strip, without a link, once only paused features remain', async () => {
    shell.permissions = customRole
    // As the plan notice builds it for a teammate who cannot manage billing.
    shell.notice = trialEndedNotice(
      {
        enabled: true,
        plan: 'free',
        trialActive: false,
        trialExpiresAt: '2026-11-10T00:00:00.000Z',
        subscriptionStatus: null,
        canUpgrade: true,
      } as never,
      { trialPlanName: 'Pro', canManageBilling: false, now: new Date('2026-11-18T12:00:00.000Z') }
    )
    const limits = limitsNotice({ phase: 'enforced', issues: [], withheldIssues: [] })
    limits.featureIssues = overLimits({ phase: 'enforced', issues: [] }).featureIssues
    expect(limits.featureIssues.length).toBeGreaterThan(0)
    shell.limitsNotice.mockResolvedValue(limits)
    await mount()
    expect(await screen.findByText('Pro trial ended')).toBeInTheDocument()
    expect(
      screen.getByText('Ask someone who manages billing to upgrade. Until then, Free limits apply.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Compare plans' })).toBeNull()
    expect(banner()).toBeNull()
  })

  it('shows the banner with no team details and no link they cannot open', async () => {
    shell.permissions = customRole
    shell.limitsNotice.mockResolvedValue(limitsNotice())
    await mount()
    await waitFor(() => expect(banner()).toHaveAttribute('data-plan-limits-banner', 'grace'))
    expect(banner()).toHaveTextContent(
      'Fix 2 issues by Nov 24. Ask someone who manages billing to upgrade.'
    )
    expect(banner()?.querySelector('a')).toBeNull()
    expect(document.querySelector(`a[href="${PLAN_LIMITS_PATH}"]`)).toBeNull()
    expect(shell.summary).not.toHaveBeenCalled()
    expect(JSON.stringify(shell.sidebarLimits)).not.toMatch(/seatHolder|members/)
  })

  it('offers a billing manager the plans instead of the Plan limits page', async () => {
    shell.permissions = [...customRole, PERMISSIONS.BILLING_MANAGE]
    shell.limitsNotice.mockResolvedValue(limitsNotice({ canManageBilling: true }))
    await mount()
    await waitFor(() => expect(banner()).not.toBeNull())
    expect(banner()).toHaveTextContent('Fix 2 issues by Nov 24, or upgrade to keep everything.')
    expect(screen.getByRole('link', { name: 'Compare plans' })).toHaveAttribute(
      'href',
      '/admin/settings/billing'
    )
    expect(document.querySelector(`a[href="${PLAN_LIMITS_PATH}"]`)).toBeNull()
  })

  it('reads nothing and shows nothing without plan billing', async () => {
    shell.permissions = customRole
    shell.limitsNotice.mockResolvedValue(limitsNotice())
    await mount({ billing: false, planLimits: true })
    await act(async () => {})
    expect(shell.limitsNotice).not.toHaveBeenCalled()
    expect(shell.summary).not.toHaveBeenCalled()
    expect(banner()).toBeNull()
    expect(shell.sidebarLimits).toBeNull()
  })
})
