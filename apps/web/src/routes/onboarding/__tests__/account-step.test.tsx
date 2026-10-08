// @vitest-environment happy-dom
/**
 * The first screen a workspace ever shows has to match how that workspace
 * actually lets people sign in, and it has to do something once someone does.
 *
 * Three fixtures, deliberately unalike. A provisioned workspace that arrives
 * with an owner already seeded accepts magic link and social sign-in and
 * refuses passwords; the same workspace provisioned with NO owner recorded,
 * which reads unclaimed while being nobody here's to claim; and an install that
 * starts empty, accepts passwords and has no owner yet. A fixture set where
 * they look the same is what let a hardcoded password form ship onto a
 * workspace that rejects passwords, so the assertions below are written to fail
 * if the screen stops reading the config — including the ones that have to walk
 * the form to its second stage to find out.
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
const track = vi.hoisted(() => vi.fn())
vi.mock('@/lib/client/analytics', () => ({ track }))

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
    // A control plane created this one, so arriving is never how its admin is
    // decided — true whether or not its owner has signed in yet.
    claim: { claimed: true, setupComplete: false, openToClaim: false, closedReason: 'provisioned' },
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
 * The workspace the whole hole was about: provisioned for a customer whose
 * address the provisioning path could not resolve, so no owner was recorded and
 * nobody has ever signed in. It reads unclaimed, and its hostname is one of a
 * guessable set — which is why "unclaimed" alone must not decide this screen.
 */
function provisionedOwnerless(): AccountStepProps {
  const props = provisioned()
  props.claim = {
    claimed: false,
    setupComplete: false,
    openToClaim: false,
    closedReason: 'provisioned',
  }
  return props
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
    claim: { claimed: false, setupComplete: false, openToClaim: true, closedReason: null },
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

  // The arrow is decoration: a screen reader should hear "Continue", not
  // "Continue right arrow".
  it('names the continue button without its arrow', () => {
    renderStep(provisioned())

    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
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
    done.claim = {
      claimed: true,
      setupComplete: true,
      openToClaim: false,
      closedReason: 'provisioned',
    }
    renderStep(done)
    expect(screen.getByRole('link', { name: /request access/i })).toBeInTheDocument()
  })

  it('still refuses passwords when setup is finished', () => {
    const props = provisioned()
    props.claim = {
      claimed: true,
      setupComplete: true,
      openToClaim: false,
      closedReason: 'provisioned',
    }
    const { container } = renderStep(props)

    expect(container.querySelector('input[type="password"]')).toBeNull()
    expect(screen.getByText(/already has an owner/i)).toBeInTheDocument()
  })
})

// The screen and the promoter have to agree. `ensureBootstrapAdmin` refuses to
// promote an arrival on a provisioned workspace, so a screen that still invited
// one to sign up would be advertising a path the server rejects — and, before
// the refusal existed, it was advertising one the server honoured.
describe('account step — a provisioned workspace nobody has claimed', () => {
  it('offers no way to create an account', () => {
    const { container } = renderStep(provisionedOwnerless())

    expect(screen.queryByRole('button', { name: /^create account$/i })).toBeNull()
    expect(container.querySelector('input[type="password"]')).toBeNull()
    // The tell that separates this screen from the first-user one: that screen
    // renders its social tiles in signup mode, this one in login mode.
    expect(screen.queryByRole('button', { name: /sign up with google/i })).toBeNull()
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
  })

  it('says the workspace is not open rather than that it already has an owner', () => {
    const { container } = renderStep(provisionedOwnerless())

    expect(screen.getByText(/created for a specific account/i)).toBeInTheDocument()
    // Nobody has signed in here, so claiming an owner exists would send the
    // customer who is still waiting for their workspace to support.
    expect(screen.queryByText(/already has an owner/i)).toBeNull()
    expect(container.innerHTML).not.toContain(OWNER_EMAIL)
    expect(container.innerHTML).not.toContain('acme.example')
  })
})

// A finished install whose human admins are all gone. The workspace step
// refuses to hand it to anyone, so this screen must not offer a first-user
// signup either, and it must not claim the workspace was made for someone.
describe('account step — a finished install with no admin left', () => {
  function finishedOwnerless(): AccountStepProps {
    const props = selfHosted()
    props.workspaceName = 'Acme'
    props.authConfig.found = true
    props.authConfig.oauth = { ...DEFAULT_AUTH_CONFIG.oauth, google: true }
    props.authConfig.registeredAuthProviders = ['google']
    props.claim = {
      claimed: false,
      setupComplete: true,
      openToClaim: false,
      closedReason: 'setupComplete',
    }
    return props
  }

  it('offers sign-in only and says the workspace is already set up', () => {
    renderStep(finishedOwnerless())

    expect(screen.getByText(/already set up/i)).toBeInTheDocument()
    expect(screen.queryByText(/created for a specific account/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /sign up with google/i })).toBeNull()
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
  })
})

describe('account step — a self-hosted first user', () => {
  function fillAdminForm(values: { name?: string; email?: string; password?: string }) {
    if (values.name !== undefined) {
      fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: values.name } })
    }
    if (values.email !== undefined) {
      fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: values.email } })
    }
    if (values.password !== undefined) {
      fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: values.password } })
    }
  }

  function createAccountButton() {
    return screen.getByRole('button', { name: /^create account$/i })
  }

  it('names the browser tab for the step', () => {
    renderStep(selfHosted())
    expect(document.title).toBe('Create your account · Quackback')
    cleanup()

    renderStep(provisioned())
    expect(document.title).toBe('Sign in · Quackback')
  })

  it('asks for name, email and password in one form', () => {
    const { container } = renderStep(selfHosted())

    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument()
    expect(container.querySelector('input[type="password"]')).not.toBeNull()
    expect(createAccountButton()).toBeInTheDocument()
    // No email-first stage: nobody has an account to look up yet.
    expect(screen.queryByRole('button', { name: /continue/i })).toBeNull()
  })

  // The fixture carries the shipped default, which lists Google and GitHub as
  // on. Before setup nothing has credentials for them, so a tile here is a
  // button that fails.
  it('offers no social sign-up, even when the config turns providers on', () => {
    renderStep(selfHosted())

    expect(screen.queryByRole('button', { name: /google/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /github/i })).toBeNull()
  })

  it('creates the account from the name, email and password given', async () => {
    const { authClient } = await import('@/lib/client/auth-client')
    vi.mocked(authClient.signUp.email).mockResolvedValueOnce({ data: {}, error: null } as never)
    renderStep(selfHosted())

    fillAdminForm({
      name: '  Alex Owner ',
      email: ' alex@acme.example ',
      password: 'correct-horse',
    })
    fireEvent.click(createAccountButton())

    await waitFor(() =>
      expect(authClient.signUp.email).toHaveBeenCalledWith({
        name: 'Alex Owner',
        email: 'alex@acme.example',
        password: 'correct-horse',
      })
    )
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/onboarding' }))
    expect(track).toHaveBeenCalledWith('onboarding_account_created')
  })

  // The name is what customers see on replies and updates; an account created
  // without one shows the address's local part instead.
  it('asks for a name before creating the account', async () => {
    const { authClient } = await import('@/lib/client/auth-client')
    renderStep(selfHosted())

    fillAdminForm({ name: ' ', email: 'alex@acme.example', password: 'correct-horse' })
    fireEvent.click(createAccountButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(/your name/i)
    expect(screen.getByLabelText(/^name$/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/^name$/i)).toHaveFocus()
    expect(authClient.signUp.email).not.toHaveBeenCalled()
  })

  // Each problem sits under the field it is about, all of them at once, so a
  // beginner never has to match a red box to a red field three rows away.
  it('shows every problem under its own field at once', async () => {
    const { authClient } = await import('@/lib/client/auth-client')
    const { container } = renderStep(selfHosted())

    fireEvent.click(createAccountButton())

    const alerts = await screen.findAllByRole('alert')
    expect(alerts).toHaveLength(3)
    for (const [field, text] of [
      ['name', /your name/i],
      ['email', /valid email/i],
      ['password', /at least 8 characters/i],
    ] as const) {
      const input = screen.getByLabelText(new RegExp(`^${field}$`, 'i'))
      expect(input).toHaveAttribute('aria-invalid', 'true')
      const error = alerts.find((alert) => text.test(alert.textContent ?? ''))!
      expect(error).toBeDefined()
      expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(error.id)
      // Directly under its own field, not in a shared slot by the button.
      expect(error.parentElement).toBe(input.closest('[data-field]'))
    }
    // The first field to fix gets focus.
    expect(screen.getByLabelText(/^name$/i)).toHaveFocus()
    // No banner: that is for what the server says.
    expect(container.querySelector('[data-banner]')).toBeNull()
    expect(authClient.signUp.email).not.toHaveBeenCalled()
  })

  it('says the password rule once: the error takes the hint’s place', async () => {
    renderStep(selfHosted())
    const password = screen.getByLabelText(/^password$/i)
    expect(screen.getByText('At least 8 characters.')).toBeInTheDocument()
    expect(password.getAttribute('aria-describedby')).toBe('admin-password-hint')

    fillAdminForm({ name: 'Alex', email: 'alex@acme.example', password: 'short' })
    fireEvent.click(createAccountButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 8 characters/i)
    expect(screen.queryByText('At least 8 characters.')).toBeNull()
    expect(password.getAttribute('aria-describedby')).toBe('admin-password-error')
  })

  it('clears a field’s problem once it is edited', async () => {
    renderStep(selfHosted())
    fireEvent.click(createAccountButton())
    expect(await screen.findAllByRole('alert')).toHaveLength(3)

    fillAdminForm({ name: 'Alex' })

    expect(screen.getAllByRole('alert')).toHaveLength(2)
    expect(screen.getByLabelText(/^name$/i)).not.toHaveAttribute('aria-invalid')
  })

  it('refuses a short password before calling the server', async () => {
    const { authClient } = await import('@/lib/client/auth-client')
    renderStep(selfHosted())

    fillAdminForm({ name: 'Alex', email: 'alex@acme.example', password: 'short' })
    fireEvent.click(createAccountButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 8 characters/i)
    expect(authClient.signUp.email).not.toHaveBeenCalled()
  })

  it('marks Create account busy while the account is created', async () => {
    const { authClient } = await import('@/lib/client/auth-client')
    vi.mocked(authClient.signUp.email).mockReturnValueOnce(new Promise(() => {}) as never)
    renderStep(selfHosted())

    fillAdminForm({ name: 'Alex', email: 'alex@acme.example', password: 'correct-horse' })
    fireEvent.click(createAccountButton())

    const busy = await screen.findByRole('button', { name: /creating account/i })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')
  })

  it('shows the server refusal and stays on the form', async () => {
    const { authClient } = await import('@/lib/client/auth-client')
    vi.mocked(authClient.signUp.email).mockResolvedValueOnce({
      data: null,
      error: { message: 'User already exists. Use another email.' },
    } as never)
    renderStep(selfHosted())

    fillAdminForm({ name: 'Alex', email: 'alex@acme.example', password: 'correct-horse' })
    fireEvent.click(createAccountButton())

    const refusal = await screen.findByRole('alert')
    expect(refusal).toHaveTextContent(/already exists/i)
    // What the server says is not about one field, so it keeps the banner.
    expect(refusal.closest('[data-banner]')).not.toBeNull()
    expect(navigate).not.toHaveBeenCalled()
    expect(createAccountButton()).not.toBeDisabled()
  })

  it('lets the password be shown while it is typed', () => {
    renderStep(selfHosted())
    const password = screen.getByLabelText(/^password$/i)

    expect(password).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: /show password/i }))
    expect(password).toHaveAttribute('type', 'text')
    fireEvent.click(screen.getByRole('button', { name: /hide password/i }))
    expect(password).toHaveAttribute('type', 'password')
  })

  // Created here, then signed out before setup finished: the new-account form
  // would only refuse the address, so there is a way to sign back in with the
  // methods the install takes, providers included.
  it('lets someone who already started setup sign back in', () => {
    const props = selfHosted()
    props.authConfig.signInOAuth = { password: true, github: true }
    renderStep(props)

    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome back')
    expect(screen.getByRole('button', { name: /sign in with github/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^create account$/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /create a new account instead/i }))
    expect(screen.getByRole('button', { name: /^create account$/i })).toBeInTheDocument()
  })

  it('offers to sign in when the address already has an account', async () => {
    const { authClient } = await import('@/lib/client/auth-client')
    vi.mocked(authClient.signUp.email).mockResolvedValueOnce({
      data: null,
      error: { code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', message: 'User already exists.' },
    } as never)
    renderStep(selfHosted())

    fillAdminForm({ name: 'Alex', email: 'alex@acme.example', password: 'correct-horse' })
    fireEvent.click(createAccountButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(/already an account/i)
    fireEvent.click(screen.getByRole('button', { name: /sign in instead/i }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome back')
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

  it('offers no social sign-up when an unclaimed workspace has password off', () => {
    const props = selfHosted()
    props.authConfig.oauth = {
      ...DEFAULT_AUTH_CONFIG.oauth,
      password: false,
      magicLink: true,
      google: true,
    }
    props.authConfig.oidcProviders = [{ id: 'okta', name: 'Okta', logoUrl: null }]
    renderStep(props)

    expect(screen.queryByRole('button', { name: /google/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /github/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /okta/i })).toBeNull()
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument()
  })

  // With neither email method the configured providers are the only way to
  // claim the workspace, so they stay.
  it('keeps the providers when the workspace has no email method at all', () => {
    const props = selfHosted()
    props.authConfig.found = true
    props.authConfig.oauth = { password: false, magicLink: false, google: true }
    props.authConfig.registeredAuthProviders = ['google']
    renderStep(props)

    expect(screen.getByRole('button', { name: /sign up with google/i })).toBeInTheDocument()
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

  it('records an account created only where one is created', async () => {
    renderStep(selfHosted())
    act(() => postAuthSuccess())
    await waitFor(() => expect(track).toHaveBeenCalledWith('onboarding_account_created'))
  })

  // Someone who already started setup signs back in from the first-user
  // screen. No account is created, so the funnel must not count one.
  it('records a returning sign-in from the first-user screen as a sign-in', async () => {
    track.mockClear()
    renderStep(selfHosted())
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    act(() => postAuthSuccess())
    await waitFor(() => expect(track).toHaveBeenCalledWith('onboarding_signed_in'))
    expect(track).not.toHaveBeenCalledWith('onboarding_account_created')
  })

  it('records an owner signing in to a claimed workspace as a sign-in', async () => {
    track.mockClear()
    renderStep(provisioned())
    act(() => postAuthSuccess())
    await waitFor(() => expect(track).toHaveBeenCalledWith('onboarding_signed_in'))
    expect(track).not.toHaveBeenCalledWith('onboarding_account_created')
  })
})
