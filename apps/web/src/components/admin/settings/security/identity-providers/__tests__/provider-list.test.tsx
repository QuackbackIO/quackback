// @vitest-environment happy-dom
/**
 * <IdentityProvidersSection> — the list, now a pure index.
 *
 * Configuring a provider used to open a dialog over this card; it is a routed
 * page now, so the list's job is to show each provider's routing at a glance
 * (verified domains, enforced ones marked), flip `enabled` in place, and link
 * onward. The controls that used to be asserted through the dialog live in
 * `provider-detail-page.test.tsx`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { IdentityProviderId } from '@quackback/ids'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import type { VerifiedDomain } from '@/lib/server/domains/settings/settings.types'
import { IdentityProvidersSection } from '../provider-list'

const { upsertSpy } = vi.hoisted(() => ({
  upsertSpy: vi.fn(async (_args: { data: { id: string; enabled: boolean } }) => undefined),
}))

vi.mock('@/components/admin/upgrade', () => ({
  UpgradeNotice: () => (
    <p>Single sign-on is an Enterprise feature. Upgrade to Enterprise to enable it.</p>
  ),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouteContext: () => ({ managedFieldPaths: [] }),
  Link: ({
    children,
    to,
    params,
    ...rest
  }: {
    children: React.ReactNode
    to: string
    params?: { providerId?: string }
  }) => (
    <a href={params?.providerId ? to.replace('$providerId', params.providerId) : to} {...rest}>
      {children}
    </a>
  ),
}))

// useServerFn just unwraps the server fn in the browser — return it as-is so
// the enable toggle calls our spy directly.
vi.mock('@tanstack/react-start', () => ({
  useServerFn: (fn: unknown) => fn,
}))

vi.mock('@/lib/server/functions/sso', () => ({
  upsertIdentityProviderFn: upsertSpy,
  deleteIdentityProviderFn: vi.fn(),
  setProviderCredentialsFn: vi.fn(),
  addProviderDomainFn: vi.fn(),
  verifyProviderDomainFn: vi.fn(),
  fetchDiscoveryScopesFn: vi.fn(async () => ({ scopesSupported: null })),
  setDomainEnforcedFn: vi.fn(),
  removeVerifiedDomainFn: vi.fn(),
}))

beforeEach(() => {
  upsertSpy.mockClear()
})

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// Recovery codes nest inside this section now; stub it so the test doesn't
// pull in the recovery-codes server fn and its server-only import chain.
vi.mock('../../sso/recovery-codes-section', () => ({
  RecoveryCodesSection: () => <div data-testid="recovery-codes-section" />,
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

const verifiedDomain2: VerifiedDomain = {
  id: 'domain_2' as `domain_${string}`,
  name: 'beta.com',
  verificationToken: 'tok2',
  verifiedAt: '2026-06-01T00:00:00.000Z',
  enforced: true,
  providerId: 'idp_routed' as `idp_${string}`,
  createdAt: '2026-05-02T00:00:00.000Z',
}

function makeProvider(over: Partial<IdentityProvider>): IdentityProvider {
  return {
    id: 'idp_x' as IdentityProviderId,
    registrationId: 'oidc_x',
    label: 'Provider',
    kind: null,
    configured: true,
    discoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
    authorizationUrl: null,
    tokenUrl: null,
    userInfoUrl: null,
    jwksUri: null,
    issuer: null,
    clientId: 'client-id',
    scopes: null,
    prompt: null,
    tokenEndpointAuthMethod: null,
    enabled: true,
    autoCreateUsers: true,
    autoProvisionRole: 'user',
    claimMapping: null,
    showButton: false,
    logoKey: null,
    logoUrl: null,
    detailsChangedAt: null,
    lastSuccessfulTestAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    domains: [],
    visibility: 'button',
    ...over,
    lastTestCapture: over.lastTestCapture ?? null,
  }
}

const buttonProvider = makeProvider({
  id: 'idp_button' as IdentityProviderId,
  registrationId: 'oidc_button',
  label: 'Customer Login',
  enabled: false,
  domains: [],
  visibility: 'button',
})

const routedProvider = makeProvider({
  id: 'idp_routed' as IdentityProviderId,
  registrationId: 'sso',
  label: 'Acme SSO',
  autoProvisionRole: 'member',
  domains: [verifiedDomain, verifiedDomain2],
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

function renderSection(enabledMethodCount = 5) {
  const qc = new QueryClient()
  qc.setQueryData(['settings', 'identityProviders'], [buttonProvider, routedProvider])
  return render(
    <QueryClientProvider client={qc}>
      <IdentityProvidersSection tierEnabled enabledMethodCount={enabledMethodCount} />
    </QueryClientProvider>
  )
}

describe('<IdentityProvidersSection>', () => {
  it('lists each provider by name without the button/routed jargon badge', () => {
    renderSection()
    expect(screen.getByText('Customer Login')).toBeInTheDocument()
    expect(screen.getByText('Acme SSO')).toBeInTheDocument()
    expect(screen.queryByText('button')).toBeNull()
    expect(screen.queryByText('routed')).toBeNull()
  })

  it('lists every verified domain underneath, marking enforced ones', () => {
    renderSection()
    // Each verified domain is its own chip — no "+N" truncation.
    expect(screen.getByText('acme.com')).toBeInTheDocument()
    // The enforced domain carries a green "SSO enforced" affordance.
    expect(screen.getByTitle('SSO enforced for beta.com')).toBeInTheDocument()
  })

  it('shows no domain chips for a provider with no verified domains', () => {
    renderSection()
    // The old "no domains" filler is gone; button providers show no domain text.
    expect(screen.queryByText(/no domains/i)).toBeNull()
  })
})

describe('plan gate', () => {
  it('hides Add provider and names Enterprise when SSO is not entitled', () => {
    const qc = new QueryClient()
    qc.setQueryData(['settings', 'identityProviders'], [buttonProvider, routedProvider])
    render(
      <QueryClientProvider client={qc}>
        <IdentityProvidersSection tierEnabled={false} enabledMethodCount={5} />
      </QueryClientProvider>
    )
    expect(screen.queryByRole('link', { name: /add provider/i })).toBeNull()
    expect(screen.getByText(/Single sign-on is an Enterprise feature/)).toBeTruthy()
  })
})

describe('links to the provider pages', () => {
  it('sends Add provider to the create page', () => {
    renderSection()
    expect(screen.getByRole('link', { name: /add provider/i })).toHaveAttribute(
      'href',
      '/admin/settings/security/sso/new'
    )
  })

  it('sends each row to its own provider page', () => {
    renderSection()
    expect(screen.getByRole('link', { name: /configure customer login/i })).toHaveAttribute(
      'href',
      '/admin/settings/security/sso/idp_button'
    )
    expect(screen.getByRole('link', { name: /configure acme sso/i })).toHaveAttribute(
      'href',
      '/admin/settings/security/sso/idp_routed'
    )
  })

  it('opens no dialog over the list', () => {
    renderSection()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(/edit identity provider/i)).toBeNull()
  })
})

describe('enable toggle on the list row', () => {
  it('flips the provider enabled flag via upsert without leaving the page', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('switch', { name: /enable customer login/i }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1))
    expect(upsertSpy.mock.calls[0][0].data).toMatchObject({
      id: buttonProvider.id,
      enabled: true,
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('blocks disabling a provider that is the only working method', () => {
    // Acme SSO is enabled + configured; with a total of 1 method it is the
    // last thing standing, so its toggle is locked.
    renderSection(1)
    expect(screen.getByRole('switch', { name: /enable acme sso/i })).toBeDisabled()
  })

  it('allows disabling a provider when other methods remain', () => {
    renderSection(3)
    expect(screen.getByRole('switch', { name: /enable acme sso/i })).not.toBeDisabled()
  })
})
