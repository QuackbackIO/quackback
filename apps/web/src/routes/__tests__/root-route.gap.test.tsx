// @vitest-environment happy-dom
/**
 * Differential-coverage tests for the root route beforeLoad — bootstrap fetch,
 * the onboarding-exempt gate, and the portalConfig redaction branches
 * (access vs support-only vs neither) placed into the router context.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  getSetupState: vi.fn(() => ({})),
  isOnboardingComplete: vi.fn(() => true),
}))

vi.mock('@tanstack/react-router', () => ({
  createRootRouteWithContext: () => (cfg: unknown) => ({ options: cfg }),
  redirect: (opts: unknown) => Object.assign(new Error('redirect'), { redirect: opts }),
  Outlet: () => null,
  HeadContent: () => null,
  Scripts: () => null,
  useRouterState: () => ({}),
}))
vi.mock('../globals.css?url', () => ({ default: '/globals.css' }))
vi.mock('@/lib/shared/db-types', () => ({
  getSetupState: m.getSetupState,
  isOnboardingComplete: m.isOnboardingComplete,
}))
vi.mock('@/lib/server/functions/bootstrap', () => ({ getBootstrapData: m.bootstrap }))
vi.mock('@/lib/shared/redact-portal-config', () => ({ redactSettingsForClient: (o: unknown) => o }))
vi.mock('@/components/theme-provider', () => ({ ThemeProvider: () => null }))
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }))
vi.mock('@/components/shared/error-page', () => ({ DefaultErrorPage: () => null }))
vi.mock('@/components/shared/ott-handler', () => ({ OttHandler: () => null }))
vi.mock('@/lib/shared/document-locale', () => ({
  documentLocale: () => 'en',
  htmlLangDir: () => ({ lang: 'en', dir: 'ltr' }),
}))
vi.mock('@/lib/shared/i18n', () => ({ normalizeLocale: (l: string) => l, DEFAULT_LOCALE: 'en' }))

const { Route } = await import('../__root')
const beforeLoad = (
  Route as unknown as {
    options: {
      beforeLoad: (a: { location: { pathname: string } }) => Promise<Record<string, unknown>>
    }
  }
).options.beforeLoad

const boot = (settings: unknown) => ({
  baseUrl: 'https://x.test',
  session: null,
  settings,
  userRole: null,
  themeCookie: null,
  managedFieldPaths: [],
  registeredAuthProviders: [],
  acceptLanguageLocale: 'en',
})

beforeEach(() => {
  vi.clearAllMocks()
  m.isOnboardingComplete.mockReturnValue(true)
})

describe('root beforeLoad', () => {
  it('redirects to onboarding when setup is incomplete on a non-exempt path', async () => {
    m.bootstrap.mockResolvedValueOnce(boot({ settings: { setupState: null } }))
    m.isOnboardingComplete.mockReturnValueOnce(false)
    await expect(beforeLoad({ location: { pathname: '/admin/tickets' } })).rejects.toThrow(
      'redirect'
    )
  })

  it('redacts portalConfig.access (keeps only visibility)', async () => {
    m.bootstrap.mockResolvedValueOnce(
      boot({
        settings: { setupState: 'done' },
        portalConfig: {
          access: { visibility: 'public', allowedDomains: ['secret.com'] },
          support: { enabled: true, access: {} },
        },
      })
    )
    const ctx = await beforeLoad({ location: { pathname: '/widget' } })
    const pc = (
      ctx.settings as { portalConfig: { access: { visibility: string; allowedDomains?: unknown } } }
    ).portalConfig
    expect(pc.access.visibility).toBe('public')
    expect(pc.access.allowedDomains).toBeUndefined()
  })

  it('redacts a support-only access config', async () => {
    m.bootstrap.mockResolvedValueOnce(
      boot({
        settings: { setupState: 'done' },
        portalConfig: { support: { enabled: true, access: { allowedDomains: ['x'] } } },
      })
    )
    const ctx = await beforeLoad({ location: { pathname: '/widget' } })
    const pc = (
      ctx.settings as { portalConfig: { support: { enabled: boolean; access?: unknown } } }
    ).portalConfig
    expect(pc.support).toEqual({ enabled: true })
  })

  it('passes through a config without access/support and a null settings', async () => {
    m.bootstrap.mockResolvedValueOnce(
      boot({ settings: { setupState: 'done' }, portalConfig: { theme: 'x' } })
    )
    const ctx = await beforeLoad({ location: { pathname: '/widget' } })
    expect((ctx.settings as { portalConfig: unknown }).portalConfig).toEqual({ theme: 'x' })
    m.bootstrap.mockResolvedValueOnce(boot(null))
    const ctx2 = await beforeLoad({ location: { pathname: '/widget' } })
    expect(ctx2.settings).toBeNull()
  })
})
