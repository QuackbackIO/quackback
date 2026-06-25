// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// GateCard re-evaluates access via the router after sign-in.
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}))

// GateCard invalidates portal queries on sign-out.
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

// GateCard listens for cross-tab auth broadcasts.
vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({
  useAuthBroadcast: vi.fn(),
}))

// GateCard imports signOut for the "unauthorized" branch + 2FA-abandon revoke.
vi.mock('@/lib/client/auth-client', () => ({
  signOut: vi.fn(),
}))

// The form body pulls in the full auth flow (server fns, auth client, OTP).
// The intl regression lives in the gate's own header copy, so stub the body.
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
  // throw), which skips the loader that mounts PortalIntlProvider. The inline
  // auth form's header renders <FormattedMessage>, so without the gate's own
  // intl context it would throw "Could not find required `intl` object" and
  // crash the whole gate. The gate must provide its own intl context.
  it('renders the inline form with localized private-portal copy and no intl crash', () => {
    renderGate()

    // Private-portal framing (surface switch) proves useIntl() resolved.
    expect(screen.getByText(/sign in to access acme corp/i)).toBeInTheDocument()
    expect(screen.getByText(/this portal is private/i)).toBeInTheDocument()
    // The form is shown directly — no intermediate "Sign in / Register" button.
    expect(screen.getByTestId('auth-form-body')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in \/ register/i })).not.toBeInTheDocument()
  })
})
