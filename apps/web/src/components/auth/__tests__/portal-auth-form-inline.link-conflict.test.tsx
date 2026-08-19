// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

vi.mock('@tanstack/react-start', () => ({ useServerFn: () => vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
  useRouter: () => ({ navigate: vi.fn() }),
}))

vi.mock('@/lib/server/functions/auth', () => ({
  lookupAuthMethodsFn: vi.fn(),
}))

vi.mock('@/lib/client/auth-client', () => ({
  authClient: {
    signIn: { email: vi.fn(), emailOtp: vi.fn(), oauth2: vi.fn(), social: vi.fn() },
    signUp: { email: vi.fn() },
    requestPasswordReset: vi.fn(),
  },
}))

vi.mock('@/components/auth/oauth-buttons', () => ({
  getEnabledOAuthProviders: () => [{ id: 'custom-oidc', name: 'Acme SSO', type: 'generic-oauth' }],
  getOAuthRedirectUrl: vi.fn(),
  hasRoutableOidcProvider: () => false,
}))

vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  usePopupTracker: () => ({
    trackPopup: vi.fn(),
    clearPopup: vi.fn(),
    hasPopup: () => false,
    focusPopup: vi.fn(),
  }),
  openAuthPopup: vi.fn(),
  postAuthSuccess: vi.fn(),
  postAuthError: vi.fn(),
  useAuthBroadcast: vi.fn(),
}))

const startProviderLinkMock = vi.fn()
vi.mock('@/lib/client/start-provider-link', () => ({
  startProviderLink: (args: unknown) => startProviderLinkMock(args),
}))

// The real InputOTP takes children (slots) and a string-valued onChange;
// mock it down to a plain input so the code step is drivable in tests.
vi.mock('@/components/ui/input-otp', () => ({
  InputOTP: ({ value, onChange }: { value?: string; onChange?: (v: string) => void }) => (
    <input value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} />
  ),
  InputOTPGroup: ({ children }: { children?: ReactNode }) => <>{children}</>,
  InputOTPSlot: () => null,
  InputOTPSeparator: () => null,
  InputOTPSixSlots: () => null,
}))

import { PortalAuthFormInline } from '../portal-auth-form-inline'
import { postAuthSuccess } from '@/lib/client/hooks/use-auth-broadcast'
import { authClient } from '@/lib/client/auth-client'

function renderForm(props: Partial<React.ComponentProps<typeof PortalAuthFormInline>> = {}) {
  return rtlRender(
    <IntlProvider locale="en" defaultLocale="en" messages={{}}>
      <PortalAuthFormInline
        mode="login"
        authConfig={{ found: true, oauth: { password: true, magicLink: true } }}
        callbackUrl="/board/ideas"
        {...props}
      />
    </IntlProvider>
  )
}

const conflictProps = {
  linkConflict: {
    providerId: 'custom-oidc',
    providerType: 'oidc' as const,
    email: 'jane@acme.com',
  },
}

describe('PortalAuthFormInline — link-conflict recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('opens straight into the conflict view with the attempt email prefilled', () => {
    renderForm(conflictProps)
    expect(screen.getByText(/you already have an account/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toHaveValue('jane@acme.com')
    // Provider display name resolves from the enabled-provider list.
    expect(screen.getAllByText('Acme SSO').length).toBeGreaterThan(0)
  })

  it('sends the confirmation email with a /auth/link-sso callback and advances to the code step', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response)
    renderForm(conflictProps)

    fireEvent.click(screen.getByRole('button', { name: /email me a confirmation link/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth/portal-signin')
    const body = JSON.parse((init as RequestInit).body as string) as {
      email: string
      callbackURL: string
    }
    expect(body.email).toBe('jane@acme.com')
    expect(body.callbackURL).toBe(
      '/auth/link-sso?provider=custom-oidc&type=oidc&next=%2Fboard%2Fideas'
    )
    // Advanced to the OTP code step.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /verify code/i })).toBeInTheDocument()
    )
  })

  it('resumes the provider link after a successful OTP verify', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response)
    vi.mocked(authClient.signIn.emailOtp).mockResolvedValueOnce({
      data: {},
      error: null,
    } as never)
    startProviderLinkMock.mockResolvedValueOnce('https://idp.example.com/authorize?x=1')
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })

    renderForm(conflictProps)
    fireEvent.click(screen.getByRole('button', { name: /email me a confirmation link/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const otpInput = await screen.findByRole('textbox')
    fireEvent.change(otpInput, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }))

    await waitFor(() =>
      expect(startProviderLinkMock).toHaveBeenCalledWith({
        providerId: 'custom-oidc',
        providerType: 'oidc',
        callbackURL: '/board/ideas',
      })
    )
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://idp.example.com/authorize?x=1')
    )
    expect(postAuthSuccess).not.toHaveBeenCalled()
  })

  it('falls back to plain sign-in success when no provider context is known', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response)
    vi.mocked(authClient.signIn.emailOtp).mockResolvedValueOnce({
      data: {},
      error: null,
    } as never)

    renderForm({ linkConflict: { email: 'jane@acme.com' } })
    fireEvent.click(screen.getByRole('button', { name: /email me a confirmation link/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    // No provider context → the magic link goes to the default callback.
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as {
      callbackURL: string
    }
    expect(body.callbackURL).toBe('/board/ideas')

    const otpInput = await screen.findByRole('textbox')
    fireEvent.change(otpInput, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }))

    await waitFor(() => expect(postAuthSuccess).toHaveBeenCalled())
    expect(startProviderLinkMock).not.toHaveBeenCalled()
  })
})
