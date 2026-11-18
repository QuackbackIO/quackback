/**
 * The admin layout loader runs for every admin page, so nothing it reads may
 * fail the layout for a role that lacks an optional permission. The plan
 * notice needs member.view; a custom role holding only inbox permissions
 * (conversation.view, ticket.view, reply, note, set_status) used to get a 500
 * on every admin page because the loader called it regardless.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

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

// Stands in for the real server function's gate: it refuses a caller whose
// permission set lacks member.view, exactly as requireAuth does.
const callerPermissions = vi.hoisted(() => ({ current: [] as string[] }))
const getPlanNotice = vi.hoisted(() =>
  vi.fn(async () => {
    if (!callerPermissions.current.includes('member.view')) {
      throw new Error("Access denied: Requires permission 'member.view', role member lacks it")
    }
    return { label: 'Trial', message: '7 days left' }
  })
)
vi.mock('@/lib/server/functions/plan-notice', () => ({ getPlanNotice }))

const { Route } = await import('../admin')

type Loader = (ctx: {
  context: Record<string, unknown>
  location: { pathname: string }
}) => Promise<{ planNotice: unknown }>
const loader = (Route as unknown as { options: { loader: Loader } }).options.loader

/** The custom inbox-only role that reproduced the 500. */
const INBOX_ONLY: PermissionKey[] = [
  PERMISSIONS.CONVERSATION_VIEW,
  PERMISSIONS.CONVERSATION_REPLY,
  PERMISSIONS.TICKET_VIEW,
]

afterEach(() => {
  getPlanNotice.mockClear()
})

function loadAdmin(permissions: PermissionKey[]) {
  callerPermissions.current = permissions
  return loader({
    context: {
      queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      user: { id: 'user_1', name: 'Ada', email: 'ada@example.com', image: null },
      principal: { id: 'principal_1', chatAvailability: 'online' },
      permissions,
      acceptLanguageLocale: 'en',
    },
    location: { pathname: '/admin/inbox' },
  })
}

describe('admin loader: plan notice', () => {
  it('loads the layout for a role without member.view, with no plan notice and no refused call', async () => {
    const data = await loadAdmin(INBOX_ONLY)

    expect(data.planNotice).toBeNull()
    expect(getPlanNotice).not.toHaveBeenCalled()
  })

  it('shows the plan notice to a role holding member.view', async () => {
    const data = await loadAdmin([...INBOX_ONLY, PERMISSIONS.MEMBER_VIEW])

    expect(getPlanNotice).toHaveBeenCalledTimes(1)
    expect(data.planNotice).toEqual({ label: 'Trial', message: '7 days left' })
  })

  it('still loads the layout when the plan notice read fails', async () => {
    getPlanNotice.mockRejectedValueOnce(new Error('control plane unreachable'))

    const data = await loadAdmin([...INBOX_ONLY, PERMISSIONS.MEMBER_VIEW])

    expect(getPlanNotice).toHaveBeenCalledTimes(1)
    expect(data.planNotice).toBeNull()
  })
})
