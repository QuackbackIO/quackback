// @vitest-environment happy-dom
/**
 * The rail's notification bell shows the unread count on every admin page.
 * The admin layout's loader warms it with the document, so the bell has it at
 * first paint and does not ask the server again once the page hydrates; when
 * the count cannot be read then, the bell asks for it itself as before.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

const getUnreadCountFn = vi.hoisted(() => vi.fn<() => Promise<{ count: number }>>())
vi.mock('@/lib/server/functions/notifications', () => ({
  getUnreadCountFn,
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
const { NotificationBell } = await import('@/components/notifications/notification-bell')
const { TooltipProvider } = await import('@/components/ui/tooltip')

type Loader = (ctx: {
  context: Record<string, unknown>
  location: { pathname: string }
}) => Promise<unknown>
const loader = (Route as unknown as { options: { loader: Loader } }).options.loader

afterEach(() => {
  cleanup()
  getUnreadCountFn.mockReset()
})

async function loadAdmin(queryClient: QueryClient) {
  await loader({
    context: {
      queryClient,
      user: { id: 'user_1', name: 'Ada', email: 'ada@example.com', image: null },
      principal: { id: 'principal_1', chatAvailability: 'online' },
      acceptLanguageLocale: 'en',
    },
    location: { pathname: '/admin/inbox' },
  })
}

function renderBell(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <NotificationBell />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

describe('admin loader: unread count', () => {
  it('hands the bell the count it loaded with the page', async () => {
    getUnreadCountFn.mockResolvedValue({ count: 3 })
    const queryClient = new QueryClient()

    await loadAdmin(queryClient)
    renderBell(queryClient)

    expect(screen.getByRole('button', { name: 'Notifications (3 unread)' })).toBeTruthy()
    expect(getUnreadCountFn).toHaveBeenCalledTimes(1)
  })

  it('leaves the count to the bell when it could not be read with the page', async () => {
    getUnreadCountFn.mockRejectedValueOnce(new Error('unavailable'))
    getUnreadCountFn.mockResolvedValue({ count: 2 })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    await loadAdmin(queryClient)
    renderBell(queryClient)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Notifications (2 unread)' })).toBeTruthy()
    )
    expect(getUnreadCountFn).toHaveBeenCalledTimes(2)
  })
})
