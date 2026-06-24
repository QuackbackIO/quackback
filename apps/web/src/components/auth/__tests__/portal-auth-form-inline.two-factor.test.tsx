// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

// --- Mocks ---

// lookupAuthMethods (Stage 1 → Stage 2 transition)
const lookupFnSpy = vi.fn()
vi.mock('@tanstack/react-start', () => ({ useServerFn: () => lookupFnSpy }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useRouter: () => ({ navigate: vi.fn() }),
}))

vi.mock('@/lib/server/functions/auth', () => ({
  lookupAuthMethodsFn: vi.fn(),
}))

const mockSignInEmail = vi.fn()
const mockSignOut = vi.fn()
vi.mock('@/lib/client/auth-client', () => ({
  authClient: {
    signIn: { email: mockSignInEmail, oauth2: vi.fn() },
    signOut: mockSignOut,
    signUp: { email: vi.fn() },
    requestPasswordReset: vi.fn(),
  },
}))

vi.mock('../two-factor-enroll-steps', () => ({
  TwoFactorEnrollSteps: () => <div>ENROLL_STEPS</div>,
}))
vi.mock('../two-factor-challenge-step', () => ({
  TwoFactorChallengeStep: () => <div>CHALLENGE_STEP</div>,
}))

vi.mock('@/components/auth/oauth-buttons', () => ({
  getEnabledOAuthProviders: () => [],
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
}))

vi.mock('@/components/ui/input-otp', () => ({
  InputOTP: (props: Record<string, unknown>) => <input {...(props as object)} />,
  InputOTPGroup: ({ children }: { children?: ReactNode }) => <>{children}</>,
  InputOTPSlot: () => null,
  InputOTPSeparator: () => null,
}))

const { PortalAuthFormInline } = await import('../portal-auth-form-inline')

function renderForm(twoFactorRequired: boolean) {
  return render(
    <IntlProvider locale="en">
      <PortalAuthFormInline
        mode="login"
        invitationId={null}
        authConfig={{ found: true, oauth: { password: true }, twoFactorRequired }}
        callbackUrl="/admin"
      />
    </IntlProvider>
  )
}

/** Advance past the email stage (Stage 1) into the credentials form (Stage 2). */
async function fillEmailAndContinue() {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'demo@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: /continue/i }))
  // Wait for the async lookup to resolve and Stage 2 to render
  await screen.findByLabelText(/password/i)
}

/** Fill the password field and click Sign in. */
async function fillPasswordAndSubmit() {
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password1234' } })
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  // Stage 1 → Stage 2: resolve with the standard password-methods result.
  lookupFnSpy.mockResolvedValue({
    kind: 'methods',
    authConfig: { password: true },
    ssoEnabled: false,
  })
})

describe('PortalAuthFormInline — inline 2FA', () => {
  it('shows the challenge step when better-auth returns twoFactorRedirect', async () => {
    mockSignInEmail.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null })
    renderForm(true)
    await fillEmailAndContinue()
    await fillPasswordAndSubmit()
    expect(await screen.findByText('CHALLENGE_STEP')).toBeInTheDocument()
  })

  it('shows enrollment when a full session is returned under a 2FA-required workspace', async () => {
    mockSignInEmail.mockResolvedValue({ data: { user: {} }, error: null })
    renderForm(true)
    await fillEmailAndContinue()
    await fillPasswordAndSubmit()
    expect(await screen.findByText('ENROLL_STEPS')).toBeInTheDocument()
  })

  it('does not show 2FA UI when the workspace does not require it', async () => {
    mockSignInEmail.mockResolvedValue({ data: { user: {} }, error: null })
    renderForm(false)
    await fillEmailAndContinue()
    await fillPasswordAndSubmit()
    await waitFor(() => expect(mockSignInEmail).toHaveBeenCalled())
    expect(screen.queryByText('ENROLL_STEPS')).not.toBeInTheDocument()
    expect(screen.queryByText('CHALLENGE_STEP')).not.toBeInTheDocument()
  })
})
