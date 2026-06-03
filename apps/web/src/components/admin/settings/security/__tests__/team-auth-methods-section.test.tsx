// @vitest-environment happy-dom
/**
 * <TeamAuthMethodsSection> — smoke test for the post-restructure
 * component. Now owns only the Team security policy card (2FA toggle);
 * the Sign-in methods rows moved to <SignInProvidersTab> with a
 * unified single-toggle-per-provider model. The 2FA toggle wording
 * also references the Sign-in providers tab as the place to enable
 * password sign-in when it's disabled.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TeamAuthMethodsSection } from '../team-auth-methods-section'
import type { AuthConfig } from '@/lib/shared/types/settings'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouteContext: () => ({ managedFieldPaths: [] }),
}))

vi.mock('@/lib/server/functions/settings', () => ({
  updateAuthConfigFn: vi.fn(),
}))

const baseConfig: AuthConfig = {
  oauth: { password: true, magicLink: true, google: false, github: false },
  openSignup: false,
}

function renderWith(config: AuthConfig) {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <TeamAuthMethodsSection initialConfig={config} />
    </QueryClientProvider>
  )
}

describe('<TeamAuthMethodsSection>', () => {
  it('renders the Team security policy card with the 2FA row', () => {
    renderWith(baseConfig)
    expect(screen.getByText(/team security policy/i)).toBeInTheDocument()
    expect(screen.getAllByText(/2fa/i).length).toBeGreaterThan(0)
  })

  it('does NOT render password or magic-link rows (moved to Sign-in providers tab)', () => {
    renderWith(baseConfig)
    expect(screen.queryByText(/^password$/i)).toBeNull()
    expect(screen.queryByText(/email magic link/i)).toBeNull()
  })

  it('renders one switch (2FA only) reflecting the twoFactor.required initial state', () => {
    renderWith({ ...baseConfig, twoFactor: { required: true } })
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(1)
    expect(switches[0]).toHaveAttribute('aria-checked', 'true')
  })

  it('disables the 2FA toggle when password sign-in is off', () => {
    renderWith({ ...baseConfig, oauth: { ...baseConfig.oauth, password: false } })
    const switches = screen.getAllByRole('switch')
    expect(switches[0]).toBeDisabled()
  })
})
