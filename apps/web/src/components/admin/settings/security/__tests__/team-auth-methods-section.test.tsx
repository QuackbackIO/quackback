// @vitest-environment happy-dom
/**
 * <TeamAuthMethodsSection> — smoke test for the extracted component.
 * Renders the four method rows (password, magic-link, 2FA, new-device
 * notification) and reflects the initialConfig prop state into the
 * switches.
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
  it('renders rows for password, magic-link, 2FA, and new-device notification', () => {
    renderWith(baseConfig)
    // Each row has a label and a description — use getAllByText so
    // multiple matches (label + description both containing the term) pass.
    expect(screen.getAllByText(/password/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/magic link/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/2fa/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/new device/i).length).toBeGreaterThan(0)
  })

  it('reflects the password=false state from initialConfig', () => {
    renderWith({ ...baseConfig, oauth: { ...baseConfig.oauth, password: false } })
    // MethodRow renders Switch without an accessible name — find all
    // switches; the first one corresponds to the Password row.
    const switches = screen.getAllByRole('switch')
    // Password is first, so switches[0] maps to it.
    expect(switches[0]).toHaveAttribute('aria-checked', 'false')
  })
})
