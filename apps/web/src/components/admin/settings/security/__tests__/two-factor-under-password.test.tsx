// @vitest-environment happy-dom
/**
 * Verifies that the "Require two-factor authentication" toggle is rendered
 * inside <SignInProvidersTab> (nested under the Password row) — not in
 * the deleted <TeamAuthMethodsSection>.
 *
 * - When password is ON  → 2FA switch is enabled.
 * - When password is OFF → 2FA switch is disabled (TOTP enrolls on top
 *   of a password; no password means no viable 2FA flow).
 *
 * Recovery codes now live inside <IdentityProvidersSection> (the SSO card),
 * which is stubbed here, so this file no longer asserts their placement.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SignInProvidersTab } from '../sign-in-providers-tab'
import type { AuthConfig, PortalAuthMethods } from '@/lib/shared/types/settings'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouteContext: () => ({ managedFieldPaths: [] }),
}))

vi.mock('@/lib/server/functions/settings', () => ({
  updateAuthConfigFn: vi.fn(),
  updatePortalConfigFn: vi.fn(),
}))

// Heavy async sections — stub out to keep this test focused on the
// Password / 2FA area.
vi.mock('@/components/admin/settings/security/identity-providers/provider-list', () => ({
  IdentityProvidersSection: () => <div data-testid="identity-providers-section" />,
}))

vi.mock('@/components/admin/settings/auth-shared/oauth-provider-grid', () => ({
  OAuthProviderGrid: () => <div data-testid="oauth-provider-grid" />,
}))

const baseTeamAuth: AuthConfig = {
  oauth: { password: true, magicLink: false, google: false, github: false },
  openSignup: false,
}

const basePortalOauth: PortalAuthMethods = { password: true }

function renderTab(teamAuth: AuthConfig, portalOauth: PortalAuthMethods = basePortalOauth) {
  const qc = new QueryClient()
  // The tab reads the identity-providers suspense query for its method count.
  qc.setQueryData(['settings', 'identityProviders'], [])
  return render(
    <QueryClientProvider client={qc}>
      <SignInProvidersTab
        initialTeamAuthConfig={teamAuth}
        initialPortalOauth={portalOauth}
        credentialStatus={{ _emailConfigured: true }}
        customOidcProviderTier={false}
      />
    </QueryClientProvider>
  )
}

describe('2FA nested under Password in <SignInProvidersTab>', () => {
  it('renders the "Require two-factor authentication" row when password is enabled', () => {
    renderTab(baseTeamAuth)
    expect(screen.getByText(/require two-factor authentication/i)).toBeInTheDocument()
  })

  it('2FA switch is enabled when password is on', () => {
    renderTab({ ...baseTeamAuth, twoFactor: { required: false } })
    // Find the switch next to the 2FA label. The Password switch comes
    // first, then the 2FA switch directly after it in DOM order.
    const switches = screen.getAllByRole('switch')
    // Password switch is first; 2FA switch is second.
    expect(switches.length).toBeGreaterThanOrEqual(2)
    const twoFaSwitch = switches[1]
    expect(twoFaSwitch).not.toBeDisabled()
  })

  it('2FA switch is disabled when password is off on both surfaces', () => {
    renderTab(
      { ...baseTeamAuth, oauth: { password: false } },
      { ...basePortalOauth, password: false }
    )
    const switches = screen.getAllByRole('switch')
    // Password off → oauthState.password false → 2FA switch disabled.
    // Password switch: enabled (it's off but can be toggled on).
    // 2FA switch: disabled.
    const twoFaSwitch = switches[1]
    expect(twoFaSwitch).toBeDisabled()
  })

  it('2FA switch reflects twoFactor.required initial state', () => {
    renderTab({ ...baseTeamAuth, twoFactor: { required: true } })
    const switches = screen.getAllByRole('switch')
    const twoFaSwitch = switches[1]
    expect(twoFaSwitch).toHaveAttribute('aria-checked', 'true')
  })
})
