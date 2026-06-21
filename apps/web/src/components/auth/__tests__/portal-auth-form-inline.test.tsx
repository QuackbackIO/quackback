// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

// lookup is only invoked on Continue; the Stage-1 render under test never calls it.
vi.mock('@tanstack/react-start', () => ({ useServerFn: () => vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    className,
  }: {
    to: string
    children: React.ReactNode
    className?: string
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useRouter: () => ({ navigate: vi.fn() }),
}))

vi.mock('@/lib/server/functions/auth', () => ({
  lookupAuthMethodsFn: vi.fn(),
  SSO_UNAVAILABLE_MESSAGE: 'SSO unavailable',
}))

vi.mock('@/lib/server/auth/client', () => ({ stashTwoFactorCallbackUrl: vi.fn() }))

vi.mock('@/lib/client/auth-client', () => ({
  authClient: {
    signIn: { email: vi.fn(), emailOtp: vi.fn(), oauth2: vi.fn(), social: vi.fn() },
    signUp: { email: vi.fn() },
    requestPasswordReset: vi.fn(),
  },
}))

// Control which providers Stage 1 shows; the form renders its own OAuthButton.
const getEnabledOAuthProvidersMock = vi.fn(() => [] as Array<Record<string, unknown>>)
vi.mock('@/components/auth/oauth-buttons', () => ({
  getEnabledOAuthProviders: () => getEnabledOAuthProvidersMock(),
  getOAuthRedirectUrl: vi.fn(),
}))

// usePopupTracker opens a BroadcastChannel on mount — stub the whole module.
vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  usePopupTracker: () => ({
    trackPopup: vi.fn(),
    clearPopup: vi.fn(),
    hasPopup: () => false,
    focusPopup: vi.fn(),
  }),
  openAuthPopup: vi.fn(),
  postAuthSuccess: vi.fn(),
}))

// OtpCodeStep imports input-otp, which schedules real setTimeouts on mount.
vi.mock('@/components/ui/input-otp', () => ({
  InputOTP: (props: Record<string, unknown>) => <input {...(props as object)} />,
  InputOTPGroup: ({ children }: { children?: ReactNode }) => <>{children}</>,
  InputOTPSlot: () => null,
  InputOTPSeparator: () => null,
}))

import { PortalAuthFormInline } from '../portal-auth-form-inline'

function render(ui: React.ReactElement) {
  return rtlRender(
    <IntlProvider locale="en" defaultLocale="en" messages={{}}>
      {ui}
    </IntlProvider>
  )
}

function renderForm(props: React.ComponentProps<typeof PortalAuthFormInline>) {
  return render(<PortalAuthFormInline {...props} />)
}

describe('PortalAuthFormInline — OAuth-only Stage 1 (#231)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getEnabledOAuthProvidersMock.mockReturnValue([])
  })
  afterEach(() => cleanup())

  // With both email methods off, the email field at Stage 1 has nowhere to
  // route, so only the OAuth provider buttons should render.
  it('hides the email field, divider, and create-account when only OAuth is enabled', () => {
    getEnabledOAuthProvidersMock.mockReturnValue([
      { id: 'custom-oidc', name: 'Custom OIDC', type: 'generic-oauth' },
    ])
    render(
      <PortalAuthFormInline
        mode="login"
        authConfig={{
          found: true,
          oauth: { password: false, magicLink: false, 'custom-oidc': true },
        }}
        onModeSwitch={() => {}}
      />
    )
    expect(screen.getByRole('button', { name: /sign in with custom oidc/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
    expect(screen.queryByText('or')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create an account/i })).not.toBeInTheDocument()
  })

  it('shows a no-methods message when neither email methods nor OAuth are configured', () => {
    render(
      <PortalAuthFormInline
        mode="login"
        authConfig={{ found: true, oauth: { password: false, magicLink: false } }}
      />
    )
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
    expect(screen.getByText(/no sign-in methods are configured/i)).toBeInTheDocument()
  })

  // The OAuth tiles set `error` on popup/redirect failure; that error must show
  // even in OAuth-only setups where the email form (its old home) is hidden.
  it('surfaces an OAuth provider error when the email form is hidden', async () => {
    getEnabledOAuthProvidersMock.mockReturnValue([
      { id: 'custom-oidc', name: 'Custom OIDC', type: 'generic-oauth' },
    ])
    const broadcast = await import('@/lib/client/hooks/use-auth-broadcast')
    vi.mocked(broadcast.openAuthPopup).mockReturnValueOnce({
      location: { href: '' },
      close: vi.fn(),
    } as unknown as Window)
    // getOAuthRedirectUrl (mocked) returns undefined → initiateOAuth's error path.
    render(
      <PortalAuthFormInline
        mode="login"
        authConfig={{
          found: true,
          oauth: { password: false, magicLink: false, 'custom-oidc': true },
        }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /sign in with custom oidc/i }))
    expect(await screen.findByText(/failed to initiate sign in/i)).toBeInTheDocument()
  })
})

describe('PortalAuthFormInline — recovery-code break-glass link', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getEnabledOAuthProvidersMock.mockReturnValue([])
  })
  afterEach(() => cleanup())

  it('shows the recovery-code link when callbackUrl is team-bound', () => {
    renderForm({ mode: 'login', callbackUrl: '/admin' })
    expect(screen.getByRole('link', { name: /use a recovery code/i })).toHaveAttribute(
      'href',
      '/auth/recovery'
    )
  })

  it('hides the recovery-code link for a non-team callbackUrl', () => {
    renderForm({ mode: 'login', callbackUrl: '/roadmap' })
    expect(screen.queryByRole('link', { name: /use a recovery code/i })).toBeNull()
  })
})
