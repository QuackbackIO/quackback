// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

// GateCard re-evaluates access via the router after sign-in.
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}))

// GateCard invalidates portal queries on sign-out.
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

// GateCard + AuthDialog listen for cross-tab auth broadcasts.
vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  useAuthBroadcast: vi.fn(),
}))

// GateCard imports signOut for the "unauthorized" branch.
vi.mock('@/lib/client/auth-client', () => ({
  signOut: vi.fn(),
}))

// The dialog body pulls in the full auth form (server fns, auth client, OTP).
// The intl regression lives in AuthDialog's own header, so stub the body to a
// trivial node that still proves the dialog opened.
vi.mock('@/components/auth/portal-auth-form-inline', () => ({
  PortalAuthFormInline: () => <div data-testid="auth-form-body" />,
}))

import { PortalAccessGate } from '../portal-access-gate'

const authConfig = { found: true, oauth: { password: true, magicLink: true } }

function renderGate() {
  return render(
    <PortalAccessGate
      reason="unauthenticated"
      workspaceName="Acme Corp"
      logoUrl={null}
      authConfig={authConfig}
      themeStyles=""
      customCss=""
      userEmail={null}
    />
  )
}

describe('PortalAccessGate — IntlProvider regression', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  // The private-portal gate renders on the route's *error* path (a beforeLoad
  // throw), which skips the loader that mounts PortalIntlProvider. Opening the
  // sign-in dialog therefore rendered <FormattedMessage> (AuthDialog's header)
  // with no IntlProvider ancestor, throwing "Could not find required `intl`
  // object" and crashing the whole gate. The gate must provide its own intl
  // context so its auth dialog renders.
  it('renders the sign-in dialog without an intl-provider crash', () => {
    renderGate()

    fireEvent.click(screen.getByRole('button', { name: /sign in \/ register/i }))

    // The localized dialog title (defaultMessage) proving useIntl() resolved.
    expect(screen.getByText(/welcome back/i)).toBeInTheDocument()
    expect(screen.getByTestId('auth-form-body')).toBeInTheDocument()
  })
})
