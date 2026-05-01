// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('@/lib/client/auth-client', () => ({
  authClient: {
    signIn: {
      email: vi.fn(),
      emailOtp: vi.fn(),
    },
    signUp: { email: vi.fn() },
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

const signInEmailOtpMock = authClient.signIn.emailOtp as ReturnType<typeof vi.fn>

// Mock fetch globally; per-test override the response.
const fetchMock = vi.fn()
beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
})
afterEach(() => {
  fetchMock.mockReset()
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

describe('PortalAuthForm — admin login (magicLink only, password disabled)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signInEmailOtpMock.mockResolvedValue({ data: {}, error: null })
    fetchMock.mockResolvedValue(okResponse())
  })
  afterEach(() => cleanup())

  // Mirrors what `apps/web/src/routes/admin.login.tsx` passes today:
  // magicLink the only email-based auth, password explicitly off,
  // OAuth providers empty.
  const adminAuthConfig = { magicLink: true, password: false }

  it('starts on the email step with the Continue with email button', () => {
    render(<PortalAuthForm authConfig={adminAuthConfig} callbackUrl="/admin/feedback" />)
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue with email/i })).toBeInTheDocument()
  })

  it('submitting email POSTs to /api/auth/portal-signin and flips to the code step', async () => {
    render(<PortalAuthForm authConfig={adminAuthConfig} callbackUrl="/admin/feedback" />)
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'founder@acme.com' } })
    fireEvent.click(screen.getByRole('button', { name: /continue with email/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/portal-signin',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'founder@acme.com', callbackURL: '/admin/feedback' }),
      })
    )

    // The form flips to the code step
    await screen.findByText(/we sent a 6-digit code to/i)
    expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument()
    expect(screen.getByText('founder@acme.com')).toBeInTheDocument()
    expect(screen.getByText(/sign-in link in your email also works/i)).toBeInTheDocument()
  })

  it('auto-submits when 6 digits are entered (no manual button click needed)', async () => {
    render(<PortalAuthForm authConfig={adminAuthConfig} callbackUrl="/admin/feedback" />)
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'founder@acme.com' } })
    fireEvent.click(screen.getByRole('button', { name: /continue with email/i }))
    await screen.findByLabelText(/verification code/i)

    // Typing 6 digits should trigger onComplete → verifyCode without
    // needing to click the Verify button.
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } })

    await waitFor(() => expect(signInEmailOtpMock).toHaveBeenCalledOnce())
    expect(signInEmailOtpMock).toHaveBeenCalledWith({
      email: 'founder@acme.com',
      otp: '123456',
    })
  })

  it('surfaces the server error message when portal-signin fails', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(500, { error: 'Email not configured' }))
    render(<PortalAuthForm authConfig={adminAuthConfig} callbackUrl="/admin/feedback" />)
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'founder@acme.com' } })
    fireEvent.click(screen.getByRole('button', { name: /continue with email/i }))

    await screen.findByText(/email not configured/i)
    // Stay on the email step
    expect(screen.queryByLabelText(/verification code/i)).not.toBeInTheDocument()
  })

  it('surfaces the better-auth error when OTP verification fails', async () => {
    signInEmailOtpMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'Invalid or expired code' },
    })
    render(<PortalAuthForm authConfig={adminAuthConfig} callbackUrl="/admin/feedback" />)
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'founder@acme.com' } })
    fireEvent.click(screen.getByRole('button', { name: /continue with email/i }))
    await screen.findByLabelText(/verification code/i)

    // Auto-submit fires on 6th digit; error message bubbles up
    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '999999' } })

    await screen.findByText(/invalid or expired code/i)
  })

  it('rejects empty-email submit without calling the signin endpoint', async () => {
    render(<PortalAuthForm authConfig={adminAuthConfig} callbackUrl="/admin/feedback" />)
    fireEvent.click(screen.getByRole('button', { name: /continue with email/i }))

    await screen.findByText(/email is required/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('PortalAuthForm — portal login (password + OAuth, magicLink off)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => cleanup())

  it('does not render the "Sign in with email instead" link when magicLink is off', () => {
    render(<PortalAuthForm authConfig={{ password: true, magicLink: false }} />)
    expect(
      screen.queryByRole('button', { name: /sign in with email instead/i })
    ).not.toBeInTheDocument()
  })
})
