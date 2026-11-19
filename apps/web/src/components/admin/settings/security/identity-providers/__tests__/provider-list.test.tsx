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

const { upsertSpy, access } = vi.hoisted(() => ({
  upsertSpy: vi.fn(async (_args: { data: { id: string; enabled: boolean } }) => undefined),
  access: { billingEnabled: true, permissions: new Set<string>(['billing.manage']) },
}))

vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useBillingEnabled: () => access.billingEnabled,
}))

// The settings layout loader seeds the upgrade context; tests seed the same key.
vi.mock('@/lib/client/queries/billing', () => ({
  billingQueries: {
    upgradeContext: () => ({
      queryKey: ['billing', 'upgrade-context'],
      queryFn: async () => null,
      staleTime: Infinity,
    }),
  },
}))

vi.mock('@/lib/client/hooks/use-permission', () => ({
  usePermission: (key: string) => access.permissions.has(key),
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
  getSsoDomainProofsFn: vi.fn(async () => ({})),
  fetchDiscoveryScopesFn: vi.fn(async () => ({ scopesSupported: null })),
  setDomainEnforcedFn: vi.fn(),
  removeVerifiedDomainFn: vi.fn(),
}))

beforeEach(() => {
  upsertSpy.mockClear()
  access.billingEnabled = true
  access.permissions = new Set(['billing.manage'])
})

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// The Plan limits state the grace notice reads; tests seed the same key.
vi.mock('@/lib/server/functions/plan-limits', () => ({ getPlanLimitsFn: vi.fn(async () => null) }))

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
    idTokenNonce: null,
    enabled: true,
    autoCreateUsers: true,
    autoProvisionRole: 'user',
    claimMapping: null,
    redirectStyle: 'current',
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

/** Password still on: no provider is the last way in. */
const withPassword = { oauthState: { password: true }, emailConfigured: true, credentialStatus: {} }
/** Password and email links off: the providers are the only way in. */
const ssoOnly = {
  oauthState: { password: false, magicLink: false },
  emailConfigured: true,
  credentialStatus: {},
}

function renderSection(methods = withPassword) {
  const qc = new QueryClient()
  qc.setQueryData(['settings', 'identityProviders'], [buttonProvider, routedProvider])
  return render(
    <QueryClientProvider client={qc}>
      <IdentityProvidersSection tierEnabled methods={methods} />
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

  it('draws providers as hairline list rows, not boxed cards', () => {
    renderSection()
    expect(document.querySelectorAll('[data-slot="settings-list-row"]')).toHaveLength(2)
    expect(document.querySelector('[data-slot="settings-list"]')).not.toBeNull()
  })

  it('shows no domain chips for a provider with no verified domains', () => {
    renderSection()
    // The old "no domains" filler is gone; button providers show no domain text.
    expect(screen.queryByText(/no domains/i)).toBeNull()
  })
})

describe('plan gate', () => {
  it('hides New provider and names Enterprise when SSO is not entitled', () => {
    const qc = new QueryClient()
    // No provider set up yet (the only one is switched off): the plain offer.
    qc.setQueryData(['settings', 'identityProviders'], [buttonProvider])
    render(
      <QueryClientProvider client={qc}>
        <IdentityProvidersSection tierEnabled={false} methods={withPassword} />
      </QueryClientProvider>
    )
    expect(screen.queryByRole('link', { name: /new provider/i })).toBeNull()
    expect(screen.getByText(/Single sign-on is an Enterprise feature/)).toBeTruthy()
  })

  function renderWithoutTier() {
    const qc = new QueryClient()
    qc.setQueryData(['settings', 'identityProviders'], [buttonProvider, routedProvider])
    return render(
      <QueryClientProvider client={qc}>
        <IdentityProvidersSection tierEnabled={false} methods={withPassword} />
      </QueryClientProvider>
    )
  }

  it('still lists existing providers so an enabled one can be switched off', async () => {
    renderWithoutTier()
    expect(screen.getByText('Acme SSO')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: /enable acme sso/i }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1))
    expect(upsertSpy.mock.calls[0][0].data).toMatchObject({
      id: routedProvider.id,
      enabled: false,
    })
  })

  it('locks the switch of a disabled provider, since turning it on needs the tier', () => {
    renderWithoutTier()
    const toggle = screen.getByRole('switch', { name: /enable customer login/i })
    expect(toggle).toBeDisabled()
    fireEvent.click(toggle)
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it('omits the Configure link without the tier', () => {
    renderWithoutTier()
    expect(screen.getByText('Acme SSO')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /configure acme sso/i })).toBeNull()
  })
})

describe('links to the provider pages', () => {
  it('sends New provider to the create page', () => {
    renderSection()
    expect(screen.getByRole('link', { name: /new provider/i })).toHaveAttribute(
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
    renderSection(ssoOnly)
    expect(screen.getByRole('switch', { name: /enable acme sso/i })).toBeDisabled()
  })

  it('allows disabling a provider when other methods remain', () => {
    renderSection(withPassword)
    expect(screen.getByRole('switch', { name: /enable acme sso/i })).not.toBeDisabled()
  })
})

describe('last-method guard depends on the SSO tier', () => {
  // Without the tier the method count leaves identity providers out, so a
  // count of 1 is the built-in or social method, not the SSO provider.
  it('locks the last working method while the tier is on', () => {
    renderSection(ssoOnly)
    const toggle = screen.getByRole('switch', { name: /enable acme sso/i })
    expect(toggle).toBeDisabled()
    expect(toggle.parentElement).toHaveAttribute(
      'title',
      'At least one sign-in method must stay enabled.'
    )
  })

  it('lets a provider be switched off while the tier is off and another way in remains', async () => {
    const qc = new QueryClient()
    qc.setQueryData(['settings', 'identityProviders'], [buttonProvider, routedProvider])
    render(
      <QueryClientProvider client={qc}>
        <IdentityProvidersSection tierEnabled={false} methods={withPassword} />
      </QueryClientProvider>
    )
    const toggle = screen.getByRole('switch', { name: /enable acme sso/i })
    expect(toggle).not.toBeDisabled()
    fireEvent.click(toggle)
    await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1))
    expect(upsertSpy.mock.calls[0][0].data).toMatchObject({
      id: routedProvider.id,
      enabled: false,
    })
  })

  it('locks the provider that keeps the stand-in email links on while the tier is off', () => {
    // Password and email links are off; the set-up provider is why email links
    // are offered at all, so switching it off would leave no way in.
    const qc = new QueryClient()
    qc.setQueryData(['settings', 'identityProviders'], [buttonProvider, routedProvider])
    render(
      <QueryClientProvider client={qc}>
        <IdentityProvidersSection tierEnabled={false} methods={ssoOnly} />
      </QueryClientProvider>
    )
    const toggle = screen.getByRole('switch', { name: /enable acme sso/i })
    expect(toggle).toBeDisabled()
    expect(toggle.parentElement).toHaveAttribute(
      'title',
      'At least one sign-in method must stay enabled.'
    )
    fireEvent.click(toggle)
    expect(upsertSpy).not.toHaveBeenCalled()
  })
})

describe('empty list', () => {
  it('shows the shared empty state with a New provider action', () => {
    const qc = new QueryClient()
    qc.setQueryData(['settings', 'identityProviders'], [])
    render(
      <QueryClientProvider client={qc}>
        <IdentityProvidersSection tierEnabled methods={withPassword} />
      </QueryClientProvider>
    )
    expect(screen.getByText('No providers yet')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /new provider/i }).length).toBeGreaterThan(0)
  })
})

describe('set up but paused on the plan', () => {
  const PAUSED_COPY =
    'Single sign-on is paused on the Pro plan. Your team signs in with email links. It comes back when you upgrade.'

  function renderSetUp(
    tierEnabled: boolean,
    providers = [buttonProvider, routedProvider],
    upgradeContext: { currentPlanName: string } | null = { currentPlanName: 'Pro' }
  ) {
    const qc = new QueryClient()
    qc.setQueryData(['settings', 'identityProviders'], providers)
    qc.setQueryData(['billing', 'upgrade-context'], upgradeContext)
    return render(
      <QueryClientProvider client={qc}>
        <IdentityProvidersSection tierEnabled={tierEnabled} methods={withPassword} />
      </QueryClientProvider>
    )
  }

  it('names the plan and says email links stand in when an enabled provider is set up', () => {
    renderSetUp(false)
    expect(screen.getByText(PAUSED_COPY)).toBeInTheDocument()
    // One notice, not the plain upgrade offer as well.
    expect(screen.queryByText(/Single sign-on is an Enterprise feature/)).toBeNull()
  })

  it('offers Upgrade, linking to Plan & billing, to someone who can manage billing', () => {
    renderSetUp(false)
    expect(screen.getByRole('link', { name: 'Upgrade' })).toHaveAttribute(
      'href',
      '/admin/settings/billing'
    )
    expect(screen.queryByText('Ask someone who manages billing to upgrade.')).toBeNull()
  })

  it('asks someone without billing rights to find a billing manager', () => {
    access.permissions = new Set()
    renderSetUp(false)
    expect(screen.getByText(PAUSED_COPY)).toBeInTheDocument()
    expect(screen.getByText('Ask someone who manages billing to upgrade.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Upgrade' })).toBeNull()
  })

  it('leaves the plan unnamed when the plan is not known', () => {
    renderSetUp(false, undefined, null)
    expect(
      screen.getByText(
        'Single sign-on is paused. Your team signs in with email links. It comes back when you upgrade.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/Pro plan/)).toBeNull()
  })

  it('offers no upgrade where billing is not managed in the app', () => {
    access.billingEnabled = false
    renderSetUp(false)
    expect(
      screen.getByText('Single sign-on is paused. Your team signs in with email links.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Upgrade' })).toBeNull()
    expect(screen.queryByText(/upgrade/i)).toBeNull()
  })

  it('keeps the providers listed', () => {
    renderSetUp(false)
    expect(screen.getByText('Acme SSO')).toBeInTheDocument()
  })

  it('is absent while the plan includes SSO', () => {
    renderSetUp(true)
    expect(screen.queryByText(/Single sign-on is paused/)).toBeNull()
  })

  it('is absent when no enabled provider has its secret saved', () => {
    renderSetUp(false, [buttonProvider, { ...routedProvider, configured: false }])
    expect(screen.queryByText(/Single sign-on is paused/)).toBeNull()
    expect(screen.getByText(/Single sign-on is an Enterprise feature/)).toBeInTheDocument()
  })
})

describe('set up, and still working until the plan limits deadline', () => {
  const grace = (canManageBilling: boolean) => ({
    enabled: true,
    phase: 'grace',
    planName: 'Free',
    graceEndsAt: '2026-11-23T12:00:00.000Z',
    deadlineDay: '2026-11-22',
    featureIssues: [{ key: 'sso' }],
    canManageBilling,
  })

  function renderGrace(canManageBilling: boolean) {
    const qc = new QueryClient()
    qc.setQueryData(['settings', 'identityProviders'], [buttonProvider, routedProvider])
    qc.setQueryData(['billing', 'upgrade-context'], { currentPlanName: 'Free' })
    qc.setQueryData(['plan-limits', 'feature-notice'], grace(canManageBilling))
    return render(
      <QueryClientProvider client={qc}>
        <IdentityProvidersSection tierEnabled={false} ssoLive methods={withPassword} />
      </QueryClientProvider>
    )
  }

  it('names the last day and offers Upgrade to someone who manages billing', async () => {
    renderGrace(true)
    expect(await screen.findByText('Single sign-on pauses after Nov 22.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upgrade' })).toHaveAttribute(
      'href',
      '/admin/settings/billing'
    )
    expect(screen.queryByText(/is paused/)).toBeNull()
    expect(screen.queryByText(/email links/)).toBeNull()
  })

  it('asks someone without billing rights to find a billing manager', async () => {
    access.permissions = new Set()
    renderGrace(false)
    expect(await screen.findByText('Single sign-on pauses after Nov 22.')).toBeInTheDocument()
    expect(screen.getByText('Ask someone who manages billing to upgrade.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Upgrade' })).toBeNull()
  })

  it('shows the providers working, switched on', () => {
    renderGrace(true)
    expect(screen.getByText('Acme SSO')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Enable Acme SSO' })).toBeChecked()
  })

  it('keeps the paused copy once single sign-on is not live', () => {
    const qc = new QueryClient()
    qc.setQueryData(['settings', 'identityProviders'], [buttonProvider, routedProvider])
    qc.setQueryData(['billing', 'upgrade-context'], { currentPlanName: 'Free' })
    render(
      <QueryClientProvider client={qc}>
        <IdentityProvidersSection tierEnabled={false} ssoLive={false} methods={withPassword} />
      </QueryClientProvider>
    )
    expect(screen.getByText(/Single sign-on is paused on the Free plan/)).toBeInTheDocument()
    expect(screen.queryByText(/pauses after/)).toBeNull()
  })
})
