// @vitest-environment happy-dom
/**
 * <ProviderDetailPage> — the routed successor to the tabbed provider dialog.
 *
 * Everything the dialog was asserted on still has to hold: the IdP family
 * round-trips through the persisted `kind` column rather than URL inference,
 * the scopes / prompt / client-auth controls save their normalized values, the
 * connection-test status is readable, and claim mapping stays reachable
 * independently of account provisioning.
 *
 * What the page adds on top is what the dialog structurally could not do:
 * `enabled` is settable here, each card commits only its own fields, and
 * removal is a card of its own that states what it would orphan.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { IdentityProviderId } from '@quackback/ids'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import type { VerifiedDomain } from '@/lib/server/domains/settings/settings.types'
import { ProviderDetailPage } from '../provider-detail-page'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

const { upsertSpy, deleteSpy, credentialsSpy } = vi.hoisted(() => ({
  upsertSpy: vi.fn(
    async (_args: {
      data: {
        id?: string
        enabled?: boolean
        kind?: string | null
        claimMapping?: unknown
        scopes?: string | null
        prompt?: string | null
        tokenEndpointAuthMethod?: string | null
        showButton?: boolean
        autoCreateUsers?: boolean
        autoProvisionRole?: string | null
        label?: string
      }
    }) => undefined
  ),
  deleteSpy: vi.fn(async (_args: { data: { id: string } }) => ({ success: true })),
  credentialsSpy: vi.fn(async (_args: { data: { id: string; clientSecret: string } }) => ({
    success: true,
  })),
}))

const { discoveryScopesSpy } = vi.hoisted(() => ({
  discoveryScopesSpy: vi.fn(async () => ({ scopesSupported: null as string[] | null })),
}))

const { ssoTestRef } = vi.hoisted(() => ({
  ssoTestRef: {
    current: null as null | { registrationId: string; claims: Record<string, unknown> },
  },
}))

const { state } = vi.hoisted(() => ({
  state: {
    providers: [] as unknown[],
    // Password on + one working IdP ⇒ two working methods, so nothing is the
    // "last method standing" unless a test says so.
    authConfig: { oauth: { password: true } } as { oauth: Record<string, boolean> },
    credentialStatus: { _emailConfigured: true } as Record<string, boolean>,
    accountCount: 0,
    navigate: vi.fn(async () => undefined),
    userAttributes: [] as Array<{
      id: string
      key: string
      label: string
      type: 'string' | 'number' | 'boolean' | 'date' | 'currency'
      description: string | null
      currencyCode: string | null
      externalKey: string | null
      createdAt: Date
      updatedAt: Date
    }>,
  },
}))

vi.mock('../../sso/use-sso-test-sign-in', () => ({
  useSsoTestSignIn: () => ({ open: vi.fn(), lastSuccess: ssoTestRef.current }),
  SsoTestSignInProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// useServerFn just unwraps the server fn in the browser — return it as-is so
// the cards call our spies directly.
vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }))

vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({ baseUrl: 'https://app.example.com' }),
  useNavigate: () => state.navigate,
  Link: ({
    children,
    to,
    params: _params,
    search: _search,
    ...rest
  }: {
    children: React.ReactNode
    to: string
    params?: unknown
    search?: unknown
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/server/functions/sso', () => ({
  upsertIdentityProviderFn: upsertSpy,
  setProviderCredentialsFn: credentialsSpy,
  deleteIdentityProviderFn: deleteSpy,
  addProviderDomainFn: vi.fn(),
  verifyProviderDomainFn: vi.fn(),
  fetchDiscoveryScopesFn: discoveryScopesSpy,
  setDomainEnforcedFn: vi.fn(),
  removeVerifiedDomainFn: vi.fn(),
}))

vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    identityProviders: () => ({
      queryKey: ['settings', 'identityProviders'],
      queryFn: async () => state.providers,
      staleTime: Infinity,
    }),
    authConfig: () => ({
      queryKey: ['settings', 'authConfig'],
      queryFn: async () => state.authConfig,
      staleTime: Infinity,
    }),
    providerAccountCount: (id: string) => ({
      queryKey: ['settings', 'identityProviders', id, 'accountCount'],
      queryFn: async () => ({ count: state.accountCount }),
      staleTime: Infinity,
    }),
  },
}))

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    authProviderStatus: () => ({
      queryKey: ['admin', 'authProviderStatus'],
      queryFn: async () => state.credentialStatus,
      staleTime: Infinity,
    }),
    userAttributes: () => ({
      queryKey: ['admin', 'userAttributes'],
      queryFn: async () => state.userAttributes,
      staleTime: Infinity,
    }),
  },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// Stub the Test sign-in button so the page doesn't pull in the test-flow
// server fns / context. Pass `disabled` through so tests can assert state.
vi.mock('../../sso/test-sign-in-button', () => ({
  TestSignInButton: ({
    disabled,
    children,
  }: {
    disabled?: boolean
    children?: React.ReactNode
  }) => (
    <button type="button" disabled={disabled}>
      {children ?? 'Test sign-in'}
    </button>
  ),
}))

// A vanity Okta domain — `inferIdpKind` cannot classify it (only *.okta.com
// matches), so it falls back to 'other'.
const VANITY_OKTA_URL = 'https://login.acme.com/.well-known/openid-configuration'

function makeProvider(over: Partial<IdentityProvider>): IdentityProvider {
  return {
    id: 'idp_x' as IdentityProviderId,
    registrationId: 'oidc_x',
    label: 'Acme SSO',
    kind: null,
    configured: true,
    discoveryUrl: VANITY_OKTA_URL,
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
    detailsChangedAt: null,
    lastSuccessfulTestAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    domains: [],
    visibility: 'button',
    ...over,
    lastTestCapture: over.lastTestCapture ?? null,
  }
}

const verifiedDomain: VerifiedDomain = {
  id: 'domain_1' as `domain_${string}`,
  name: 'acme.com',
  verificationToken: 'tok',
  verifiedAt: '2026-06-01T00:00:00.000Z',
  enforced: false,
  providerId: 'idp_x' as `idp_${string}`,
  createdAt: '2026-05-01T00:00:00.000Z',
}

function renderPage(provider: IdentityProvider) {
  state.providers = [provider]
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['settings', 'identityProviders'], [provider])
  qc.setQueryData(['settings', 'authConfig'], state.authConfig)
  qc.setQueryData(['admin', 'authProviderStatus'], state.credentialStatus)
  qc.setQueryData(['settings', 'identityProviders', provider.id, 'accountCount'], {
    count: state.accountCount,
  })
  qc.setQueryData(['admin', 'userAttributes'], state.userAttributes)
  return render(
    <QueryClientProvider client={qc}>
      <ProviderDetailPage providerId={provider.id} />
    </QueryClientProvider>
  )
}

const saveConnection = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }))
const saveMapping = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Save claim mapping' }))
const lastUpsert = () => upsertSpy.mock.calls.at(-1)![0].data

beforeEach(() => {
  upsertSpy.mockClear()
  deleteSpy.mockClear()
  credentialsSpy.mockClear()
  discoveryScopesSpy.mockClear()
  discoveryScopesSpy.mockResolvedValue({ scopesSupported: null })
  ssoTestRef.current = null
  state.userAttributes = []
  state.authConfig = { oauth: { password: true } }
  state.credentialStatus = { _emailConfigured: true }
  state.accountCount = 0
  state.navigate.mockClear()
})

describe('<ProviderDetailPage> page shell', () => {
  it('offers every section in the anchored nav', () => {
    renderPage(makeProvider({}))
    const nav = screen.getByRole('navigation', { name: 'Provider settings' })
    for (const [label, hash] of [
      ['Connection', '#connection'],
      ['Sign-in', '#signin'],
      ['Accounts', '#accounts'],
      ['Claim mapping', '#mapping'],
      ['Remove', '#danger'],
    ]) {
      expect(within(nav).getByRole('link', { name: label })).toHaveAttribute('href', hash)
    }
  })

  it('names the provider and its protocol in the header', () => {
    renderPage(makeProvider({ kind: 'okta', label: 'Acme SSO' }))
    expect(screen.getByRole('heading', { name: 'Acme SSO' })).toBeInTheDocument()
    expect(screen.getByText(/OpenID Connect/)).toBeInTheDocument()
  })

  it('says so when the provider id does not resolve', () => {
    state.providers = []
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['settings', 'identityProviders'], [])
    render(
      <QueryClientProvider client={qc}>
        <ProviderDetailPage providerId={'idp_missing' as IdentityProviderId} />
      </QueryClientProvider>
    )
    expect(screen.getByText(/not found/i)).toBeInTheDocument()
  })
})

/**
 * The dialog could only read `enabled`; it was settable from the list row
 * alone. That let an admin configure a provider, test it, save and close with
 * nobody able to sign in through it.
 */
describe('<ProviderDetailPage> enabled toggle', () => {
  it('shows a disabled provider as disabled', () => {
    renderPage(makeProvider({ enabled: false }))
    expect(screen.getByRole('switch', { name: /enable acme sso/i })).not.toBeChecked()
    expect(screen.getByText('Disabled')).toBeInTheDocument()
  })

  it('flips the flag through upsert without touching another column', async () => {
    renderPage(makeProvider({ enabled: false }))
    fireEvent.click(screen.getByRole('switch', { name: /enable acme sso/i }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1))
    expect(lastUpsert()).toMatchObject({ id: 'idp_x', enabled: true })
    expect(lastUpsert()).not.toHaveProperty('claimMapping')
    expect(lastUpsert()).not.toHaveProperty('showButton')
  })

  it('is locked when this provider is the only working sign-in method', () => {
    // No password, no socials — the IdP is the last thing standing.
    state.authConfig = { oauth: { password: false } }
    renderPage(makeProvider({ enabled: true, configured: true }))
    expect(screen.getByRole('switch', { name: /enable acme sso/i })).toBeDisabled()
  })
})

describe('<ProviderDetailPage> provisioning consolidation', () => {
  it('shows a single Default role and a collapsed claim-mapping disclosure when no rules', () => {
    renderPage(
      makeProvider({ autoCreateUsers: true, autoProvisionRole: 'user', claimMapping: null })
    )
    // One default-role control, bound to autoProvisionRole.
    expect(screen.getByLabelText('Default role')).toBeInTheDocument()
    // The claim-mapping section is present but the rules are collapsed.
    expect(screen.getByRole('button', { name: /Map roles from claims/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    // No nested "default role" duplicate inside the mapping.
    expect(screen.queryByText('No rules. Everyone gets the default role.')).not.toBeInTheDocument()
  })

  it('keeps claim mapping reachable when auto-create is off', () => {
    // Only the default role is creation-only. Identity resolution runs on every
    // sign-in, including for people who already have accounts, so hiding its
    // configuration behind "create accounts for new people" would hide a live
    // control from exactly the workspaces most likely to need it.
    renderPage(makeProvider({ autoCreateUsers: false }))
    expect(screen.queryByLabelText('Default role')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Map roles from claims/ })).toBeInTheDocument()
  })

  it('persists claimMapping=null when saved with no rules and sync off', async () => {
    renderPage(makeProvider({ autoCreateUsers: true, claimMapping: null }))
    saveMapping()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().claimMapping).toBeNull()
  })

  it('nulls the default role when auto-create is turned off', async () => {
    renderPage(makeProvider({ autoCreateUsers: true, autoProvisionRole: 'member' }))
    await userEvent.click(
      screen.getByRole('switch', { name: 'Auto-create accounts on first sign-in' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save accounts' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert()).toMatchObject({ autoCreateUsers: false, autoProvisionRole: null })
  })
})

describe('<ProviderDetailPage> IdP shortcut persistence', () => {
  it('selects the persisted family on open, even when the discovery URL infers a different one', () => {
    renderPage(makeProvider({ kind: 'okta' }))
    expect(screen.getByRole('radio', { name: 'Okta' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Custom OIDC' })).not.toBeChecked()
  })

  it('falls back to URL inference when kind is null (legacy row on a known domain)', () => {
    renderPage(
      makeProvider({
        kind: null,
        discoveryUrl: 'https://acme.okta.com/.well-known/openid-configuration',
      })
    )
    expect(screen.getByRole('radio', { name: 'Okta' })).toBeChecked()
  })

  it('carries the persisted kind to the server on save', async () => {
    renderPage(makeProvider({ kind: 'okta' }))
    saveConnection()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1))
    expect(lastUpsert().kind).toBe('okta')
  })

  it('persists a newly selected tile', async () => {
    renderPage(makeProvider({ kind: 'okta' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Auth0' }))
    saveConnection()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().kind).toBe('auth0')
  })
})

describe('<ProviderDetailPage> connection-test status', () => {
  it('shows "Not tested yet" when the provider has no successful test', () => {
    renderPage(makeProvider({ lastSuccessfulTestAt: null }))
    expect(screen.getByText(/Not tested yet/)).toBeInTheDocument()
  })

  it('shows the verified status (ready to enforce) for a fresh successful test', () => {
    renderPage(
      makeProvider({ lastSuccessfulTestAt: '2026-05-02T00:00:00.000Z', detailsChangedAt: null })
    )
    expect(screen.getByText(/ready to enforce SSO/)).toBeInTheDocument()
  })

  it('shows the stale status when the connection changed since the last test', () => {
    renderPage(
      makeProvider({
        lastSuccessfulTestAt: '2026-05-01T00:00:00.000Z',
        detailsChangedAt: '2026-05-02T00:00:00.000Z',
      })
    )
    expect(screen.getByText(/changed since the last test/)).toBeInTheDocument()
    // The same state is legible from the header without scrolling to the card.
    expect(screen.getByText('Re-test needed')).toBeInTheDocument()
  })

  it('enables the Test sign-in button for a saved provider', () => {
    renderPage(makeProvider({ registrationId: 'sso' }))
    // startSsoTestFn resolves the provider by registrationId and stamps that
    // provider's own lastSuccessfulTestAt, so the legacy "sso" id is no
    // different from a generated one.
    expect(screen.getByRole('button', { name: /test sign-in/i })).not.toBeDisabled()
  })
})

/**
 * Required-field validation. Both required fields live on the connection card,
 * so a failed save scrolls to the offending input and focuses it — the tabbed
 * dialog needed tab routing for this, a page does not.
 */
describe('<ProviderDetailPage> required fields', () => {
  it('refuses to save a blank display name and focuses the field', async () => {
    renderPage(makeProvider({}))
    await userEvent.clear(screen.getByLabelText('Display name'))
    saveConnection()
    await waitFor(() => expect(screen.getByLabelText('Display name')).toHaveFocus())
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  it('refuses to save a blank client ID and focuses the field', async () => {
    renderPage(makeProvider({}))
    await userEvent.clear(screen.getByLabelText('Client ID'))
    saveConnection()
    await waitFor(() => expect(screen.getByLabelText('Client ID')).toHaveFocus())
    expect(upsertSpy).not.toHaveBeenCalled()
  })
})

/**
 * Visibility and per-domain routing, both of which live on the Sign-in card.
 */
describe('<ProviderDetailPage> sign-in card', () => {
  it('shows the visibility toggle but hides the enforcement control for a no-domain provider', () => {
    renderPage(makeProvider({ domains: [] }))
    // Always available so the admin can hide the button even without a domain.
    expect(screen.getByLabelText(/show a sign-in button/i)).toBeInTheDocument()
    // Enforcement is domain-scoped, so it stays hidden without a verified domain.
    expect(screen.queryByLabelText(/require sso/i)).toBeNull()
  })

  it('shows the visibility toggle and enforcement control for a verified-domain provider', () => {
    renderPage(makeProvider({ domains: [verifiedDomain] }))
    expect(screen.getByLabelText(/show a sign-in button/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/require sso for acme\.com/i)).toBeInTheDocument()
  })

  it('leaves enforcement locked until the connection carries a fresh test', () => {
    // The enforcement gate is the only control here that can lock a workspace
    // out, so it stays disabled without a test that postdates the last change.
    renderPage(makeProvider({ domains: [verifiedDomain], lastSuccessfulTestAt: null }))
    expect(screen.getByLabelText(/require sso for acme\.com/i)).toBeDisabled()
  })

  it('unlocks enforcement once a fresh test vouches for the connection', () => {
    renderPage(
      makeProvider({
        domains: [verifiedDomain],
        lastSuccessfulTestAt: '2026-06-02T00:00:00.000Z',
        detailsChangedAt: null,
      })
    )
    expect(screen.getByLabelText(/require sso for acme\.com/i)).not.toBeDisabled()
    expect(screen.getByText(/Before you enforce/)).toBeInTheDocument()
  })

  it('saves only the visibility choice', async () => {
    renderPage(makeProvider({ showButton: false }))
    await userEvent.click(screen.getByLabelText(/show a sign-in button/i))
    fireEvent.click(screen.getByRole('button', { name: 'Save sign-in' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().showButton).toBe(true)
    expect(lastUpsert()).not.toHaveProperty('claimMapping')
  })
})

describe('<ProviderDetailPage> claim-mapping autocomplete', () => {
  it('names the observed claims inline and drops the old assist block', () => {
    ssoTestRef.current = {
      registrationId: 'oidc_x', // matches makeProvider().registrationId
      claims: { groups: ['11111111-2222'], roles: ['admin'] },
    }
    renderPage(makeProvider({ autoCreateUsers: true, claimMapping: null }))
    // Inline hint names the observed claims (disclosure auto-opens on suggestions).
    expect(screen.getByText('From your test sign-in: groups, roles')).toBeInTheDocument()
    // The old batch-add block's caption is gone.
    expect(screen.queryByText(/Run a test as another user/)).not.toBeInTheDocument()
    // Claim path is now an autocomplete (combobox), not a plain textbox.
    expect(screen.getByRole('combobox', { name: 'Claim path' })).toBeInTheDocument()
  })

  it('auto-fills the claim path when the test returned exactly one array claim', () => {
    ssoTestRef.current = { registrationId: 'oidc_x', claims: { roles: ['admin'] } }
    renderPage(makeProvider({ autoCreateUsers: true, claimMapping: null }))
    expect(screen.getByRole('combobox', { name: 'Claim path' })).toHaveTextContent('roles')
  })

  it('shows no inline suggestions for a test of a different provider', () => {
    ssoTestRef.current = { registrationId: 'oidc_other', claims: { roles: ['admin'] } }
    renderPage(
      makeProvider({
        autoCreateUsers: true,
        claimMapping: { role: { claimPath: 'groups', rules: [] } },
      })
    )
    // Disclosure auto-opens because a mapping object exists; no "from your test" hint.
    expect(screen.queryByText(/From your test sign-in:/)).not.toBeInTheDocument()
  })
})

/**
 * Scopes control.
 *
 * The column was wired end to end — service, server function, registration
 * builder, connection test — but the editor rendered no input, so an admin
 * whose IdP does not define `email`/`profile` had no way to see or change what
 * was being requested. That is the whole reported failure.
 */
describe('<ProviderDetailPage> scopes', () => {
  const openAdvanced = () => {
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))
  }

  it('collapses Advanced by default for a provider on the default scopes', () => {
    renderPage(makeProvider({ scopes: null }))
    expect(screen.getByRole('button', { name: /Advanced/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('auto-expands Advanced when the provider has a custom scope set', () => {
    // Otherwise a non-default configuration is invisible behind a closed panel.
    renderPage(makeProvider({ scopes: 'openid public' }))
    expect(screen.getByRole('button', { name: /Advanced/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('prefills the effective scopes rather than an empty field', () => {
    renderPage(makeProvider({ scopes: null }))
    openAdvanced()
    for (const scope of ['openid', 'email', 'profile']) {
      expect(screen.getByTestId(`scope-token-${scope}`)).toBeInTheDocument()
    }
  })

  it('does not offer to remove openid', () => {
    renderPage(makeProvider({ scopes: null }))
    openAdvanced()
    expect(screen.queryByRole('button', { name: 'Remove scope openid' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove scope email' })).toBeInTheDocument()
  })

  it('saves null when the admin leaves the defaults untouched', async () => {
    renderPage(makeProvider({ scopes: null }))
    saveConnection()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().scopes).toBeNull()
  })

  it('saves the reduced set after removing a scope the IdP does not support', async () => {
    // An IdP that advertises only `public` and `openid`, so the default set
    // is rejected outright.
    renderPage(makeProvider({ scopes: null }))
    openAdvanced()
    fireEvent.click(screen.getByRole('button', { name: 'Remove scope email' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove scope profile' }))
    saveConnection()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().scopes).toBe('openid')
  })

  it('adds a scope typed by the admin', async () => {
    renderPage(makeProvider({ scopes: null }))
    openAdvanced()
    fireEvent.change(screen.getByLabelText('Add a scope'), { target: { value: 'public' } })
    fireEvent.submit(screen.getByTestId('scope-add-form'))
    saveConnection()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().scopes).toBe('openid email profile public')
  })

  it('round-trips a custom set without rewriting it', async () => {
    renderPage(makeProvider({ scopes: 'openid public' }))
    saveConnection()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().scopes).toBe('openid public')
  })
})

/**
 * Inline scope validation against the discovery document.
 *
 * This is the check that would have caught the reported failure at
 * configuration time rather than as an opaque `invalid_scope` after a round
 * trip through the IdP.
 */
describe('<ProviderDetailPage> scope validation', () => {
  const openAdvanced = () => fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))

  it('warns about scopes the IdP does not advertise', async () => {
    discoveryScopesSpy.mockResolvedValueOnce({ scopesSupported: ['public', 'openid'] })
    renderPage(makeProvider({ scopes: null }))
    openAdvanced()
    await waitFor(() => {
      expect(screen.getByTestId('scope-mismatch-warning')).toHaveTextContent('email')
    })
    expect(screen.getByTestId('scope-mismatch-warning')).toHaveTextContent('profile')
  })

  it('reduces the set to what the IdP advertises on one click', async () => {
    discoveryScopesSpy.mockResolvedValueOnce({ scopesSupported: ['public', 'openid'] })
    renderPage(makeProvider({ scopes: null }))
    openAdvanced()
    await waitFor(() => expect(screen.getByTestId('scope-mismatch-warning')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Use supported scopes' }))
    saveConnection()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().scopes).toBe('openid')
  })

  it('says nothing when the IdP advertises no scope list', async () => {
    // Absent means unknown, not unsupported — the field is only RECOMMENDED.
    discoveryScopesSpy.mockResolvedValueOnce({ scopesSupported: null })
    renderPage(makeProvider({ scopes: null }))
    openAdvanced()
    await waitFor(() => expect(discoveryScopesSpy).toHaveBeenCalled())
    expect(screen.queryByTestId('scope-mismatch-warning')).not.toBeInTheDocument()
  })

  it('says nothing when every scope is advertised', async () => {
    discoveryScopesSpy.mockResolvedValueOnce({
      scopesSupported: ['openid', 'email', 'profile'],
    })
    renderPage(makeProvider({ scopes: null }))
    openAdvanced()
    await waitFor(() => expect(discoveryScopesSpy).toHaveBeenCalled())
    expect(screen.queryByTestId('scope-mismatch-warning')).not.toBeInTheDocument()
  })
})

/**
 * Prompt and client authentication.
 *
 * The other two authorize-request parameters that were fixed in code. Both sit
 * in the same Advanced section as scopes, because they are the same kind of
 * thing and splitting them would suggest otherwise.
 */
describe('<ProviderDetailPage> request options', () => {
  const openAdvanced = () => fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))

  it('saves null for an untouched provider on the defaults', async () => {
    renderPage(makeProvider({ prompt: null, tokenEndpointAuthMethod: null }))
    saveConnection()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().prompt).toBeNull()
    expect(lastUpsert().tokenEndpointAuthMethod).toBeNull()
  })

  it('round-trips a configured prompt without rewriting it', async () => {
    renderPage(makeProvider({ prompt: 'omit' }))
    saveConnection()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().prompt).toBe('omit')
  })

  it('auto-expands Advanced when a non-default prompt is set', () => {
    // A non-default configuration must never sit hidden behind a closed panel.
    renderPage(makeProvider({ prompt: 'omit' }))
    expect(screen.getByRole('button', { name: /Advanced/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('offers omit and none as separate choices', async () => {
    // Collapsing them would read as a tidy-up and would break sign-in for
    // anyone who picked the wrong one.
    renderPage(makeProvider({}))
    openAdvanced()
    fireEvent.click(screen.getByLabelText('Sign-in prompt'))
    await waitFor(() => expect(screen.getByTestId('prompt-choice-omit')).toBeInTheDocument())
    expect(screen.getByTestId('prompt-choice-none')).toBeInTheDocument()
  })

  it('exposes the client authentication method', () => {
    renderPage(makeProvider({}))
    openAdvanced()
    expect(screen.getByLabelText('Client authentication')).toBeInTheDocument()
  })
})

/**
 * The switch that lets a provider releasing no email create accounts anyway.
 * Minting is one-way, so the packaging matters as much as the behaviour.
 */
describe('<ProviderDetailPage> identity fields', () => {
  it('is off for a provider that has never been configured', () => {
    renderPage(makeProvider({ claimMapping: null }))
    expect(screen.getByLabelText(/allow accounts without an email/i)).not.toBeChecked()
  })

  it('reflects a provider that has opted in', () => {
    renderPage(makeProvider({ claimMapping: { profile: { allowMissingEmail: true } } }))
    expect(screen.getByLabelText(/allow accounts without an email/i)).toBeChecked()
  })

  it('warns that placeholders are permanent and that off blocks sign-in entirely', () => {
    renderPage(makeProvider({ claimMapping: null }))
    expect(screen.getByText(/Placeholders are\s+permanent/i)).toBeInTheDocument()
    expect(screen.getByText(/these people cannot sign in at all/i)).toBeInTheDocument()
  })

  it('persists the opt-in without disturbing the role section', async () => {
    // The sections share one column, so writing one must not blank the other.
    renderPage(
      makeProvider({
        claimMapping: {
          role: { claimPath: 'groups', rules: [{ whenContains: 'a', role: 'admin' }] },
        },
      })
    )
    await userEvent.click(screen.getByLabelText(/allow accounts without an email/i))
    saveMapping()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    const sent = lastUpsert().claimMapping as {
      profile?: { allowMissingEmail?: boolean }
      role?: { claimPath?: string }
    }
    expect(sent.profile?.allowMissingEmail).toBe(true)
    expect(sent.role?.claimPath).toBe('groups')
  })

  it('sends no profile section when the opt-in is left off', async () => {
    // Absent means "not configured" everywhere else; writing an explicit false
    // would make an untouched provider look deliberately configured.
    renderPage(makeProvider({ claimMapping: null }))
    saveMapping()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().claimMapping).toBeNull()
  })

  it('carries the attributes section through a mapping save verbatim', async () => {
    // `attributes` has no UI at all, so the card that owns the other two
    // sections is the one place it can silently disappear.
    const attributes = { map: [{ claimPath: 'dept', attributeKey: 'department' }] }
    renderPage(makeProvider({ claimMapping: { attributes } }))
    await userEvent.click(screen.getByLabelText(/allow accounts without an email/i))
    saveMapping()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect((lastUpsert().claimMapping as { attributes?: unknown }).attributes).toEqual(attributes)
  })
})

/**
 * Removal. Its own card rather than a ghost button beside Save, and it states
 * what it would cost before offering it — both refusals mirror server-side
 * invariants rather than being UI politeness.
 */
const PEOPLE_ATTRS = [
  {
    id: 'ua_1',
    key: 'department',
    label: 'Department',
    type: 'string' as const,
    description: null,
    currencyCode: null,
    externalKey: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  },
  {
    id: 'ua_2',
    key: 'plan',
    label: 'Plan',
    type: 'string' as const,
    description: null,
    currencyCode: null,
    externalKey: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  },
]

const matchingCapture = {
  registrationId: 'oidc_x',
  capturedAt: '2026-09-01T00:00:00.000Z',
  identity: { id: 'sub', email: 'alice@example.com', sources: { email: 'idToken' as const } },
  claims: { department: 'Engineering' },
}

describe('<ProviderDetailPage> claim → person-attribute mapping', () => {
  it('adds a row, picks a claim path and attribute, and saves without touching role/profile', async () => {
    state.userAttributes = PEOPLE_ATTRS
    renderPage(makeProvider({ claimMapping: null }))
    fireEvent.click(screen.getByRole('button', { name: /Copy claims into person attributes/ }))
    fireEvent.click(screen.getByRole('button', { name: /Add mapping/ }))
    fireEvent.click(screen.getByRole('combobox', { name: /Claim path \(mapping 1\)/ }))
    fireEvent.change(screen.getByPlaceholderText('Search or type…'), {
      target: { value: 'department' },
    })
    fireEvent.click(screen.getByText(/Use ["“]department["”]/))
    fireEvent.click(screen.getByRole('combobox', { name: /Person attribute \(mapping 1\)/ }))
    fireEvent.click(screen.getByRole('option', { name: /Department/ }))
    saveMapping()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    const sent = lastUpsert().claimMapping as {
      attributes?: { map?: Array<{ claimPath: string; attributeKey: string }> }
      role?: unknown
      profile?: unknown
    }
    expect(sent.attributes?.map).toEqual([{ claimPath: 'department', attributeKey: 'department' }])
    expect(sent).not.toHaveProperty('role')
    expect(sent).not.toHaveProperty('profile')
  })

  it('removes the only row on save so attributes is absent from the payload', async () => {
    state.userAttributes = PEOPLE_ATTRS
    renderPage(
      makeProvider({
        claimMapping: {
          attributes: { map: [{ claimPath: 'department', attributeKey: 'department' }] },
        },
      })
    )
    fireEvent.click(screen.getByRole('button', { name: /Remove mapping 1/ }))
    saveMapping()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().claimMapping).toBeNull()
  })

  it('persists overrideExisting and syncOnSignIn independently', async () => {
    state.userAttributes = PEOPLE_ATTRS
    renderPage(
      makeProvider({
        claimMapping: {
          attributes: { map: [{ claimPath: 'department', attributeKey: 'department' }] },
        },
      })
    )
    await userEvent.click(screen.getByLabelText('Overwrite values that are already set'))
    saveMapping()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    const first = lastUpsert().claimMapping as {
      attributes?: { overrideExisting?: boolean; syncOnSignIn?: boolean }
    }
    expect(first.attributes?.overrideExisting).toBe(true)
    expect(first.attributes?.syncOnSignIn).toBeUndefined()

    upsertSpy.mockClear()
    await userEvent.click(screen.getByLabelText('Clear an attribute when its claim is missing'))
    saveMapping()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    const second = lastUpsert().claimMapping as {
      attributes?: { overrideExisting?: boolean; syncOnSignIn?: boolean }
    }
    expect(second.attributes?.overrideExisting).toBe(true)
    expect(second.attributes?.syncOnSignIn).toBe(true)
  })

  it('shows the People empty state and no Add button when there are no definitions', () => {
    state.userAttributes = []
    renderPage(makeProvider({ claimMapping: null }))
    fireEvent.click(screen.getByRole('button', { name: /Copy claims into person attributes/ }))
    expect(screen.getByText(/No person attributes yet/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open People settings' })).toHaveAttribute(
      'href',
      '/admin/settings/people'
    )
    expect(screen.queryByRole('button', { name: /Add mapping/ })).not.toBeInTheDocument()
  })

  it('renders an orphan-row warning when the attribute no longer exists', () => {
    state.userAttributes = PEOPLE_ATTRS
    renderPage(
      makeProvider({
        claimMapping: {
          attributes: { map: [{ claimPath: 'cc', attributeKey: 'cost_center' }] },
        },
      })
    )
    expect(screen.getByText('attribute no longer exists')).toBeInTheDocument()
    expect(screen.getByText('cost_center')).toBeInTheDocument()
  })

  it('previews a written value and a missing-claim skip from a matching capture', async () => {
    state.userAttributes = PEOPLE_ATTRS
    renderPage(
      makeProvider({
        lastTestCapture: matchingCapture,
        claimMapping: {
          attributes: {
            map: [
              { claimPath: 'department', attributeKey: 'department' },
              { claimPath: 'plan', attributeKey: 'plan' },
            ],
          },
        },
      })
    )
    expect(screen.getByText('Attribute writes from your last test sign-in')).toBeInTheDocument()
    expect(screen.getByText(/“Engineering”/)).toBeInTheDocument()
    expect(screen.getByText(/skipped: missing claim/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('combobox', { name: /Claim path \(mapping 1\)/ }))
    fireEvent.change(screen.getByPlaceholderText('Search or type…'), {
      target: { value: 'nope' },
    })
    fireEvent.click(screen.getByText(/Use ["“]nope["”]/))
    await waitFor(() => {
      expect(screen.queryByText(/“Engineering”/)).not.toBeInTheDocument()
    })
    expect(screen.getAllByText(/skipped: missing claim/).length).toBeGreaterThan(0)
  })

  it('hides the capture preview when the capture is for a different registrationId', () => {
    state.userAttributes = PEOPLE_ATTRS
    renderPage(
      makeProvider({
        lastTestCapture: { ...matchingCapture, registrationId: 'oidc_other' },
        claimMapping: {
          attributes: { map: [{ claimPath: 'department', attributeKey: 'department' }] },
        },
      })
    )
    expect(
      screen.queryByText('Attribute writes from your last test sign-in')
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/Run a test sign-in to preview what these mappings would write/)
    ).toBeInTheDocument()
  })
})

describe('<ProviderDetailPage> remove', () => {
  it('states that nobody is linked yet and allows removal', () => {
    state.accountCount = 0
    renderPage(makeProvider({}))
    expect(screen.getByText(/Nobody signs in through this provider yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Remove$/ })).not.toBeDisabled()
  })

  it('states the affected account count and blocks removal while identities exist', () => {
    state.accountCount = 4
    renderPage(makeProvider({}))
    expect(screen.getByText(/4 accounts are linked to this provider/)).toBeInTheDocument()
    expect(screen.getByText(/would orphan their accounts/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Remove$/ })).toBeDisabled()
  })

  it('blocks removing a provider that is the only working method', () => {
    state.authConfig = { oauth: { password: false } }
    renderPage(makeProvider({ enabled: true, configured: true }))
    expect(screen.getByRole('button', { name: /^Remove$/ })).toBeDisabled()
    expect(screen.getByText(/only enabled sign-in method/i)).toBeInTheDocument()
  })

  it('allows removing a provider when other methods remain', () => {
    renderPage(makeProvider({ enabled: true, configured: true }))
    expect(screen.getByRole('button', { name: /^Remove$/ })).not.toBeDisabled()
  })

  it('deletes and returns to the provider list once confirmed', async () => {
    renderPage(makeProvider({}))
    fireEvent.click(screen.getByRole('button', { name: /^Remove$/ }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith({ data: { id: 'idp_x' } }))
    await waitFor(() => expect(state.navigate).toHaveBeenCalled())
  })
})
