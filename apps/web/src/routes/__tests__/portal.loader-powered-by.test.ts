// @vitest-environment happy-dom
/**
 * The footer's credit shows under every portal page, so the portal layout
 * reads once, with the page, whether this workspace shows it.
 */
import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

const getShowPoweredByFn = vi.hoisted(() => vi.fn<() => Promise<boolean>>())
vi.mock('@/lib/server/functions/powered-by', () => ({ getShowPoweredByFn }))
vi.mock('@/lib/server/functions/notifications', () => ({
  getUnreadCountFn: vi.fn(async () => ({ count: 0 })),
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

type Loader = (ctx: {
  context: Record<string, unknown>
  deps: Record<string, unknown>
  location: { pathname: string }
}) => Promise<{ showPoweredBy?: boolean }>
const loader = (Route as unknown as { options: { loader: Loader } }).options.loader

const loadPortal = () =>
  loader({
    context: {
      queryClient: new QueryClient(),
      session: null,
      settings: { name: 'Acme', brandingConfig: {}, customCss: '' },
      userRole: null,
      baseUrl: 'http://localhost:3000',
      registeredAuthProviders: [],
    },
    deps: {},
    location: { pathname: '/roadmap' },
  })

describe('portal loader: the footer credit', () => {
  it.each([true, false])('carries whether the workspace shows it (%s)', async (shown) => {
    getShowPoweredByFn.mockResolvedValue(shown)
    expect((await loadPortal()).showPoweredBy).toBe(shown)
  })
})
