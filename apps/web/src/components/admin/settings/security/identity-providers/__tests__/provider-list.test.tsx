// @vitest-environment happy-dom
/**
 * <IdentityProvidersSection> + <ProviderEditor> — the domain→visibility
 * rule (D5) made visible.
 *
 * Core assertions:
 *  - A provider with NO verified domain is a public `button`; its editor
 *    hides the "also show a button" toggle (always-public, so meaningless)
 *    and has no per-domain enforcement control.
 *  - A provider WITH a verified domain is `routed`; its editor shows the
 *    visibility toggle AND the per-domain enforcement control.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { IdentityProviderId } from '@quackback/ids'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import type { VerifiedDomain } from '@/lib/server/domains/settings/settings.types'
import { IdentityProvidersSection } from '../provider-list'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouteContext: () => ({ managedFieldPaths: [] }),
}))

// The per-provider server fns are referenced (via useServerFn) but never
// invoked in these render-only assertions — stub them so importing the
// components never pulls server code into the happy-dom run.
vi.mock('@tanstack/react-start', () => ({
  useServerFn: () => vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/server/functions/sso', () => ({
  upsertIdentityProviderFn: vi.fn(),
  deleteIdentityProviderFn: vi.fn(),
  setProviderCredentialsFn: vi.fn(),
  addProviderDomainFn: vi.fn(),
  verifyProviderDomainFn: vi.fn(),
  setDomainEnforcedFn: vi.fn(),
  removeVerifiedDomainFn: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// Stub the Test sign-in button so the editor doesn't pull in the full
// test-flow server fns. Pass `disabled` through so tests can assert state.
vi.mock('../../sso/test-sign-in-button', () => ({
  TestSignInButton: ({ disabled }: { disabled?: boolean }) => (
    <button type="button" disabled={disabled}>
      Test sign-in
    </button>
  ),
}))
vi.mock('../../sso/use-sso-test-sign-in', () => ({
  useSsoTestSignIn: () => ({ open: vi.fn() }),
  SsoTestSignInProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const verifiedDomain: VerifiedDomain = {
  id: 'domain_1' as `domain_${string}`,
  name: 'acme.com',
  verificationToken: 'tok',
  verifiedAt: '2026-06-01T00:00:00.000Z',
  enforced: false,
  providerId: 'idp_routed' as `idp_${string}`,
  createdAt: '2026-05-01T00:00:00.000Z',
}

function makeProvider(over: Partial<IdentityProvider>): IdentityProvider {
  return {
    id: 'idp_x' as IdentityProviderId,
    registrationId: 'oidc_x',
    label: 'Provider',
    discoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
    authorizationUrl: null,
    tokenUrl: null,
    userInfoUrl: null,
    clientId: 'client-id',
    scopes: null,
    enabled: true,
    autoCreateUsers: true,
    autoProvisionRole: 'user',
    attributeMapping: null,
    showButton: false,
    detailsChangedAt: null,
    lastSuccessfulTestAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    domains: [],
    visibility: 'button',
    ...over,
  }
}

const buttonProvider = makeProvider({
  id: 'idp_button' as IdentityProviderId,
  registrationId: 'oidc_button',
  label: 'Customer Login',
  domains: [],
  visibility: 'button',
})

const routedProvider = makeProvider({
  id: 'idp_routed' as IdentityProviderId,
  registrationId: 'sso',
  label: 'Acme SSO',
  autoProvisionRole: 'member',
  domains: [verifiedDomain],
  visibility: 'routed',
})

vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    identityProviders: () => ({
      queryKey: ['settings', 'identityProviders'],
      queryFn: async () => [buttonProvider, routedProvider],
      staleTime: Infinity,
    }),
  },
}))

function renderSection() {
  const qc = new QueryClient()
  qc.setQueryData(['settings', 'identityProviders'], [buttonProvider, routedProvider])
  return render(
    <QueryClientProvider client={qc}>
      <IdentityProvidersSection tierEnabled />
    </QueryClientProvider>
  )
}

describe('<IdentityProvidersSection>', () => {
  it('renders a [button] badge for a no-domain provider and [routed] for a verified-domain one', () => {
    renderSection()
    expect(screen.getByText('button')).toBeInTheDocument()
    expect(screen.getByText('routed')).toBeInTheDocument()
  })

  it('hides the visibility toggle and enforcement control for a no-domain provider', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: /edit customer login/i }))
    expect(await screen.findByText(/edit identity provider/i)).toBeInTheDocument()
    // No verified domain -> always a public button -> the toggle is meaningless.
    expect(screen.queryByText(/also show a/i)).toBeNull()
    expect(screen.queryByLabelText(/require sso/i)).toBeNull()
  })

  it('shows the visibility toggle and enforcement control for a verified-domain provider', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: /edit acme sso/i }))
    expect(await screen.findByText(/also show a/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/require sso for acme\.com/i)).toBeInTheDocument()
  })
})

describe('Test sign-in button in ProviderEditor', () => {
  // startSsoTestFn now resolves the provider by registrationId and stamps
  // that provider's own lastSuccessfulTestAt, so the button is enabled for
  // any saved provider regardless of its registrationId.

  it('is enabled for a saved non-sso provider', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: /edit customer login/i }))
    await screen.findByText(/edit identity provider/i)
    const testBtn = screen.getByRole('button', { name: /test sign-in/i })
    expect(testBtn).not.toBeDisabled()
  })

  it('is enabled for the legacy "sso" registrationId provider', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: /edit acme sso/i }))
    await screen.findByText(/edit identity provider/i)
    const testBtn = screen.getByRole('button', { name: /test sign-in/i })
    expect(testBtn).not.toBeDisabled()
  })
})
