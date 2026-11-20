/**
 * The admin layout loader runs for every admin page, so nothing it reads may
 * fail the layout. The plan notice is for every teammate on a dashboard
 * session, including a custom role holding only inbox permissions
 * (conversation.view, ticket.view, reply, note, set_status), and a failed
 * read leaves the layout without a notice rather than failing it.
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

// Stands in for the real server function, which answers any teammate on a
// dashboard session whatever their permissions.
const getPlanNotice = vi.hoisted(() =>
  vi.fn(async () => ({ label: 'Trial', message: '7 days left' }))
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
  it('shows the plan notice to a role without member.view', async () => {
    const data = await loadAdmin(INBOX_ONLY)

    expect(getPlanNotice).toHaveBeenCalledTimes(1)
    expect(data.planNotice).toEqual({ label: 'Trial', message: '7 days left' })
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
