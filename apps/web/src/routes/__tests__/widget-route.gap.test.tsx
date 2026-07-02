// @vitest-environment happy-dom
/**
 * Differential-coverage tests for the /widget route — validateSearch coercion,
 * the loader (iframe headers, portal-session reuse, locale + widget-context
 * resolution, onboarding redirect) and the WidgetLayout component.
 */
import type { ReactNode, ReactElement } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const routeData = vi.hoisted(() => ({ useLoaderData: vi.fn() }))
const m = vi.hoisted(() => ({
  setResponseHeader: vi.fn(),
  resolveLocale: vi.fn(() => 'en'),
  extractToken: vi.fn(() => 'sess-token'),
  resolveWidgetContext: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (cfg: unknown) => ({
    options: cfg,
    useLoaderData: routeData.useLoaderData,
  }),
  redirect: (opts: unknown) => Object.assign(new Error('redirect'), { redirect: opts }),
  Outlet: () => <div data-testid="outlet" />,
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {
      validator: () => chain,
      handler: (fn: unknown) => fn,
    }
    return chain
  },
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers({ 'accept-language': 'en', cookie: 'qb=1' }),
  setResponseHeader: m.setResponseHeader,
}))
vi.mock('@/lib/shared/theme', () => ({
  generateThemeCSS: () => '.t{}',
  getGoogleFontsUrl: () => 'https://fonts/x',
}))
vi.mock('@/lib/shared/i18n', () => ({ resolveLocale: m.resolveLocale }))
vi.mock('@/components/widget/widget-auth-provider', () => ({
  WidgetAuthProvider: ({
    children,
    widgetContextToken,
  }: {
    children: ReactNode
    widgetContextToken: string
  }) => (
    <div data-testid="provider" data-token={widgetContextToken}>
      {children}
    </div>
  ),
}))
vi.mock('@/lib/server/functions/portal-session-token', () => ({
  extractSessionTokenFromCookie: m.extractToken,
}))
vi.mock('@/lib/shared/redact-portal-config', () => ({ redactSettingsForClient: (o: unknown) => o }))
vi.mock('@/lib/server/functions/widget-context', () => ({
  resolveWidgetContextFn: m.resolveWidgetContext,
}))

const { Route } = await import('../widget')
type Opts = {
  validateSearch: (s: Record<string, unknown>) => Record<string, unknown>
  loader: (a: {
    context: unknown
    location: { search: unknown }
  }) => Promise<Record<string, unknown>>
  component: () => ReactElement
}
const opts = () => (Route as unknown as { options: Opts }).options

beforeEach(() => {
  vi.clearAllMocks()
  m.resolveLocale.mockReturnValue('fr')
  m.resolveWidgetContext.mockResolvedValue({
    publicConfig: { hmacRequired: true },
    contextToken: 'ctx-token',
    source: 'application',
  })
})

describe('validateSearch', () => {
  it('passes through string params and drops non-strings', () => {
    const all = opts().validateSearch({
      locale: 'de',
      applicationKey: 'k',
      environment: 'prod',
      hostOrigin: 'h',
      app: 'a',
      env: 'e',
    })
    expect(all).toMatchObject({ locale: 'de', applicationKey: 'k', env: 'e' })
    const none = opts().validateSearch({ locale: 123, applicationKey: {} })
    expect(none.locale).toBeUndefined()
    expect(none.applicationKey).toBeUndefined()
  })
})

describe('loader', () => {
  it('redirects to onboarding when settings are missing', async () => {
    await expect(
      opts().loader({ context: { settings: { settings: null } }, location: { search: {} } })
    ).rejects.toThrow('redirect')
  })

  it('resolves headers, portal session, locale and widget context for a logged-in user', async () => {
    const ctx = {
      settings: {
        settings: { name: 'Acme' },
        brandingData: { logo: 'x' },
        brandingConfig: { themeMode: 'dark', light: { primary: '#fff' } },
        customCss: '.c{}',
      },
      session: {
        user: { id: 'u1', name: 'Jane', email: 'j@x.test', image: null, principalType: 'user' },
      },
    }
    const data = await opts().loader({
      context: ctx,
      location: { search: { locale: 'fr', app: 'k', env: 'prod', hostOrigin: 'h' } },
    })
    expect(m.setResponseHeader).toHaveBeenCalled()
    expect(data.portalUser).toMatchObject({ id: 'u1' })
    expect(data.portalSessionToken).toBe('sess-token')
    expect(data.hmacRequired).toBe(true)
    expect(data.widgetContextToken).toBe('ctx-token')
    expect(data.locale).toBe('fr')
    expect(m.resolveWidgetContext).toHaveBeenCalledWith({
      data: { applicationKey: 'k', environment: 'prod', hostOrigin: 'h' },
    })
  })

  it('treats an anonymous session as no portal user', async () => {
    const ctx = {
      settings: { settings: { name: 'Acme' }, brandingConfig: {} },
      session: { user: { id: 'anon', principalType: 'anonymous' } },
    }
    const data = await opts().loader({ context: ctx, location: { search: {} } })
    expect(data.portalUser).toBeNull()
  })
})

describe('WidgetLayout', () => {
  it('renders the auth provider with the context token and injects styles', () => {
    routeData.useLoaderData.mockReturnValue({
      themeStyles: '.t{}',
      customCss: '.c{}',
      googleFontsUrl: '',
      portalUser: null,
      portalSessionToken: null,
      hmacRequired: false,
      widgetContextToken: 'ctx-token',
      locale: 'en',
    })
    const Layout = opts().component
    render(<Layout />)
    expect(screen.getByTestId('provider').getAttribute('data-token')).toBe('ctx-token')
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })
})
