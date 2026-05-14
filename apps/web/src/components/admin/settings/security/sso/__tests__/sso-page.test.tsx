// @vitest-environment happy-dom
/**
 * <SsoPage> — composition smoke. Asserts that the four sections render
 * in order and that the recovery-codes section is NOT inside the tier-
 * gate banner (it stays usable on tier-off plans).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SsoPage } from '../sso-page'
import type { AuthConfig } from '@/lib/shared/types/settings'
import type { SsoStatus } from '@/lib/server/functions/sso'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouteContext: () => ({ managedFieldPaths: [] }),
}))

vi.mock('../sso-connection-section', () => ({
  SsoConnectionSection: () => <div data-testid="connection">connection</div>,
}))
vi.mock('../verified-domains-section', () => ({
  VerifiedDomainsSection: () => <div data-testid="domains">domains</div>,
}))
vi.mock('../attribute-mapping-section', () => ({
  AttributeMappingSection: () => <div data-testid="mapping">mapping</div>,
}))
vi.mock('../recovery-codes-section', () => ({
  RecoveryCodesSection: () => <div data-testid="recovery">recovery</div>,
}))

const baseConfig: AuthConfig = { oauth: {}, openSignup: false }
const baseStatus: SsoStatus = {
  lastSignInAt: null,
  secretConfigured: true,
  discoveryReachable: null,
  enableEligible: false,
  enforcementEligible: false,
  redirectUri: 'https://example.com/api/auth/oauth2/callback/sso',
}

function renderWith(tierOk: boolean) {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <SsoPage authConfig={baseConfig} ssoStatus={baseStatus} customOidcProviderTier={tierOk} />
    </QueryClientProvider>
  )
}

describe('<SsoPage>', () => {
  it('renders the four sections in order', () => {
    renderWith(true)
    const sections = ['connection', 'domains', 'mapping', 'recovery']
    const found = sections.map((id) => screen.getByTestId(id))
    // DOM order check: each subsequent element is after the previous.
    for (let i = 1; i < found.length; i++) {
      expect(found[i - 1].compareDocumentPosition(found[i])).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    }
  })

  it('always renders the recovery-codes section regardless of tier', () => {
    renderWith(false)
    expect(screen.getByTestId('recovery')).toBeInTheDocument()
  })
})
