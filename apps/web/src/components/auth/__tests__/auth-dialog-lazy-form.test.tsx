// @vitest-environment happy-dom
/**
 * The portal layout mounts the auth dialog on every page, but only a visitor
 * who opens it needs the sign-in form (and the steps it carries), so the form
 * loads when the dialog first opens.
 */
import { useEffect } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

vi.mock('@/lib/client/auth-client', () => ({ signOut: vi.fn() }))
vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({ useAuthBroadcast: vi.fn() }))

let formLoaded = false
vi.mock('../portal-auth-form-inline', () => {
  formLoaded = true
  return { PortalAuthFormInline: () => <div>FORM_BODY</div> }
})

const { AuthDialog } = await import('../auth-dialog')
const { AuthPopoverProvider, useAuthPopover } = await import('../auth-popover-context')

function Opener({ open }: { open: boolean }) {
  const { openAuthPopover } = useAuthPopover()
  useEffect(() => {
    if (open) openAuthPopover({ mode: 'login' })
  }, [openAuthPopover, open])
  return null
}

function renderDialog(open: boolean) {
  return render(
    <IntlProvider locale="en">
      <AuthPopoverProvider>
        <Opener open={open} />
        <AuthDialog />
      </AuthPopoverProvider>
    </IntlProvider>
  )
}

describe('AuthDialog', () => {
  it('loads the sign-in form only when it opens', async () => {
    const { unmount } = renderDialog(false)
    expect(formLoaded).toBe(false)
    unmount()

    renderDialog(true)
    expect(await screen.findByText('FORM_BODY')).toBeInTheDocument()
    expect(formLoaded).toBe(true)
  })
})
