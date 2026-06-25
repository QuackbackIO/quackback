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
// dialog's formContext without the real sign-in flow.
let stepToReport = 'credentials'
vi.mock('../portal-auth-form-inline', () => ({
  PortalAuthFormInline: ({
    onContextChange,
  }: {
    onContextChange?: (c: { step: string; email: string }) => void
  }) => {
    useEffect(() => {
      onContextChange?.({ step: stepToReport, email: '' })
    }, [onContextChange])
    return <div>FORM_BODY</div>
  },
}))

const { AuthDialog } = await import('../auth-dialog')
const { AuthPopoverProvider, useAuthPopover } = await import('../auth-popover-context')

function Opener() {
  const { openAuthPopover } = useAuthPopover()
  useEffect(() => {
    openAuthPopover({ mode: 'login' })
  }, [openAuthPopover])
  return null
}

function renderDialog() {
  return render(
    <IntlProvider locale="en">
      <AuthPopoverProvider>
        <Opener />
        <AuthDialog />
      </AuthPopoverProvider>
    </IntlProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  stepToReport = 'credentials'
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
