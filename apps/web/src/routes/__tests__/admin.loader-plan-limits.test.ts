/**
 * The admin layout loader reads the plan limits summary for every admin page,
 * so every teammate sees the banner and the sidebar line wherever they are.
 * It reads it only where plan billing is on and the plan limits flag is on:
 * an install without plan billing never asks and never shows anything. A read
 * that fails or is refused leaves the layout working, with no banner.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { PERMISSIONS, SYSTEM_ROLE_PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { DEFAULT_FEATURE_FLAGS } from '@/lib/shared/types/settings'

vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

vi.mock('@/lib/server/functions/notifications', () => ({
  getUnreadCountFn: vi.fn(async () => ({ count: 0 })),
  getNotificationsFn: vi.fn(async () => ({ notifications: [], total: 0, unreadCount: 0 })),
}))
vi.mock('@/lib/server/functions/portal', () => ({
  fetchUserAvatar: async () => ({ avatarUrl: null }),
}))
vi.mock('@/lib/server/functions/version', () => ({
  getLatestVersion: async () => null,
  isNewerVersion: () => false,
}))
vi.mock('@/lib/server/functions/plan-notice', () => ({ getPlanNotice: async () => null }))

const SUMMARY = { enabled: true, phase: 'grace', issues: [{ key: 'maxBoards' }] }

// Stands in for the real server function's gate: it refuses a caller whose
// permission set lacks member.view, exactly as requireAuth does.
const caller = vi.hoisted(() => ({ permissions: [] as string[] }))
const getPlanLimitsSummaryFn = vi.hoisted(() =>
  vi.fn(async () => {
    if (!caller.permissions.includes('member.view')) {
      throw new Error("Access denied: Requires permission 'member.view'")
    }
    return { enabled: true, phase: 'grace', issues: [{ key: 'maxBoards' }] }
  })
)
vi.mock('@/lib/server/functions/plan-limits', () => ({ getPlanLimitsSummaryFn }))

const { Route } = await import('../admin')

type Loader = (ctx: {
  context: Record<string, unknown>
  location: { pathname: string }
}) => Promise<{ planLimits: unknown; planNotice: unknown }>
const loader = (Route as unknown as { options: { loader: Loader } }).options.loader

afterEach(() => getPlanLimitsSummaryFn.mockClear())

function loadAdmin(opts: {
  permissions?: PermissionKey[]
  billingEnabled?: boolean
  planLimits?: boolean
  pathname?: string
}) {
  caller.permissions = opts.permissions ?? SYSTEM_ROLE_PERMISSIONS.owner
  return loader({
    context: {
      queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      user: { id: 'user_1', name: 'Ada', email: 'ada@example.com', image: null },
      principal: { id: 'principal_1', chatAvailability: 'online' },
      permissions: caller.permissions,
      acceptLanguageLocale: 'en',
      billingEnabled: opts.billingEnabled ?? true,
      settings: {
        featureFlags: { ...DEFAULT_FEATURE_FLAGS, planLimits: opts.planLimits ?? true },
      },
    },
    location: { pathname: opts.pathname ?? '/admin/inbox' },
  })
}

describe('admin loader: plan limits', () => {
  it.each(['owner', 'admin', 'manager', 'support_lead', 'contributor'] as const)(
    'reads the summary for the %s role, on any admin page',
    async (role) => {
      for (const pathname of ['/admin/inbox', '/admin/roadmap', '/admin/settings/boards']) {
        const data = await loadAdmin({ permissions: SYSTEM_ROLE_PERMISSIONS[role], pathname })
        expect(data.planLimits).toEqual(SUMMARY)
      }
      expect(getPlanLimitsSummaryFn).toHaveBeenCalledTimes(3)
    }
  )

  it('never asks without plan billing, even with the flag on', async () => {
    const data = await loadAdmin({ billingEnabled: false })
    expect(getPlanLimitsSummaryFn).not.toHaveBeenCalled()
    expect(data.planLimits).toBeNull()
  })

  it('never asks with the flag off', async () => {
    const data = await loadAdmin({ planLimits: false })
    expect(getPlanLimitsSummaryFn).not.toHaveBeenCalled()
    expect(data.planLimits).toBeNull()
  })

  it('still loads the layout when the read fails', async () => {
    getPlanLimitsSummaryFn.mockRejectedValueOnce(new Error('database unreachable'))
    const data = await loadAdmin({})
    expect(getPlanLimitsSummaryFn).toHaveBeenCalledTimes(1)
    expect(data.planLimits).toBeNull()
  })

  it('loads the layout for a custom role without member.view, with no banner', async () => {
    const data = await loadAdmin({
      permissions: [PERMISSIONS.CONVERSATION_VIEW, PERMISSIONS.CONVERSATION_REPLY],
    })
    expect(data.planLimits).toBeNull()
  })
})
