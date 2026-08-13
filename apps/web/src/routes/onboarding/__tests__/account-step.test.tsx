// @vitest-environment happy-dom
/**
 * The first screen a workspace ever shows has to match how that workspace
 * actually lets people sign in, and it has to do something once someone does.
 *
 * Two fixtures, deliberately unalike. A workspace that arrives with an owner
 * already seeded accepts magic link and social sign-in and refuses passwords;
 * an install that starts empty accepts passwords and has no owner yet. A
 * fixture set where both look the same is what let a hardcoded password form
 * ship onto a workspace that rejects passwords, so the assertions below are
 * written to fail if the screen stops reading the config — including the ones
 * that have to walk the form to its second stage to find out.
 *
 * `PortalAuthFormInline` renders for real here (only its network leaves are
 * stubbed) because the question under test is whether the real config-driven
 * form is the thing deciding, not whether a stand-in was handed the right
 * props. The auth broadcast is real too: it is the seam a completed sign-in
 * actually crosses, and a stubbed one cannot tell a screen that answers from a
 * screen that ignores it.
 */
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render as rtlRender,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { DEFAULT_AUTH_CONFIG } from '@/lib/shared/types/settings'

const navigate = vi.fn()
const invalidate = vi.fn(async () => {})
const lookupFnSpy = vi.fn()

vi.mock('@tanstack/react-start', () => ({ useServerFn: () => lookupFnSpy }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useRouter: () => ({ navigate, invalidate }),
  useNavigate: () => navigate,
}))

vi.mock('@/lib/server/functions/auth', () => ({ lookupAuthMethodsFn: vi.fn() }))

vi.mock('@/lib/client/auth-client', () => ({
  authClient: {
    signIn: { email: vi.fn(), emailOtp: vi.fn(), oauth2: vi.fn(), social: vi.fn() },
    signUp: { email: vi.fn() },
    getSession: vi.fn(),
    requestPasswordReset: vi.fn(),
  },
}))

// Only the popup plumbing is stubbed (it opens real windows and polls timers).
// `useAuthBroadcast` and `postAuthSuccess` stay REAL: they are the mechanism
// under test in the navigation suite below.
vi.mock('@/lib/client/hooks/use-auth-broadcast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client/hooks/use-auth-broadcast')>()),
  usePopupTracker: () => ({
    trackPopup: vi.fn(),
    clearPopup: vi.fn(),
    hasPopup: () => false,
    focusPopup: vi.fn(),
  }),
  openAuthPopup: vi.fn(),
}))

// input-otp schedules real timers on mount; the OTP step is not under test.
vi.mock('@/components/ui/input-otp', () => ({
  InputOTP: (props: Record<string, unknown>) => <input {...(props as object)} />,
  InputOTPGroup: ({ children }: { children?: ReactNode }) => <>{children}</>,
  InputOTPSlot: () => null,
  InputOTPSeparator: () => null,
  InputOTPSixSlots: () => null,
}))

import { AccountStep, type AccountStepProps } from '../-account-step'
import { postAuthSuccess } from '@/lib/client/hooks/use-auth-broadcast'

const OWNER_EMAIL = 'jane.doe@acme.example'

/**
 * The auth config every provisioned workspace is seeded with, transcribed
 * from a live tenant. Password off, magic link on.
 */
const PROVISIONED_OAUTH = {
  google: true,
  github: true,
  password: false,
  magicLink: true,
} as const

function provisioned(): AccountStepProps {
  return {
    ssoEnabled: false,
    claim: { claimed: true, setupComplete: false },
    workspaceName: 'Acme',
    authConfig: {
      found: true,
      oauth: { ...PROVISIONED_OAUTH },
      openSignup: false,
      registeredAuthProviders: ['google', 'github'],
      twoFactorRequired: false,
    },
  }
}

/**
 * A self-hosted install before anyone has signed up: no settings row yet, so
 * the workspace answers with the shipped defaults. Read from the real
 * constant rather than retyped, so a change to the product default shows up
 * here instead of being masked by a copy.
 */
function selfHosted(): AccountStepProps {
  return {
    ssoEnabled: false,
    claim: { claimed: false, setupComplete: false },
    workspaceName: undefined,
    authConfig: {
      found: false,
      oauth: { ...DEFAULT_AUTH_CONFIG.oauth },
      openSignup: DEFAULT_AUTH_CONFIG.openSignup,
      registeredAuthProviders: [],
      twoFactorRequired: false,
    },
  }
}

function renderStep(props: AccountStepProps) {
  return rtlRender(
    <IntlProvider locale="en" defaultLocale="en" messages={{}}>
      <AccountStep {...props} />
    </IntlProvider>
  )
}

/** Walk the form past its email stage, which is where a password field would
 *  appear if the workspace accepted one. */
async function continuePastEmail(email = 'someone@acme.example') {
  lookupFnSpy.mockResolvedValueOnce({ kind: 'methods' })
  fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: email } })
  fireEvent.click(screen.getByRole('button', { name: /continue/i }))
  await waitFor(() => expect(lookupFnSpy).toHaveBeenCalled())
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => cleanup())

describe('account step — a workspace that does not accept passwords', () => {
  it('asks for no password at the first stage', () => {
    const { container } = renderStep(provisioned())

    expect(container.querySelector('input[type="password"]')).toBeNull()
    expect(screen.queryByText(/at least 8 characters/i)).toBeNull()
  })

  // The first stage shows no password box on ANY workspace, so asserting there
  // alone proves nothing about the config. The second stage is where the config
  // decides: `password: true` renders a password field here, `password: false`
  // renders the emailed-link form instead.
  it('never reaches a password field, even after committing to an email', async () => {
    const { container } = renderStep(provisioned())

    await continuePastEmail()

    // The locked email field marks the second stage, and appears whichever
    // method the config sends the user to — so waiting on it does not itself
    // decide the outcome of the assertions below.
    await waitFor(() => expect(container.querySelector('#inline-email-locked')).not.toBeNull())
    expect(container.querySelector('input[type="password"]')).toBeNull()
    expect(screen.queryByRole('button', { name: /^sign in$/i })).toBeNull()
    expect(screen.getByRole('button', { name: /continue with email/i })).toBeInTheDocument()
  })

  it('offers the methods the config does allow', () => {
    renderStep(provisioned())

    // magicLink: true — an email path must be reachable.
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument()
    // google/github: true — both social providers are enabled in the config.
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in with github/i })).toBeInTheDocument()
  })

  it('drops a social button the config turns off', () => {
    const props = provisioned()
    props.authConfig.oauth = { ...PROVISIONED_OAUTH, github: false }
    renderStep(props)

    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in with github/i })).toBeNull()
  })

  it('does not offer to create an account on a workspace that already has an owner', () => {
    renderStep(provisioned())

    expect(screen.queryByRole('button', { name: /^create account$/i })).toBeNull()
  })
})

describe('account step — someone who is not the owner', () => {
  it('says the workspace already has an owner without naming them', () => {
    const { container } = renderStep(provisioned())

    expect(screen.getByText(/already has an owner/i)).toBeInTheDocument()
    expect(screen.getByText(/setup belongs to an existing admin/i)).toBeInTheDocument()
    expect(screen.getByText(/ask them to invite you/i)).toBeInTheDocument()
    // This screen is unauthenticated and its loader data is dehydrated into the
    // SSR document, so ANY form of the owner's address here is published to
    // every visitor: the whole address, its domain, or a masked hint at it.
    expect(container.innerHTML).not.toContain(OWNER_EMAIL)
    expect(container.innerHTML).not.toContain('acme.example')
    expect(container.textContent).not.toMatch(/\*{2,}\s*@/)
  })

  // Before setup finishes, every non-onboarding path is redirected back into
  // the wizard, so a link out would land the visitor on this same screen.
  it('offers the request-access route only once the workspace is reachable', () => {
    renderStep(provisioned())
    expect(screen.queryByRole('link', { name: /request access/i })).toBeNull()
    cleanup()

    const done = provisioned()
    done.claim = { claimed: true, setupComplete: true }
    renderStep(done)
    expect(screen.getByRole('link', { name: /request access/i })).toBeInTheDocument()
  })

  it('still refuses passwords when setup is finished', () => {
    const props = provisioned()
    props.claim = { claimed: true, setupComplete: true }
    const { container } = renderStep(props)

    expect(container.querySelector('input[type="password"]')).toBeNull()
    expect(screen.getByText(/already has an owner/i)).toBeInTheDocument()
  })
})

describe('account step — a self-hosted first user', () => {
  it('keeps the account-creation form when nobody has claimed setup and password is on', () => {
    const { container } = renderStep(selfHosted())

    expect(container.querySelector('input[type="password"]')).toBeInTheDocument()
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/work email/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument()
    expect(screen.queryByText(/already has an owner/i)).toBeNull()
  })

  it('drops the password form when an unclaimed workspace has password off', () => {
    const props = selfHosted()
    props.authConfig.oauth = { ...DEFAULT_AUTH_CONFIG.oauth, password: false, magicLink: true }
    const { container } = renderStep(props)

    expect(container.querySelector('input[type="password"]')).toBeNull()
    // Nobody owns setup yet, so this is still a first-user screen, not a refusal.
    expect(screen.queryByText(/already has an owner/i)).toBeNull()
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument()
  })

  // Nobody has an account on a workspace nobody has claimed, so offering to
  // sign in to one is a lie about what the button does.
  it('offers to sign UP, not in, on a workspace nobody has claimed', () => {
    const props = selfHosted()
    props.authConfig.oauth = {
      ...DEFAULT_AUTH_CONFIG.oauth,
      password: false,
      magicLink: true,
      google: true,
    }
    renderStep(props)

    expect(screen.getByRole('button', { name: /sign up with google/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in with google/i })).toBeNull()
  })

  // `openSignup` governs who may open a PORTAL account. Applied to the first
  // arrival on an unclaimed workspace it refuses the only person who could
  // ever set the workspace up, which is a workspace nobody can rescue.
  it('lets the first user through even when portal sign-ups are closed', async () => {
    const props = selfHosted()
    props.authConfig.oauth = { ...DEFAULT_AUTH_CONFIG.oauth, password: false, magicLink: true }
    props.authConfig.openSignup = false
    renderStep(props)

    await continuePastEmail('first@acme.example')

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /continue with email/i })).toBeInTheDocument()
    )
    expect(screen.queryByText(/sign-ups are off/i)).toBeNull()
  })
})

describe('account step — after a sign-in completes', () => {
  // Every method this screen offers ends the same way: the OAuth popup's
  // callback page broadcasts success and closes, and the in-page password and
  // one-time-code paths broadcast from here. Nothing on this screen answered
  // that broadcast, so a completed Google or GitHub sign-in left the wizard
  // sitting exactly where it was. Only the emailed magic link worked, and only
  // because the browser followed a full-page redirect.
  it('sends the wizard to its router when a sign-in completes elsewhere', async () => {
    renderStep(provisioned())

    act(() => postAuthSuccess())

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/onboarding' }))
    // The router context carries the session the next loader routes on, so it
    // has to be refreshed before the navigation, not after.
    expect(invalidate).toHaveBeenCalled()
    expect(invalidate.mock.invocationCallOrder[0]!).toBeLessThan(
      navigate.mock.invocationCallOrder[0]!
    )
  })

  it('answers on the first-user surface too, not only the claimed one', async () => {
    const props = selfHosted()
    props.authConfig.oauth = { ...DEFAULT_AUTH_CONFIG.oauth, password: false, magicLink: true }
    renderStep(props)

    act(() => postAuthSuccess())

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/onboarding' }))
  })
})
