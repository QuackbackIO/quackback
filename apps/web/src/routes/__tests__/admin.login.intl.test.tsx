// @vitest-environment happy-dom
import type { ComponentType, ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

// Stub the router: `createFileRoute` so we can drive `useLoaderData`, and
// `Link` so the page's "use a recovery code" link renders without a real
// RouterProvider.
const useLoaderDataMock = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    // Lazy indirection: the factory is hoisted above `useLoaderDataMock`, so
    // read it at call time (render) rather than at admin.login import time.
    useLoaderData: () => useLoaderDataMock(),
  }),
  Link: ({ to, children }: { to: unknown; children: ReactNode }) => (
    <a href={typeof to === 'string' ? to : '#'}>{children}</a>
  ),
  redirect: (opts: unknown) => opts,
  // PortalBrandMark (via AdminAuthShell) reads branding off the root context;
  // an empty context falls back to the default Quackback mark.
  useRouteContext: () => ({}),
}))

// `useServerFn(lookupAuthMethodsFn)` is the email→methods classifier we drive.
// `createServerFn` is only needed so locale.ts's module-load `getPortalLocaleFn`
// doesn't crash on import once the fix wires it in.
const lookupMock = vi.fn()
vi.mock('@tanstack/react-start', () => ({
  useServerFn: () => lookupMock,
  createServerFn: () => ({ handler: () => vi.fn() }),
}))

vi.mock('@/lib/server/functions/auth', () => ({
  lookupAuthMethodsFn: vi.fn(),
  SSO_UNAVAILABLE_MESSAGE: 'SSO unavailable',
}))

// Plain constant map in a server path — stub to avoid pulling server-only deps.
vi.mock('@/lib/server/auth/redirect-errors', () => ({ AUTH_BLOCK_MESSAGES: {} }))

vi.mock('@/lib/client/auth-client', () => ({
  authClient: {
    signIn: { email: vi.fn(), emailOtp: vi.fn(), oauth2: vi.fn() },
    signUp: { email: vi.fn() },
    requestPasswordReset: vi.fn(),
  },
}))

vi.mock('@/components/auth/oauth-buttons', () => ({
  OAuthButtons: () => <div data-testid="oauth-buttons" />,
  getEnabledOAuthProviders: vi.fn(() => []),
}))

// input-otp schedules real setTimeouts on mount that can fire after teardown
// under happy-dom; the password step we exercise never shows it, but
// PortalAuthForm imports it at module load — stub to a plain input.
vi.mock('@/components/ui/input-otp', () => ({
  InputOTP: (props: Record<string, unknown>) => <input {...(props as object)} />,
  InputOTPGroup: ({ children }: { children?: ReactNode }) => <>{children}</>,
  InputOTPSlot: () => null,
  InputOTPSeparator: () => null,
}))

import { Route } from '../admin.login'

// `createFileRoute` is mocked above, so at runtime `Route` is the plain options
// object — reach its `component` through `unknown` since the real route type
// doesn't surface it.
const AdminLoginPage = (Route as unknown as { component: ComponentType }).component

describe('/admin/login — IntlProvider regression (#232)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useLoaderDataMock.mockReturnValue({
      errorMessage: null,
      safeCallbackUrl: '/admin',
      authConfig: { password: true, magicLink: false },
      locale: 'en',
    })
  })
  afterEach(() => cleanup())

  // TeamLoginForm hands off to PortalAuthForm (which calls `useIntl()`) once the
  // typed email is classified as `methods`. Before this fix /admin/login had no
  // PortalIntlProvider ancestor, so that handoff threw "Could not find required
  // `intl` object", crashing every non-SSO admin sign-in on 0.12.0.
  it('renders the methods step (PortalAuthForm) without an intl-provider crash', async () => {
    lookupMock.mockResolvedValue({
      kind: 'methods',
      authConfig: { password: true, magicLink: false },
      ssoEnabled: false,
    })

    render(<AdminLoginPage />)

    fireEvent.change(screen.getByLabelText(/work email/i), {
      target: { value: 'admin@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(lookupMock).toHaveBeenCalledOnce())

    // PortalAuthForm rendered under the provider — its intl-labelled password
    // field is present, proving useIntl() resolved instead of throwing.
    expect(await screen.findByLabelText(/password/i)).toBeInTheDocument()
  })
})
