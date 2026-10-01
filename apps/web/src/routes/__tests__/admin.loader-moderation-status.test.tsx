// @vitest-environment happy-dom
/**
 * The rail's review badge shows the pending count on every admin page. The
 * admin layout's loader warms it with the document, but only for a viewer who
 * can act on it and only when feedback is on; everyone else costs no query.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

const getModerationStatus = vi.hoisted(() =>
  vi.fn<() => Promise<{ enabled: boolean; pendingCount: number }>>()
)
vi.mock('@/lib/server/functions/moderation', () => ({ getModerationStatus }))
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

const { Route } = await import('../admin')
const { adminQueries } = await import('@/lib/client/queries/admin')

type Loader = (ctx: {
  context: Record<string, unknown>
  location: { pathname: string }
}) => Promise<unknown>
const loader = (Route as unknown as { options: { loader: Loader } }).options.loader

afterEach(() => getModerationStatus.mockReset())

async function loadAdmin(opts: { permissions: string[]; feedback: boolean }) {
  const queryClient = new QueryClient()
  await loader({
    context: {
      queryClient,
      user: { id: 'user_1', name: 'Ada', email: 'ada@example.com', image: null },
      principal: { id: 'principal_1', chatAvailability: 'online' },
      permissions: opts.permissions,
      settings: { featureFlags: { feedback: opts.feedback } },
      acceptLanguageLocale: 'en',
    },
    location: { pathname: '/admin/settings/general' },
  })
  return queryClient
}

describe('admin loader: moderation status', () => {
  it('warms the pending count for a viewer who can approve posts', async () => {
    getModerationStatus.mockResolvedValue({ enabled: true, pendingCount: 4 })

    const queryClient = await loadAdmin({ permissions: ['post.approve'], feedback: true })

    expect(getModerationStatus).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryData(adminQueries.moderationStatus().queryKey)).toEqual({
      enabled: true,
      pendingCount: 4,
    })
  })

  it('skips the query without the post.approve permission', async () => {
    await loadAdmin({ permissions: ['post.view'], feedback: true })
    expect(getModerationStatus).not.toHaveBeenCalled()
  })

  it('skips the query when feedback is off', async () => {
    await loadAdmin({ permissions: ['post.approve'], feedback: false })
    expect(getModerationStatus).not.toHaveBeenCalled()
  })

  it('still loads the page when the count cannot be read', async () => {
    getModerationStatus.mockRejectedValue(new Error('unavailable'))
    await expect(loadAdmin({ permissions: ['post.approve'], feedback: true })).resolves.toBeTruthy()
  })
})
