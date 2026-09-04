// @vitest-environment happy-dom
import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

// signOut is what the abandon path must call when closing mid-2FA.
const mockSignOut = vi.fn()
vi.mock('@/lib/client/auth-client', () => ({ signOut: mockSignOut }))

vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({ useAuthBroadcast: vi.fn() }))

// Stub the form: report a configurable step on mount so we can drive the
// dialog's formContext without the real sign-in flow, and record the props the
// dialog hands it (mode / onModeSwitch) for the collapse-signup assertions.
let stepToReport = 'credentials'
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
    }, [onContextChange])
    return <div>FORM_BODY</div>
  },
}))

const { AuthDialog } = await import('../auth-dialog')
const { AuthPopoverProvider, useAuthPopover } = await import('../auth-popover-context')

function Opener({ mode = 'login' as 'login' | 'signup' }) {
  const { openAuthPopover } = useAuthPopover()
  useEffect(() => {
    openAuthPopover({ mode })
  }, [openAuthPopover, mode])
  return null
}

function renderDialog(opts?: {
  mode?: 'login' | 'signup'
  authConfig?: React.ComponentProps<typeof AuthDialog>['authConfig']
}) {
  return render(
    <IntlProvider locale="en">
      <AuthPopoverProvider>
        <Opener mode={opts?.mode ?? 'login'} />
        <AuthDialog authConfig={opts?.authConfig} />
      </AuthPopoverProvider>
    </IntlProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  stepToReport = 'credentials'
  lastFormProps = {}
  mockSignOut.mockResolvedValue(undefined) // the abandon path calls .catch()
})

describe('AuthDialog — abandon during required 2FA', () => {
  it('signs out when the dialog is closed mid 2FA enrollment', async () => {
    stepToReport = 'two-factor-enroll'
    renderDialog()
    await screen.findByText('FORM_BODY')

    fireEvent.click(screen.getByRole('button', { name: /close/i }))

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1))
  })

  it('does NOT sign out when closing from a normal step', async () => {
    stepToReport = 'credentials'
    renderDialog()
    await screen.findByText('FORM_BODY')

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
