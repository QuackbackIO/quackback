// @vitest-environment happy-dom
/**
 * The portal header's notification bell shows a signed-in visitor's unread
 * count on every portal page. The portal layout's loader warms it with the
 * document, so the bell has it at first paint and does not ask the server
 * again once the page hydrates; when the count cannot be read then, the bell
 * asks for it itself as before. An anonymous visitor has no bell and no count.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const getUnreadCountFn = vi.hoisted(() => vi.fn<() => Promise<{ count: number }>>())
vi.mock('@/lib/server/functions/notifications', () => ({
  getUnreadCountFn,
  getNotificationsFn: vi.fn(async () => ({ notifications: [], total: 0, unreadCount: 0 })),
}))
vi.mock('@/lib/server/functions/portal-access', () => ({
  evaluateMyPortalAccessFn: async () => ({ granted: true, reason: 'public' }),
  recordPortalAccessDeniedFn: async () => undefined,
}))
vi.mock('@/lib/server/functions/portal', () => ({
  fetchUserAvatar: async () => ({ avatarUrl: null }),
}))
vi.mock('@/lib/server/functions/portal-permissions', () => ({
  getMyPortalPermissionsFn: async () => [],
}))
vi.mock('@/lib/server/functions/locale', () => ({
  getPortalLocaleFn: async () => 'en',
  loadPortalIntl: async () => ({ locale: 'en', messages: {} }),
}))
vi.mock('@/lib/server/functions/instant-sso', () => ({
  resolveInstantSsoRedirectFn: async () => null,
}))

const { Route } = await import('../_portal')
const { NotificationBell } = await import('@/components/notifications/notification-bell')
const { TooltipProvider } = await import('@/components/ui/tooltip')

type Loader = (ctx: {
  context: Record<string, unknown>
  deps: Record<string, unknown>
  location: { pathname: string }
}) => Promise<unknown>
const loader = (Route as unknown as { options: { loader: Loader } }).options.loader

afterEach(() => {
  cleanup()
  getUnreadCountFn.mockReset()
})

async function loadPortal(queryClient: QueryClient, principalType: 'user' | 'anonymous') {
  await loader({
    context: {
      queryClient,
      session: {
        user: { id: 'user_1', name: 'Ada', email: 'ada@example.com', image: null, principalType },
      },
      settings: { name: 'Acme', brandingConfig: {}, customCss: '' },
      userRole: 'user',
      baseUrl: 'http://localhost:3000',
      registeredAuthProviders: [],
    },
    deps: {},
    location: { pathname: '/' },
  })
}

function renderBell(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <NotificationBell popoverSide="bottom" />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

describe('portal loader: unread count', () => {
  it('hands the bell the count it loaded with the page', async () => {
    getUnreadCountFn.mockResolvedValue({ count: 3 })
    const queryClient = new QueryClient()

    await loadPortal(queryClient, 'user')
    renderBell(queryClient)

    expect(screen.getByRole('button', { name: 'Notifications (3 unread)' })).toBeTruthy()
    expect(getUnreadCountFn).toHaveBeenCalledTimes(1)
  })

  it('leaves the count to the bell when it could not be read with the page', async () => {
    getUnreadCountFn.mockRejectedValueOnce(new Error('unavailable'))
    getUnreadCountFn.mockResolvedValue({ count: 2 })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    await loadPortal(queryClient, 'user')
    renderBell(queryClient)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Notifications (2 unread)' })).toBeTruthy()
    )
    expect(getUnreadCountFn).toHaveBeenCalledTimes(2)
  })

  it('reads no count for an anonymous visitor, who has no bell', async () => {
    const queryClient = new QueryClient()

    await loadPortal(queryClient, 'anonymous')

    expect(getUnreadCountFn).not.toHaveBeenCalled()
  })
})
