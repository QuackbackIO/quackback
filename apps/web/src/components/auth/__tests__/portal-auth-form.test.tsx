// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('@/lib/client/auth-client', () => ({
  authClient: {
    signIn: {
      email: vi.fn(),
      emailOtp: vi.fn(),
      oauth2: vi.fn(),
    },
    signUp: { email: vi.fn() },
    requestPasswordReset: vi.fn(),
  },
}))

// OAuth buttons reach into broadcast/popup hooks that aren't relevant
// to the email-only auth flows we're testing — stub the whole module
// so the form renders without those side effects.
vi.mock('../oauth-buttons', () => ({
  OAuthButtons: ({ providers }: { providers: Array<{ id: string; name: string }> }) => (
    <div data-testid="oauth-buttons">
      {providers.map((p) => (
        <button key={p.id} type="button">
          Continue with {p.name}
        </button>
      ))}
    </div>
  ),
  getEnabledOAuthProviders: vi.fn(() => []),
}))

// `useServerFn(lookupAuthMethodsFn)` returns a callable that hits the
// server function. We swap it for a controllable mock so each test can
// dictate what the classifier returns.
const lookupMock = vi.fn()
vi.mock('@tanstack/react-start', () => ({
  useServerFn: () => lookupMock,
}))

// The auth functions module imports server-only deps when its handler
// runs; we only need the constants + type at test time.
vi.mock('@/lib/server/functions/auth', () => ({
  lookupAuthMethodsFn: vi.fn(),
  SSO_UNAVAILABLE_MESSAGE:
    'Single sign-on is configured for your domain but is not currently available. Contact your administrator.',
}))

// input-otp schedules three real setTimeouts (0/10/50 ms) on mount for
// password-manager detection. Under happy-dom those timers can fire
// after the test env has torn down `window`, surfacing as an unhandled
// "window is not defined" error that fails the run. The tests here
// don't exercise OTP-input behaviour — they just fire `change` on the
// rendered control — so stub the library with a plain text input.
vi.mock('@/components/ui/input-otp', () => ({
  InputOTP: ({
    children,
    onChange,
    onComplete,
    value,
    maxLength,
    ['aria-label']: ariaLabel,
    ...rest
  }: {
    children?: React.ReactNode
    onChange?: (value: string) => void
    onComplete?: (value: string) => void
    value?: string
    maxLength?: number
    'aria-label'?: string
  } & React.InputHTMLAttributes<HTMLInputElement>) => (
    <>
      <input
        aria-label={ariaLabel}
        value={value ?? ''}
        maxLength={maxLength}
        onChange={(e) => {
          const next = e.target.value
          onChange?.(next)
          if (maxLength && next.length === maxLength) onComplete?.(next)
        }}
        {...rest}
      />
      {children}
    </>
  ),
  InputOTPGroup: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  InputOTPSlot: () => null,
  InputOTPSeparator: () => null,
}))

import { PortalAuthForm } from '../portal-auth-form'
import { authClient } from '@/lib/client/auth-client'

const signInEmailOtpMock = authClient.signIn.emailOtp as ReturnType<typeof vi.fn>
const signInOauth2Mock = authClient.signIn.oauth2 as ReturnType<typeof vi.fn>

// Mock fetch globally; per-test override the response.
const fetchMock = vi.fn()
beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
})
afterEach(() => {
  fetchMock.mockReset()
  lookupMock.mockReset()
})

function okResponse(body: object = { ok: true }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function errorResponse(status: number, body: object = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('PortalAuthForm — Stage 1 email entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signInEmailOtpMock.mockResolvedValue({ data: {}, error: null })
    fetchMock.mockResolvedValue(okResponse())
  })
  afterEach(() => cleanup())

  it('renders email field and Continue button on Stage 1', () => {
    render(<PortalAuthForm authConfig={{ password: true, magicLink: false }} />)
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument()
    // No password field at Stage 1
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument()
  })

  it('renders OAuth tiles at Stage 1 when providers are configured', async () => {
    const oauth = await import('../oauth-buttons')
    vi.mocked(oauth.getEnabledOAuthProviders).mockReturnValueOnce([
      { id: 'google', name: 'Google', type: 'social' },
    ])
    render(<PortalAuthForm authConfig={{ password: true, magicLink: false, google: true }} />)
    expect(screen.getByTestId('oauth-buttons')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument()
  })

  it('rejects empty-email submit without calling lookup', async () => {
    render(<PortalAuthForm authConfig={{ password: true, magicLink: false }} />)
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    // HTML5 required keeps lookup from firing; nothing else to assert
    expect(lookupMock).not.toHaveBeenCalled()
  })
})

describe('PortalAuthForm — Stage 1 → Stage 2 dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signInEmailOtpMock.mockResolvedValue({ data: {}, error: null })
    fetchMock.mockResolvedValue(okResponse())
  })
  afterEach(() => cleanup())

  it('routes unknown-domain emails into the methods stage', async () => {
    lookupMock.mockResolvedValue({
      kind: 'methods',
      authConfig: { password: true, magicLink: false },
      ssoEnabled: false,
    })
    render(
      <PortalAuthForm authConfig={{ password: true, magicLink: false }} workspaceName="Acme" />
    )
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'user@gmail.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(lookupMock).toHaveBeenCalledOnce())
    expect(lookupMock).toHaveBeenCalledWith({
      data: { email: 'user@gmail.com', surface: 'portal' },
    })
    // Methods header
    await screen.findByText(/welcome back/i)
    // Read-only email shown
    expect(screen.getByText('user@gmail.com')).toBeInTheDocument()
    // Password field appears in methods step
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
  })

  it('redirects to SSO when the lookup returns sso-redirect', async () => {
    lookupMock.mockResolvedValue({ kind: 'sso-redirect' })
    signInOauth2Mock.mockResolvedValue({ data: { url: 'https://idp.example/' }, error: null })
    render(<PortalAuthForm authConfig={{ password: true, magicLink: false }} />)
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'jane@acme.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() =>
      expect(signInOauth2Mock).toHaveBeenCalledWith({
        providerId: 'sso',
        callbackURL: '/',
        // Typed email is forwarded as `loginHint` so the IdP can pre-
        // select that account in its picker.
        additionalData: { loginHint: 'jane@acme.com' },
      })
    )
    // Transient spinner shown while bouncing
    await screen.findByText(/signing you in/i)
  })

  it('shows the sso-default branch when the lookup returns sso-default', async () => {
    lookupMock.mockResolvedValue({
      kind: 'sso-default',
      authConfig: { password: true, magicLink: false },
    })
    render(
      <PortalAuthForm authConfig={{ password: true, magicLink: false }} workspaceName="Acme" />
    )
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'jane@acme.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await screen.findByText(/Acme/i)
    expect(screen.getByRole('button', { name: /continue with sso/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in another way/i })).toBeInTheDocument()
  })

  it('shows sso-unavailable copy when the lookup returns sso-unavailable', async () => {
    lookupMock.mockResolvedValue({ kind: 'sso-unavailable', reason: 'not-registered' })
    render(<PortalAuthForm authConfig={{ password: true, magicLink: false }} />)
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'jane@acme.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await screen.findByText(/single sign-on is configured for your domain/i)
  })

  it('blocks signup when openSignup=false and the email is unknown', async () => {
    lookupMock.mockResolvedValue({
      kind: 'methods',
      authConfig: { password: true, magicLink: false },
      ssoEnabled: false,
    })
    render(
      <PortalAuthForm
        mode="signup"
        authConfig={{ password: true, magicLink: false }}
        openSignup={false}
      />
    )
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'stranger@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await screen.findByText(/no account found/i)
    expect(screen.getByText(/new sign-ups are off/i)).toBeInTheDocument()
    // No password field shown in blocked state
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  })

  it('back link from Stage 2 returns to Stage 1 and clears the password', async () => {
    lookupMock.mockResolvedValue({
      kind: 'methods',
      authConfig: { password: true, magicLink: false },
      ssoEnabled: false,
    })
    render(<PortalAuthForm authConfig={{ password: true, magicLink: false }} />)
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'user@gmail.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await screen.findByLabelText(/password/i)
    // Type something so we can verify it gets cleared
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'hunter22' } })

    fireEvent.click(screen.getByRole('button', { name: /use a different email/i }))

    // Back at Stage 1
    await screen.findByRole('button', { name: /continue/i })
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  })
})

describe('PortalAuthForm — initialEmail skips Stage 1', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signInEmailOtpMock.mockResolvedValue({ data: {}, error: null })
    fetchMock.mockResolvedValue(okResponse())
  })
  afterEach(() => cleanup())

  // Mirrors the team-login handoff: the dispatcher classifies and
  // hands off to the methods form with the email pre-filled.
  const adminAuthConfig = { magicLink: true, password: false }

  it('lands on the magic-link send step when initialEmail is supplied', () => {
    render(
      <PortalAuthForm
        authConfig={adminAuthConfig}
        callbackUrl="/admin/feedback"
        initialEmail="founder@acme.com"
      />
    )
    // No Stage 1 — we're at Stage 2 magic-link send
    expect(screen.getByRole('button', { name: /continue with email/i })).toBeInTheDocument()
    expect(screen.getByText('founder@acme.com')).toBeInTheDocument()
  })

  it('submits the magic-link request and flips to the code step', async () => {
    render(
      <PortalAuthForm
        authConfig={adminAuthConfig}
        callbackUrl="/admin/feedback"
        initialEmail="founder@acme.com"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /continue with email/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/portal-signin',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'founder@acme.com', callbackURL: '/admin/feedback' }),
      })
    )

    await screen.findByText(/we sent a 6-digit code to/i)
    expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument()
    expect(screen.getByText(/sign-in link in your email also works/i)).toBeInTheDocument()
  })

  it('auto-submits when 6 digits are entered (no manual button click needed)', async () => {
    render(
      <PortalAuthForm
        authConfig={adminAuthConfig}
        callbackUrl="/admin/feedback"
        initialEmail="founder@acme.com"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /continue with email/i }))
    await screen.findByLabelText(/verification code/i)

    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } })

    await waitFor(() => expect(signInEmailOtpMock).toHaveBeenCalledOnce())
    expect(signInEmailOtpMock).toHaveBeenCalledWith({
      email: 'founder@acme.com',
      otp: '123456',
    })
  })

  it('surfaces the server error message when portal-signin fails', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(500, { error: 'Email not configured' }))
    render(
      <PortalAuthForm
        authConfig={adminAuthConfig}
        callbackUrl="/admin/feedback"
        initialEmail="founder@acme.com"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /continue with email/i }))

    await screen.findByText(/email not configured/i)
    expect(screen.queryByLabelText(/verification code/i)).not.toBeInTheDocument()
  })

  it('surfaces the better-auth error when OTP verification fails', async () => {
    signInEmailOtpMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'Invalid or expired code' },
    })
    render(
      <PortalAuthForm
        authConfig={adminAuthConfig}
        callbackUrl="/admin/feedback"
        initialEmail="founder@acme.com"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /continue with email/i }))
    await screen.findByLabelText(/verification code/i)

    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '999999' } })

    await screen.findByText(/invalid or expired code/i)
  })
})

describe('PortalAuthForm — methods step variants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => cleanup())

  it('does not render the magic-link cross-link when magicLink is off', () => {
    render(
      <PortalAuthForm
        authConfig={{ password: true, magicLink: false }}
        initialEmail="user@example.com"
      />
    )
    expect(
      screen.queryByRole('button', { name: /email me a sign-in link/i })
    ).not.toBeInTheDocument()
  })
})
