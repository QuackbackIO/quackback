// @vitest-environment happy-dom
/**
 * What a visitor is told when the workspace has closed self-service signup.
 *
 * `POST /api/auth/portal-signin` answers 200 for every address, whether the
 * workspace will open an account for it or not, because any difference is a
 * free account-existence oracle. The cost of that is a visitor who is refused
 * gets walked to a code-entry screen and waits for mail nobody sent. Their only
 * other signal is the refusal email, and an install with no mail transport
 * sends nothing at all.
 *
 * The fix has to close the dead end without reopening the oracle, so everything
 * asserted here is derived from the WORKSPACE setting and never from the
 * address:
 *
 *  - the closed-signup screen appears for every address in signup mode, and its
 *    copy makes no claim about the address (it used to say "no account found",
 *    which is both a per-address claim and false for anybody who has one);
 *  - the code step carries the same workspace-level note for every address.
 *
 * Two different addresses are driven through each surface and the rendered text
 * compared, so a future narrowing to "only the refused ones" fails here rather
 * than shipping as a helpful-looking improvement.
 */
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

const navigate = vi.fn()
const lookupFnSpy = vi.fn()
vi.mock('@tanstack/react-start', () => ({ useServerFn: () => lookupFnSpy }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useRouter: () => ({ navigate }),
}))

vi.mock('@/lib/server/functions/auth', () => ({ lookupAuthMethodsFn: vi.fn() }))

vi.mock('@/lib/client/auth-client', () => ({
  authClient: {
    signIn: { email: vi.fn(), emailOtp: vi.fn(), oauth2: vi.fn(), social: vi.fn() },
    signUp: { email: vi.fn() },
    requestPasswordReset: vi.fn(),
  },
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
  postAuthError: vi.fn(),
  useAuthBroadcast: vi.fn(),
}))

// input-otp schedules real timers on mount; the code step is a destination
// here, not the subject. `children` is dropped rather than spread: `<input>` is
// a void element, and passing it children throws during render, which unmounts
// the whole tree and leaves an empty document for every assertion below.
vi.mock('@/components/ui/input-otp', () => ({
  InputOTP: ({ children: _children, ...props }: Record<string, unknown>) => (
    <input {...(props as object)} />
  ),
  InputOTPGroup: ({ children }: { children?: ReactNode }) => <>{children}</>,
  InputOTPSlot: () => null,
  InputOTPSeparator: () => null,
  InputOTPSixSlots: () => null,
}))

import { PortalAuthFormInline } from '../portal-auth-form-inline'

/**
 * The workspace answers 200 whatever address is asked about — the property the
 * whole dead end follows from. Modelled rather than stubbed away, so the
 * browser here is in exactly the position it is in production: it has been told
 * nothing.
 */
const uniform200 = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))

/** Magic link only, which is the shape that walks straight to the code step. */
const CLOSED = {
  found: true,
  oauth: { password: false, magicLink: true },
  openSignup: false,
}
const OPEN = { ...CLOSED, openSignup: true }

const HAS_ACCOUNT = 'regular@acme.example'
const STRANGER = 'stranger@evil.example'

function renderForm(props: React.ComponentProps<typeof PortalAuthFormInline>) {
  return rtlRender(
    <IntlProvider locale="en" defaultLocale="en" messages={{}}>
      <PortalAuthFormInline {...props} />
    </IntlProvider>
  )
}

/** Stage 1 → Stage 2 for `email`. */
async function continueWith(email: string): Promise<void> {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } })
  fireEvent.click(screen.getByRole('button', { name: /continue/i }))
  await waitFor(() => expect(lookupFnSpy).toHaveBeenCalled())
}

beforeEach(() => {
  vi.clearAllMocks()
  lookupFnSpy.mockResolvedValue({ kind: 'methods' })
  vi.stubGlobal('fetch', uniform200)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('a workspace that has closed signup — the signup form', () => {
  it('says the accounts are closed, and says nothing about the address', async () => {
    renderForm({ mode: 'signup', authConfig: CLOSED })
    await continueWith(STRANGER)

    const heading = await screen.findByText(/new accounts are closed/i)
    expect(heading).toBeTruthy()
    // The address must appear nowhere in what this screen says: it is the same
    // per-address claim the endpoint refuses to make.
    expect(document.body.textContent).not.toContain(STRANGER)
  })

  it('says the same thing to an address that does hold an account', async () => {
    renderForm({ mode: 'signup', authConfig: CLOSED })
    await continueWith(STRANGER)
    const forStranger = document.body.textContent
    cleanup()

    renderForm({ mode: 'signup', authConfig: CLOSED })
    await continueWith(HAS_ACCOUNT)

    expect(document.body.textContent).toBe(forStranger)
  })

  // The control: with signup open, the same address reaches the ordinary form.
  it('does not show the closed screen when signup is open', async () => {
    renderForm({ mode: 'signup', authConfig: OPEN })
    await continueWith(STRANGER)

    expect(screen.queryByText(/new accounts are closed/i)).toBeNull()
  })
})

describe('a workspace that has closed signup — the code step', () => {
  async function reachCodeStep(email: string, authConfig: typeof CLOSED): Promise<void> {
    renderForm({ mode: 'login', authConfig })
    await continueWith(email)
    fireEvent.click(screen.getByRole('button', { name: /continue with email/i }))
    await waitFor(() => expect(uniform200).toHaveBeenCalled())
    await screen.findByRole('button', { name: /verify code/i })
  }

  // The dead end itself: sign-in mode, a workspace that will refuse, and a
  // person who would otherwise sit on this screen with no idea why nothing
  // arrives.
  it('explains why no code may arrive', async () => {
    await reachCodeStep(STRANGER, CLOSED)

    expect(await screen.findByText(/not accepting new accounts/i)).toBeTruthy()
  })

  // Address-independent, asserted rather than assumed: the note is on the
  // screen for somebody who certainly will get a code too.
  it('says it to an address that does hold an account as well', async () => {
    await reachCodeStep(HAS_ACCOUNT, CLOSED)

    expect(await screen.findByText(/not accepting new accounts/i)).toBeTruthy()
  })

  // The control: a workspace that accepts new accounts has nothing to explain,
  // so the note is a statement about the setting rather than decoration.
  it('says nothing extra when signup is open', async () => {
    await reachCodeStep(STRANGER, OPEN)

    expect(screen.queryByText(/not accepting new accounts/i)).toBeNull()
  })
})
