// @vitest-environment happy-dom
import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { PortalWordsIntl } from '@/lib/client/hooks/use-intl-setup'

// signOut is what the abandon path must call when closing mid-2FA.
const mockSignOut = vi.fn()
// The session as another tab may have left it.
const mockGetSession = vi.fn()
vi.mock('@/lib/client/auth-client', () => ({
  signOut: mockSignOut,
  authClient: { getSession: mockGetSession },
}))

const mockPostAuthSuccess = vi.fn()
vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  useAuthBroadcast: vi.fn(),
  postAuthSuccess: mockPostAuthSuccess,
}))

// Stub the form: report a configurable step on mount so we can drive the
// dialog's formContext without the real sign-in flow, and record the props the
// dialog hands it (mode / onModeSwitch) for the collapse-signup assertions.
let stepToReport = 'credentials'
let reportedStep: string | null = null
let lastFormProps: { mode?: string; onModeSwitch?: unknown } = {}
vi.mock('../portal-auth-form-inline', () => ({
  PortalAuthFormInline: ({
    onContextChange,
    mode,
    onModeSwitch,
  }: {
    onContextChange?: (c: { step: string; email: string }) => void
    mode?: string
    onModeSwitch?: unknown
  }) => {
    lastFormProps = { mode, onModeSwitch }
    useEffect(() => {
      onContextChange?.({ step: stepToReport, email: '' })
      reportedStep = stepToReport
    }, [onContextChange])
    return <div>FORM_BODY</div>
  },
}))

const { AuthDialog } = await import('../auth-dialog')
const { AuthPopoverProvider, useAuthPopover } = await import('../auth-popover-context')

function Opener({
  mode = 'login' as 'login' | 'signup',
  callbackUrl,
  description,
}: {
  mode?: 'login' | 'signup'
  callbackUrl?: string
  description?: string
}) {
  const { openAuthPopover } = useAuthPopover()
  useEffect(() => {
    openAuthPopover({ mode, callbackUrl, ...(description ? { description } : {}) })
  }, [openAuthPopover, mode, callbackUrl, description])
  return null
}

function renderDialog(opts?: {
  mode?: 'login' | 'signup'
  authConfig?: React.ComponentProps<typeof AuthDialog>['authConfig']
  callbackUrl?: string
  workspaceName?: string
  description?: string
}) {
  return render(
    <IntlProvider locale="en">
      <PortalWordsIntl>
        <AuthPopoverProvider>
          <Opener
            mode={opts?.mode ?? 'login'}
            callbackUrl={opts?.callbackUrl}
            description={opts?.description}
          />
          <AuthDialog authConfig={opts?.authConfig} workspaceName={opts?.workspaceName} />
        </AuthPopoverProvider>
      </PortalWordsIntl>
    </IntlProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  stepToReport = 'credentials'
  reportedStep = null
  lastFormProps = {}
  mockSignOut.mockResolvedValue(undefined) // the abandon path calls .catch()
  mockGetSession.mockResolvedValue({ data: null, error: null })
})

describe('AuthDialog — abandon during required 2FA', () => {
  it('signs out when the dialog is closed mid 2FA enrollment', async () => {
    stepToReport = 'two-factor-enroll'
    renderDialog()
    await screen.findByText('FORM_BODY')
    // The form loads on open; close only once it has reported its step.
    await waitFor(() => expect(reportedStep).toBe('two-factor-enroll'))

    fireEvent.click(screen.getByRole('button', { name: /close/i }))

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1))
  })

  it('does NOT sign out when closing from a normal step', async () => {
    stepToReport = 'credentials'
    renderDialog()
    await screen.findByText('FORM_BODY')
    await waitFor(() => expect(reportedStep).toBe('credentials'))

    fireEvent.click(screen.getByRole('button', { name: /close/i }))

    await waitFor(() => expect(screen.queryByText('FORM_BODY')).not.toBeInTheDocument())
    expect(mockSignOut).not.toHaveBeenCalled()
  })
})

describe('AuthDialog — collapses sign-up when there is no distinct flow', () => {
  it('keeps signup mode + the switch link when password auth is on', async () => {
    renderDialog({ mode: 'signup', authConfig: { found: true, oauth: { password: true } } })
    await screen.findByText('FORM_BODY')

    expect(screen.getByText(/create an account/i)).toBeInTheDocument()
    expect(lastFormProps.mode).toBe('signup')
    expect(lastFormProps.onModeSwitch).toBeTypeOf('function')
  })

  it('forces login mode and drops the switch link when password auth is off', async () => {
    renderDialog({
      mode: 'signup',
      authConfig: { found: true, oauth: { password: false, magicLink: true } },
    })
    await screen.findByText('FORM_BODY')

    // Header shows the login copy, not "Create an account".
    expect(screen.getByText(/welcome back/i)).toBeInTheDocument()
    expect(screen.queryByText(/create an account/i)).toBeNull()
    expect(lastFormProps.mode).toBe('login')
    expect(lastFormProps.onModeSwitch).toBeUndefined()
  })

  it('also collapses when password is on but self-service signup is closed', async () => {
    renderDialog({
      mode: 'signup',
      authConfig: { found: true, oauth: { password: true }, openSignup: false },
    })
    await screen.findByText('FORM_BODY')

    expect(lastFormProps.mode).toBe('login')
    expect(lastFormProps.onModeSwitch).toBeUndefined()
  })
})

describe('AuthDialog: team sign-in', () => {
  it('speaks to the team when the destination is an admin page', async () => {
    renderDialog({ callbackUrl: '/admin/inbox?c=conv_1', workspaceName: 'Acme' })
    await screen.findByText('FORM_BODY')

    expect(screen.getByRole('heading', { name: 'Sign in to Acme admin' })).toBeTruthy()
    expect(screen.getByText(/For the Acme team/)).toBeTruthy()
    expect(screen.queryByText(/vote and comment/)).toBeNull()
    expect(screen.getByRole('link', { name: /Go to the Acme portal/ }).getAttribute('href')).toBe(
      '/'
    )
  })

  it('keeps the customer copy for a portal destination', async () => {
    renderDialog({ callbackUrl: '/b/roadmap', workspaceName: 'Acme' })
    await screen.findByText('FORM_BODY')

    expect(screen.getByText('Sign in to vote and comment on ideas.')).toBeTruthy()
    expect(screen.queryByText(/Acme admin/)).toBeNull()
  })
})

describe('AuthDialog: why the visitor is signing in', () => {
  it("says the opener's reason in place of the vote-and-comment line", async () => {
    renderDialog({ description: 'Sign in to get status updates by email.' })
    await screen.findByText('FORM_BODY')

    expect(screen.getByText('Sign in to get status updates by email.')).toBeTruthy()
    expect(screen.queryByText(/vote and comment/)).toBeNull()
  })

  it("keeps a step's own line once the form moves on", async () => {
    stepToReport = 'code'
    renderDialog({ description: 'Sign in to get status updates by email.' })
    await screen.findByText('FORM_BODY')
    await waitFor(() => expect(reportedStep).toBe('code'))

    expect(screen.getByRole('heading', { name: 'Check your email' })).toBeTruthy()
    expect(screen.queryByText('Sign in to get status updates by email.')).toBeNull()
  })

  it('forgets the reason once closed, so the next opener gets the default line', async () => {
    function Reopen() {
      const { openAuthPopover, closeAuthPopover } = useAuthPopover()
      return (
        <>
          <button
            type="button"
            onClick={() =>
              openAuthPopover({ mode: 'login', description: 'Sign in to get status updates.' })
            }
          >
            open-with-reason
          </button>
          <button type="button" onClick={() => closeAuthPopover()}>
            close-it
          </button>
          <button type="button" onClick={() => openAuthPopover({ mode: 'login' })}>
            open-plain
          </button>
        </>
      )
    }
    render(
      <IntlProvider locale="en">
        <PortalWordsIntl>
          <AuthPopoverProvider>
            <Reopen />
            <AuthDialog />
          </AuthPopoverProvider>
        </PortalWordsIntl>
      </IntlProvider>
    )
    fireEvent.click(screen.getByText('open-with-reason'))
    expect(await screen.findByText('Sign in to get status updates.')).toBeTruthy()
    fireEvent.click(screen.getByText('close-it'))
    fireEvent.click(screen.getByText('open-plain'))
    expect(await screen.findByText('Sign in to vote and comment on ideas.')).toBeTruthy()
  })
})

describe('AuthDialog: the emailed link opened in another tab', () => {
  async function waitingOnTheCode() {
    stepToReport = 'code'
    renderDialog()
    await screen.findByText('FORM_BODY')
    await waitFor(() => expect(reportedStep).toBe('code'))
  }

  it('finishes the sign-in when the visitor comes back signed in', async () => {
    await waitingOnTheCode()
    mockGetSession.mockResolvedValue({
      data: { user: { id: 'user_1', isAnonymous: false }, session: {} },
      error: null,
    })

    document.dispatchEvent(new Event('visibilitychange'))

    // The same announcement a sign-in in this tab makes, which closes the
    // dialog and runs its onSuccess.
    await waitFor(() => expect(mockPostAuthSuccess).toHaveBeenCalledTimes(1))
  })

  it('keeps waiting while the session is still signed out or anonymous', async () => {
    await waitingOnTheCode()
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(mockGetSession).toHaveBeenCalledTimes(1))

    mockGetSession.mockResolvedValue({
      data: { user: { id: 'anon_1', isAnonymous: true }, session: {} },
      error: null,
    })
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(mockGetSession).toHaveBeenCalledTimes(2))

    expect(mockPostAuthSuccess).not.toHaveBeenCalled()
  })

  it('does not ask before an email has been sent', async () => {
    renderDialog()
    await screen.findByText('FORM_BODY')
    await waitFor(() => expect(reportedStep).toBe('credentials'))

    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))

    expect(mockGetSession).not.toHaveBeenCalled()
  })
})
