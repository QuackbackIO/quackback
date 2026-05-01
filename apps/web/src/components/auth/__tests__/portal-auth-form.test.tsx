// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('@/lib/client/auth-client', () => ({
  authClient: {
    signIn: {
      email: vi.fn(),
      magicLink: vi.fn(),
      emailOtp: vi.fn(),
    },
    signUp: { email: vi.fn() },
    emailOtp: { sendVerificationOtp: vi.fn() },
    requestPasswordReset: vi.fn(),
  },
}))

// OAuth buttons reach into broadcast/popup hooks that aren't relevant
// to the email-only auth flows we're testing — stub the whole module
// so the form renders without those side effects.
vi.mock('../oauth-buttons', () => ({
  OAuthButtons: () => null,
  getEnabledOAuthProviders: () => [],
}))

import { PortalAuthForm } from '../portal-auth-form'
import { authClient } from '@/lib/client/auth-client'

const signInMagicLinkMock = authClient.signIn.magicLink as ReturnType<typeof vi.fn>
const sendVerificationOtpMock = authClient.emailOtp.sendVerificationOtp as ReturnType<typeof vi.fn>

describe('PortalAuthForm — admin login (magicLink + OTP enabled, password disabled)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signInMagicLinkMock.mockResolvedValue({ data: {}, error: null })
    sendVerificationOtpMock.mockResolvedValue({ data: {}, error: null })
  })
  afterEach(() => cleanup())

  // Mirrors what `apps/web/src/routes/admin.login.tsx` passes today:
  // magicLink + email OTP both available, password explicitly off,
  // OAuth providers empty (would only render if DB credentials
  // configured — outside this test's scope).
  const adminAuthConfig = { magicLink: true, email: true, password: false }

  it('starts on the email step with the magic-link primary button', () => {
    render(<PortalAuthForm authConfig={adminAuthConfig} callbackUrl="/admin/feedback" />)
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /email me a sign-in link/i })).toBeInTheDocument()
    // OTP fallback is a text-button, not a primary action
    expect(screen.getByRole('button', { name: /6-digit code/i })).toBeInTheDocument()
  })

  it('submitting email triggers signIn.magicLink with the callback URL', async () => {
    render(<PortalAuthForm authConfig={adminAuthConfig} callbackUrl="/admin/feedback" />)
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'founder@acme.com' } })
    fireEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }))

    await waitFor(() => expect(signInMagicLinkMock).toHaveBeenCalledOnce())
    expect(signInMagicLinkMock).toHaveBeenCalledWith({
      email: 'founder@acme.com',
      callbackURL: '/admin/feedback',
    })
    // OTP path must NOT have fired
    expect(sendVerificationOtpMock).not.toHaveBeenCalled()
  })

  it('after a successful send, shows the link-sent confirmation with the email', async () => {
    render(<PortalAuthForm authConfig={adminAuthConfig} callbackUrl="/admin/feedback" />)
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'founder@acme.com' } })
    fireEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }))

    await screen.findByText(/check your email/i)
    expect(screen.getByText('founder@acme.com')).toBeInTheDocument()
    // Recovery affordance: "Use a different email" must always be reachable
    expect(screen.getByRole('button', { name: /use a different email/i })).toBeInTheDocument()
  })

  it('OTP fallback button on the email step sends a 6-digit code instead', async () => {
    render(<PortalAuthForm authConfig={adminAuthConfig} callbackUrl="/admin/feedback" />)
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'founder@acme.com' } })
    fireEvent.click(screen.getByRole('button', { name: /6-digit code/i }))

    await waitFor(() => expect(sendVerificationOtpMock).toHaveBeenCalledOnce())
    expect(sendVerificationOtpMock).toHaveBeenCalledWith({
      email: 'founder@acme.com',
      type: 'sign-in',
    })
    // Magic-link must NOT have fired on the fallback path
    expect(signInMagicLinkMock).not.toHaveBeenCalled()
  })

  it('surfaces the better-auth error message when sendMagicLink fails', async () => {
    signInMagicLinkMock.mockResolvedValueOnce({ data: null, error: { message: 'Rate limited' } })
    render(<PortalAuthForm authConfig={adminAuthConfig} callbackUrl="/admin/feedback" />)
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'founder@acme.com' } })
    fireEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }))

    await screen.findByText(/rate limited/i)
    // Stay on the email step so the user can try a different email or fall back to OTP
    expect(screen.queryByText(/check your email/i)).not.toBeInTheDocument()
  })

  it('rejects empty-email submit without calling the magic-link API', async () => {
    render(<PortalAuthForm authConfig={adminAuthConfig} callbackUrl="/admin/feedback" />)
    fireEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }))

    await screen.findByText(/email is required/i)
    expect(signInMagicLinkMock).not.toHaveBeenCalled()
  })
})

describe('PortalAuthForm — portal login (password + OAuth, magicLink off)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendVerificationOtpMock.mockResolvedValue({ data: {}, error: null })
  })
  afterEach(() => cleanup())

  it('does not render the magic-link button when magicLink is off', () => {
    render(<PortalAuthForm authConfig={{ password: true, email: false, magicLink: false }} />)
    expect(
      screen.queryByRole('button', { name: /email me a sign-in link/i })
    ).not.toBeInTheDocument()
  })

  it('falls back to OTP-only when only email is enabled', async () => {
    render(<PortalAuthForm authConfig={{ password: false, email: true, magicLink: false }} />)
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.c' } })
    // Without magicLink, the primary button is the OTP send button
    fireEvent.click(screen.getByRole('button', { name: /continue with email/i }))
    await waitFor(() => expect(sendVerificationOtpMock).toHaveBeenCalledOnce())
  })
})
