// @vitest-environment happy-dom
/**
 * <ProviderDetailPage> — one page per provider, three sections.
 *
 * Connection is a summary with Edit; Sign-in & access holds the explicit
 * access decisions; User details rests on "Uses standard profile fields" and
 * opens a compact editor under Customize. Everything the old form asserted
 * still has to hold underneath: the IdP family round-trips through the
 * persisted `kind`, scopes / prompt / client-auth save their normalized
 * values, the connection-test state is readable, and each section commits
 * only its own fields.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { IdentityProviderId } from '@quackback/ids'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import type { VerifiedDomain } from '@/lib/server/domains/settings/settings.types'
import { ProviderDetailPage } from '../provider-detail-page'
import { applyClaimMappingEdits } from '@/lib/shared/sso-claim-mapping-edit'
import type { SsoTestCapture } from '@/lib/shared/sso-test-capture'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

const { upsertSpy, mappingSpy, deleteSpy, credentialsSpy } = vi.hoisted(() => ({
  mappingSpy: vi.fn(
    async (_args: {
      data: {
        expectedClaimMapping: unknown
        operations: unknown[]
        acknowledgeIdentifierChange?: boolean
        acknowledgeAdminRules?: boolean
      }
    }) => undefined
  ),
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

const { ssoTestRef, openTestSpy } = vi.hoisted(() => ({
  ssoTestRef: {
    current: null as null | import('@/lib/shared/sso-test-capture').SsoTestCapture,
  },
  openTestSpy: vi.fn(),
}))

const { toastSpy } = vi.hoisted(() => ({
  toastSpy: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
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
  useSsoTestSignIn: () => ({
    open: openTestSpy,
    lastSuccess: ssoTestRef.current,
    lastCapture: ssoTestRef.current,
  }),
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
  saveIdentityProviderClaimMappingFn: mappingSpy,
  setProviderCredentialsFn: credentialsSpy,
  deleteIdentityProviderFn: deleteSpy,
  addProviderDomainFn: vi.fn(),
  verifyProviderDomainFn: vi.fn(),
  fetchDiscoveryScopesFn: discoveryScopesSpy,
  setDomainEnforcedFn: vi.fn(),
  removeVerifiedDomainFn: vi.fn(),
  saveIdentityProviderLogoFn: vi.fn(),
  deleteIdentityProviderLogoFn: vi.fn(),
}))

// The logo uploader pulls in this server-fn module; stub it so the real
// `createServerFn` never loads under the DOM environment.
vi.mock('@/lib/server/functions/uploads', () => ({
  getIdentityProviderLogoUploadUrlFn: vi.fn(),
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

vi.mock('sonner', () => ({ toast: toastSpy }))

// Stub the Test sign-in button used inside the preview rail so the page does
// not pull in the test-flow server fns. Pass `disabled` through.
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

const verifiedDomain: VerifiedDomain = {
  id: 'domain_1' as `domain_${string}`,
  name: 'acme.com',
  verificationToken: 'tok',
  verifiedAt: '2026-06-01T00:00:00.000Z',
  enforced: false,
  providerId: 'idp_x' as `idp_${string}`,
  createdAt: '2026-05-01T00:00:00.000Z',
}

function renderPage(provider: IdentityProvider, props: { autoTest?: boolean } = {}) {
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
      <ProviderDetailPage providerId={provider.id} {...props} />
    </QueryClientProvider>
  )
}

/** The connection form is behind Edit on a configured provider. */
const editConnection = () => fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
const saveConnection = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))
const openConnectionOptions = () =>
  fireEvent.click(screen.getByRole('button', { name: /Connection options/ }))
/** Sign-in & access and the User details editor both end in Save changes. */
const section = (id: 'signin' | 'mapping') => within(document.getElementById(id)!)
const saveSignIn = () =>
  fireEvent.click(section('signin').getByRole('button', { name: 'Save changes' }))
/** User details is a sentence until Customize opens the editor. */
const customize = () => fireEvent.click(screen.getByRole('button', { name: 'Customize' }))
const saveUserDetails = () => {
  fireEvent.click(section('mapping').getByRole('button', { name: 'Save changes' }))
  const confirm = screen.queryByRole('alertdialog')
  if (confirm) fireEvent.click(within(confirm).getByRole('button', { name: 'Save changes' }))
}
const lastUpsert = () => upsertSpy.mock.calls.at(-1)![0].data
const lastMapping = () => mappingSpy.mock.calls.at(-1)![0].data
const lastSavedMapping = () =>
  applyClaimMappingEdits(
    lastMapping().expectedClaimMapping,
    lastMapping()
      .operations as import('@/lib/shared/sso-claim-mapping-edit').ClaimMappingOperation[]
  )

beforeEach(() => {
  upsertSpy.mockClear()
  mappingSpy.mockClear()
  deleteSpy.mockClear()
  credentialsSpy.mockClear()
  discoveryScopesSpy.mockClear()
  discoveryScopesSpy.mockResolvedValue({ scopesSupported: null })
  openTestSpy.mockClear()
  toastSpy.mockClear()
  ssoTestRef.current = null
  state.userAttributes = []
  state.authConfig = { oauth: { password: true } }
  state.credentialStatus = { _emailConfigured: true }
  state.accountCount = 0
  state.navigate.mockClear()
})

describe('<ProviderDetailPage> page shell', () => {
  it('renders the three sections and nothing else', () => {
    renderPage(makeProvider({}))
    expect(screen.getByRole('heading', { name: 'Connection' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sign-in & access' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'User details' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Remove/ })).not.toBeInTheDocument()
  })

  it('names the provider and its family in the header', () => {
    renderPage(makeProvider({ kind: 'entra', label: 'Acme SSO' }))
    expect(screen.getByRole('heading', { name: 'Acme SSO' })).toBeInTheDocument()
    expect(screen.getByText('Microsoft Entra ID')).toBeInTheDocument()
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

  it('opens the connection test once when arriving from Save and test', async () => {
    const consumed = vi.fn()
    state.providers = [makeProvider({ enabled: false })]
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const provider = state.providers[0] as IdentityProvider
    qc.setQueryData(['settings', 'identityProviders'], [provider])
    qc.setQueryData(['settings', 'authConfig'], state.authConfig)
    qc.setQueryData(['admin', 'authProviderStatus'], state.credentialStatus)
    qc.setQueryData(['settings', 'identityProviders', provider.id, 'accountCount'], { count: 0 })
    qc.setQueryData(['admin', 'userAttributes'], [])
    render(
      <QueryClientProvider client={qc}>
        <ProviderDetailPage providerId={provider.id} autoTest onAutoTestConsumed={consumed} />
      </QueryClientProvider>
    )
    await waitFor(() => expect(openTestSpy).toHaveBeenCalledTimes(1))
    // A passing test on a disabled provider offers Enable sign-in as the
    // completion step.
    expect(openTestSpy.mock.calls[0][0]).toMatchObject({
      registrationId: 'oidc_x',
      successAction: { label: 'Enable sign-in' },
    })
    expect(consumed).toHaveBeenCalledTimes(1)
  })

  it('does not offer Enable sign-in after a test on an already enabled provider', () => {
    renderPage(makeProvider({ enabled: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Test sign-in' }))
    expect(openTestSpy.mock.calls[0][0].successAction).toBeUndefined()
  })
})

/**
 * `enabled` is a real control on the page. That let an admin configure a
 * provider, test it, save and close with nobody able to sign in through it.
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

/**
 * Connection: a summary while it works, a form only behind Edit. A provider
 * with no saved secret has nothing to summarise and opens on the form.
 */
describe('<ProviderDetailPage> connection', () => {
  it('summarises a working connection instead of showing the form', () => {
    renderPage(
      makeProvider({
        kind: 'okta',
        lastSuccessfulTestAt: '2026-05-02T00:00:00.000Z',
        lastTestCapture: {
          registrationId: 'oidc_x',
          capturedAt: '2026-05-02T00:00:00.000Z',
          identity: { id: 's', name: 'Jane Smith', email: 'jane@acme.com', sources: {} },
          claims: { sub: 's' },
        },
      })
    )
    expect(screen.getByText(/Connected as Jane Smith/)).toBeInTheDocument()
    expect(screen.getByText('jane@acme.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test again' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Client ID')).not.toBeInTheDocument()
    // Provenance and raw claims stay reachable for troubleshooting.
    expect(screen.getByText('View test details')).toBeInTheDocument()
  })

  it('shows "Not tested yet" when the provider has no successful test', () => {
    renderPage(makeProvider({ lastSuccessfulTestAt: null }))
    expect(screen.getByText(/Not tested yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test sign-in' })).not.toBeDisabled()
  })

  it('shows the stale state when the connection changed since the last test', () => {
    renderPage(
      makeProvider({
        lastSuccessfulTestAt: '2026-05-01T00:00:00.000Z',
        detailsChangedAt: '2026-05-02T00:00:00.000Z',
      })
    )
    expect(screen.getByText(/changed since the last test/)).toBeInTheDocument()
  })

  it('opens on the form when no client secret is saved', () => {
    renderPage(makeProvider({ configured: false }))
    expect(screen.getByLabelText('Client ID')).toBeInTheDocument()
    expect(screen.getByText('No client secret')).toBeInTheDocument()
  })

  it('shows the selected provider with a Change action rather than the tiles', () => {
    renderPage(makeProvider({ kind: 'okta' }))
    editConnection()
    expect(within(document.getElementById('connection')!).getByText('Okta')).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Okta' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByRole('radio', { name: 'Okta' })).toBeChecked()
  })

  it('falls back to URL inference when kind is null (legacy row on a known domain)', () => {
    renderPage(
      makeProvider({
        kind: null,
        discoveryUrl: 'https://acme.okta.com/.well-known/openid-configuration',
      })
    )
    editConnection()
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByRole('radio', { name: 'Okta' })).toBeChecked()
  })

  it('carries the persisted kind to the server on save and returns to the summary', async () => {
    renderPage(makeProvider({ kind: 'okta' }))
    editConnection()
    saveConnection()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1))
    expect(lastUpsert().kind).toBe('okta')
    // Identity columns are resent unchanged; nothing from another section is.
    expect(lastUpsert().label).toBe('Acme SSO')
    expect(lastUpsert()).not.toHaveProperty('showButton')
    expect(lastUpsert()).not.toHaveProperty('autoCreateUsers')
    await waitFor(() => expect(screen.queryByLabelText('Client ID')).not.toBeInTheDocument())
  })

  it('persists a newly selected tile', async () => {
    renderPage(makeProvider({ kind: 'okta' }))
    editConnection()
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Auth0' }))
    saveConnection()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().kind).toBe('auth0')
  })

  it('saves a typed secret after the connection and then opens the test', async () => {
    renderPage(makeProvider({}))
    editConnection()
    fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 's3cret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }))
    await waitFor(() => expect(credentialsSpy).toHaveBeenCalled())
    expect(credentialsSpy.mock.calls[0][0].data).toEqual({ id: 'idp_x', clientSecret: 's3cret' })
    await waitFor(() => expect(openTestSpy).toHaveBeenCalledTimes(1))
  })

  it('refuses to save a blank client ID and focuses the field', async () => {
    renderPage(makeProvider({}))
    editConnection()
    await userEvent.clear(screen.getByLabelText('Client ID'))
    saveConnection()
    await waitFor(() => expect(screen.getByLabelText('Client ID')).toHaveFocus())
    expect(upsertSpy).not.toHaveBeenCalled()
  })

  const noEmailCapture = {
    version: 2 as const,
    registrationId: 'oidc_x',
    capturedAt: '2026-05-02T00:00:00.000Z',
    detailsChangedAtAtStart: null,
    outcome: 'mapping_failed' as const,
    claims: { sub: 's', name: 'No Email' },
    replay: {
      sources: [
        { source: 'idToken' as const, claims: { sub: 's', name: 'No Email' } },
        { source: 'userinfo' as const, unavailable: 'fetch_failed' as const },
      ],
    },
  }
  const allowWithoutEmail = () =>
    fireEvent.click(
      screen.getByRole('button', { name: 'Let people sign in without an email address' })
    )

  it('offers to allow sign-in without email when the test account had none', async () => {
    // An earlier test passed, but the newest capture failed: the failure is
    // the summary, not "Connected as" the account that could not sign in.
    renderPage(
      makeProvider({
        lastSuccessfulTestAt: '2026-05-01T00:00:00.000Z',
        lastTestCapture: noEmailCapture,
      })
    )
    expect(screen.getByText(/test account has no email address/)).toBeInTheDocument()
    expect(screen.queryByText(/Connected/)).not.toBeInTheDocument()
    expect(screen.queryByText(/changed since the last test/)).not.toBeInTheDocument()
    allowWithoutEmail()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastSavedMapping()).toEqual({ profile: { allowMissingEmail: true } })
    expect(lastMapping().acknowledgeAdminRules).toBeFalsy()
  })

  it('acknowledges pre-existing admin rules when allowing sign-in without email', async () => {
    const claimMapping = {
      role: {
        claimPath: 'groups',
        rules: [{ whenContains: 'platform-admins', role: 'admin' as const }],
      },
    }
    renderPage(makeProvider({ claimMapping, lastTestCapture: noEmailCapture }))
    allowWithoutEmail()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    // The server rejects any mapping write that leaves admin rules in place
    // unless they are acknowledged; the rules themselves are untouched.
    expect(lastMapping().acknowledgeAdminRules).toBe(true)
    expect(lastSavedMapping()).toEqual({ ...claimMapping, profile: { allowMissingEmail: true } })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

/**
 * Connection options — scopes, prompt and client authentication — live in a
 * disclosure that is closed unless a value is off its default.
 */
describe('<ProviderDetailPage> connection options', () => {
  it('collapses the options for a provider on the defaults', () => {
    renderPage(makeProvider({ scopes: null }))
    editConnection()
    expect(screen.getByRole('button', { name: /Connection options/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('auto-expands when the provider has a custom scope set', () => {
    // Otherwise a non-default configuration is invisible behind a closed panel.
    renderPage(makeProvider({ scopes: 'openid public' }))
    editConnection()
    expect(screen.getByRole('button', { name: /Connection options/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('auto-expands when a non-default prompt is set', () => {
    renderPage(makeProvider({ prompt: 'omit' }))
    editConnection()
    expect(screen.getByRole('button', { name: /Connection options/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('prefills the effective scopes and does not offer to remove openid', () => {
    renderPage(makeProvider({ scopes: null }))
    editConnection()
    openConnectionOptions()
    for (const scope of ['openid', 'email', 'profile']) {
      expect(screen.getByTestId(`scope-token-${scope}`)).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Remove scope openid' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove scope email' })).toBeInTheDocument()
  })

  it('saves null for scopes, prompt and client auth when the defaults are untouched', async () => {
    renderPage(makeProvider({ scopes: null, prompt: null, tokenEndpointAuthMethod: null }))
    editConnection()
    saveConnection()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().scopes).toBeNull()
    expect(lastUpsert().prompt).toBeNull()
    expect(lastUpsert().tokenEndpointAuthMethod).toBeNull()
  })

  it('saves the reduced set after removing scopes', async () => {
    renderPage(makeProvider({ scopes: null }))
    editConnection()
    openConnectionOptions()
    fireEvent.click(screen.getByRole('button', { name: 'Remove scope email' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove scope profile' }))
    saveConnection()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().scopes).toBe('openid')
  })

  it('adds a scope typed by the admin', async () => {
    renderPage(makeProvider({ scopes: null }))
    editConnection()
    openConnectionOptions()
    fireEvent.change(screen.getByLabelText('Add a scope'), { target: { value: 'public' } })
    fireEvent.submit(screen.getByTestId('scope-add-form'))
    saveConnection()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().scopes).toBe('openid email profile public')
  })

  it('round-trips a custom set and prompt without rewriting them', async () => {
    renderPage(makeProvider({ scopes: 'openid public', prompt: 'omit' }))
    editConnection()
    saveConnection()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().scopes).toBe('openid public')
    expect(lastUpsert().prompt).toBe('omit')
  })

  it('warns about scopes the IdP does not advertise and can reduce to them', async () => {
    discoveryScopesSpy.mockResolvedValueOnce({ scopesSupported: ['public', 'openid'] })
    renderPage(makeProvider({ scopes: null }))
    editConnection()
    openConnectionOptions()
    await waitFor(() => {
      expect(screen.getByTestId('scope-mismatch-warning')).toHaveTextContent('email')
    })
    expect(screen.getByTestId('scope-mismatch-warning')).toHaveTextContent('profile')
    fireEvent.click(screen.getByRole('button', { name: 'Use advertised scopes' }))
    saveConnection()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().scopes).toBe('openid')
  })

  it('says nothing when the IdP advertises no scope list', async () => {
    // Absent means unknown, not unsupported — the field is only RECOMMENDED.
    discoveryScopesSpy.mockResolvedValueOnce({ scopesSupported: null })
    renderPage(makeProvider({ scopes: null }))
    editConnection()
    openConnectionOptions()
    await waitFor(() => expect(discoveryScopesSpy).toHaveBeenCalled())
    expect(screen.queryByTestId('scope-mismatch-warning')).not.toBeInTheDocument()
  })

  it('offers omit and none as separate prompt choices and exposes client auth', async () => {
    renderPage(makeProvider({}))
    editConnection()
    openConnectionOptions()
    expect(screen.getByLabelText('Client authentication')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Sign-in prompt'))
    await waitFor(() => expect(screen.getByTestId('prompt-choice-omit')).toBeInTheDocument())
    expect(screen.getByTestId('prompt-choice-none')).toBeInTheDocument()
  })

  it('offers manual endpoints only for a custom provider', () => {
    renderPage(makeProvider({ kind: 'okta' }))
    editConnection()
    openConnectionOptions()
    expect(screen.queryByText('Manual endpoints')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Custom OIDC' }))
    expect(screen.getByText('Manual endpoints')).toBeInTheDocument()
  })
})

/**
 * Sign-in & access: the explicit access decisions, saved together. Domains
 * save themselves.
 */
describe('<ProviderDetailPage> sign-in & access', () => {
  it('shows the button switch and hides the enforcement control for a no-domain provider', () => {
    renderPage(makeProvider({ domains: [] }))
    expect(screen.getByRole('switch', { name: 'Show sign-in button' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/require sso/i)).toBeNull()
  })

  it('shows the enforcement control for a verified-domain provider', () => {
    renderPage(makeProvider({ domains: [verifiedDomain] }))
    expect(screen.getByLabelText(/require sso for acme\.com/i)).toBeInTheDocument()
  })

  it('leaves enforcement locked until the connection carries a fresh test', () => {
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
    expect(screen.getByText(/Before you require SSO/)).toBeInTheDocument()
  })

  it('saves the button, creation and role choices together and nothing else', async () => {
    renderPage(makeProvider({ showButton: false, autoCreateUsers: true }))
    fireEvent.click(screen.getByRole('switch', { name: 'Show sign-in button' }))
    saveSignIn()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert()).toMatchObject({
      showButton: true,
      autoCreateUsers: true,
      autoProvisionRole: 'user',
      label: 'Acme SSO',
    })
    expect(lastUpsert()).not.toHaveProperty('claimMapping')
    expect(lastUpsert()).not.toHaveProperty('scopes')
    expect(mappingSpy).not.toHaveBeenCalled()
  })

  it('nulls the new account role when creation is turned off', async () => {
    renderPage(makeProvider({ autoCreateUsers: true, autoProvisionRole: 'member' }))
    expect(screen.getByLabelText('New account role')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('switch', { name: 'Create accounts on first sign-in' }))
    expect(screen.queryByLabelText('New account role')).not.toBeInTheDocument()
    saveSignIn()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert()).toMatchObject({ autoCreateUsers: false, autoProvisionRole: null })
  })

  it('keeps the display name and logo under Sign-in appearance', async () => {
    renderPage(makeProvider({ label: 'Acme SSO' }))
    expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Sign-in appearance/ }))
    expect(screen.getByText('Logo')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Acme Login' } })
    saveSignIn()
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(lastUpsert().label).toBe('Acme Login')
  })

  it('refuses to save a blank display name and focuses the field', async () => {
    renderPage(makeProvider({}))
    fireEvent.click(screen.getByRole('button', { name: /Sign-in appearance/ }))
    await userEvent.clear(screen.getByLabelText('Display name'))
    saveSignIn()
    await waitFor(() => expect(screen.getByLabelText('Display name')).toHaveFocus())
    expect(upsertSpy).not.toHaveBeenCalled()
  })
})

/**
 * Signing in without an email address: explicit, off by default, under
 * Account options. Minting a placeholder is one-way, so the copy says so.
 */
describe('<ProviderDetailPage> account options', () => {
  const openAccountOptions = () =>
    fireEvent.click(screen.getByRole('button', { name: /Account options/ }))
  const missingEmail = () => screen.getByLabelText('Let people sign in without an email address')

  it('is off and collapsed for a provider that has never been configured', () => {
    renderPage(makeProvider({ claimMapping: null }))
    expect(screen.getByRole('button', { name: /Account options/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    openAccountOptions()
    expect(missingEmail()).not.toBeChecked()
  })

  it('is open and checked for a provider that has opted in, and explains the placeholder', () => {
    renderPage(makeProvider({ claimMapping: { profile: { allowMissingEmail: true } } }))
    expect(missingEmail()).toBeChecked()
    expect(screen.getByText(/permanent placeholder address/)).toBeInTheDocument()
  })

  it('persists the opt-in without disturbing the role section', async () => {
    renderPage(
      makeProvider({
        claimMapping: {
          role: { claimPath: 'groups', rules: [{ whenContains: 'a', role: 'admin' }] },
        },
      })
    )
    openAccountOptions()
    await userEvent.click(missingEmail())
    saveSignIn()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    const sent = lastSavedMapping() as {
      profile?: { allowMissingEmail?: boolean }
      role?: { claimPath?: string }
    }
    expect(sent.profile?.allowMissingEmail).toBe(true)
    expect(sent.role?.claimPath).toBe('groups')
    // The admin rule pre-exists and is untouched: acknowledged, not re-confirmed.
    expect(lastMapping().acknowledgeAdminRules).toBe(true)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('carries the attributes section through the write verbatim', async () => {
    const attributes = { map: [{ claimPath: 'dept', attributeKey: 'department' }] }
    renderPage(makeProvider({ claimMapping: { attributes } }))
    openAccountOptions()
    await userEvent.click(missingEmail())
    saveSignIn()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect((lastSavedMapping() as { attributes?: unknown }).attributes).toEqual(attributes)
  })
})

/**
 * User details rests on one sentence. Customize opens the editor; existing
 * custom mappings show directly.
 */
describe('<ProviderDetailPage> user details', () => {
  it('shows the standard summary with no table for an unconfigured mapping', () => {
    renderPage(makeProvider({ claimMapping: null }))
    expect(screen.getByText('Uses standard profile fields')).toBeInTheDocument()
    expect(screen.getByText('No role rules or custom attributes.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Customize' })).toBeInTheDocument()
  })

  it('shows custom mappings directly and marks only the exception', () => {
    renderPage(
      makeProvider({
        claimMapping: {
          profile: { claims: { email: 'upn' } },
          role: { claimPath: 'groups', rules: [{ whenContains: 'eng', role: 'member' }] },
        },
      })
    )
    expect(screen.queryByText('Uses standard profile fields')).not.toBeInTheDocument()
    expect(screen.getByText('upn')).toBeInTheDocument()
    expect(screen.getAllByText('Custom')).toHaveLength(1)
    expect(screen.queryByText('Default')).not.toBeInTheDocument()
    expect(screen.getByText('groups')).toBeInTheDocument()
  })

  it('shows a stored profile claim this UI cannot edit instead of calling the mapping standard', () => {
    renderPage(
      makeProvider({
        claimMapping: {
          profile: { claims: { username: 'preferred_username' } as Record<string, string> },
        },
      })
    )
    // id / email / name are still standard, but the resting view must not
    // collapse to the one-sentence summary and hide the stored row.
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('username')).toBeInTheDocument()
    expect(screen.getByText(/not editable here/)).toBeInTheDocument()
  })

  it('names a non-standard source list as a compatibility exception', () => {
    renderPage(
      makeProvider({
        claimMapping: { profile: { sources: ['idToken', 'userinfo', 'accessTokenJwt'] } },
      })
    )
    expect(screen.getByTestId('compatibility-sources')).toHaveTextContent('Access-token JWT')
  })

  it('opens the compact editor with the three profile fields and no Default badges', () => {
    renderPage(makeProvider({ claimMapping: null }))
    customize()
    for (const [label, path] of [
      ['Account ID', 'sub'],
      ['Email', 'email'],
      ['Name', 'name'],
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
      expect(screen.getByText(path)).toBeInTheDocument()
    }
    expect(screen.queryByText('Default')).not.toBeInTheDocument()
    expect(
      screen.getByText('Email and name are set when an account is created.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add mapping' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Customize' })).not.toBeInTheDocument()
  })

  it('keeps the source controls inside Compatibility, closed for standard sources', () => {
    renderPage(makeProvider({ claimMapping: null }))
    customize()
    expect(screen.queryByTestId('identity-sources-editor')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Compatibility/ }))
    expect(screen.getByTestId('identity-sources-editor')).toBeInTheDocument()
    expect(screen.getByLabelText('Access-token JWT')).not.toBeChecked()
  })

  it('opens Compatibility when the stored sources are non-standard', () => {
    renderPage(
      makeProvider({
        claimMapping: { profile: { sources: ['idToken', 'userinfo', 'accessTokenJwt'] } },
      })
    )
    customize()
    expect(screen.getByLabelText('Access-token JWT')).toBeChecked()
  })

  it('does not write anything for an untouched standard mapping', async () => {
    renderPage(makeProvider({ claimMapping: null }))
    customize()
    saveUserDetails()
    await waitFor(() =>
      expect(screen.getByText('Uses standard profile fields')).toBeInTheDocument()
    )
    expect(mappingSpy).not.toHaveBeenCalled()
  })

  it('does not suggest a mapping from a test capture', () => {
    ssoTestRef.current = {
      registrationId: 'oidc_x',
      capturedAt: '2026-09-01T00:00:00.000Z',
      identity: { id: 's', sources: { id: 'idToken' } },
      claims: { roles: ['admin'] },
    }
    renderPage(makeProvider({ autoCreateUsers: true, claimMapping: null }))
    expect(screen.getByText('Uses standard profile fields')).toBeInTheDocument()
    customize()
    expect(screen.queryByText('Role')).not.toBeInTheDocument()
  })

  it('confirms an Account ID change before saving', async () => {
    renderPage(makeProvider({ claimMapping: null }))
    customize()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Account ID mapping' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Provider claim' }))
    fireEvent.change(screen.getByPlaceholderText('Search or type…'), { target: { value: 'oid' } })
    fireEvent.click(screen.getByText(/Use ["“]oid["”]/))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    fireEvent.click(section('mapping').getByRole('button', { name: 'Save changes' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/Changing the Account ID/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastMapping().acknowledgeIdentifierChange).toBe(true)
    expect(lastSavedMapping()).toEqual({ profile: { claims: { id: 'oid' } } })
  })
})

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

const matchingCapture: SsoTestCapture = {
  version: 2 as const,
  registrationId: 'oidc_x',
  capturedAt: '2026-09-01T00:00:00.000Z',
  detailsChangedAtAtStart: null,
  outcome: 'success' as const,
  identity: { id: 'sub', email: 'alice@example.com', sources: { email: 'idToken' as const } },
  claims: { sub: 's', email: 'alice@example.com', department: 'Engineering' },
  replay: {
    sources: [
      {
        source: 'idToken' as const,
        claims: { sub: 's', email: 'alice@example.com', department: 'Engineering' },
      },
      { source: 'userinfo' as const, claims: { sub: 's' } as Record<string, string> },
    ],
  },
}

describe('<ProviderDetailPage> claim → person-attribute mapping', () => {
  it('adds a row, picks a claim path and attribute, and saves without touching role/profile', async () => {
    state.userAttributes = PEOPLE_ATTRS
    renderPage(makeProvider({ claimMapping: null }))
    customize()
    fireEvent.click(screen.getByRole('button', { name: 'Add mapping' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Set from this provider' }))
    fireEvent.click(screen.getByRole('option', { name: /Department/ }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Provider claim' }))
    fireEvent.change(screen.getByPlaceholderText('Search or type…'), {
      target: { value: 'department' },
    })
    fireEvent.click(screen.getByText(/Use ["“]department["”]/))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    saveUserDetails()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    const sent = lastSavedMapping() as {
      attributes?: { map?: Array<{ claimPath: string; attributeKey: string }> }
      role?: unknown
      profile?: unknown
    }
    expect(sent.attributes?.map).toEqual([{ claimPath: 'department', attributeKey: 'department' }])
    expect(sent).not.toHaveProperty('role')
    expect(sent).not.toHaveProperty('profile')
  })

  it('removes a draft row with Undo instead of a confirmation', async () => {
    state.userAttributes = PEOPLE_ATTRS
    renderPage(
      makeProvider({
        claimMapping: {
          attributes: { map: [{ claimPath: 'department', attributeKey: 'department' }] },
        },
      })
    )
    customize()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Department mapping' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Department')).not.toBeInTheDocument()
    const [message, options] = toastSpy.mock.calls.at(-1)! as [
      string,
      { action: { label: string; onClick: () => void } },
    ]
    expect(message).toMatch(/Removed the Department mapping/)
    expect(options.action.label).toBe('Undo')
    // Undo restores the row before anything is written.
    options.action.onClick()
    await waitFor(() => expect(screen.getByText('Department')).toBeInTheDocument())
    expect(mappingSpy).not.toHaveBeenCalled()
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
    customize()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Department mapping' }))
    saveUserDetails()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastSavedMapping()).toBeNull()
  })

  it('persists overrideExisting and syncOnSignIn', async () => {
    state.userAttributes = PEOPLE_ATTRS
    renderPage(
      makeProvider({
        claimMapping: {
          attributes: { map: [{ claimPath: 'department', attributeKey: 'department' }] },
        },
      })
    )
    customize()
    await userEvent.click(screen.getByLabelText('Overwrite attribute values that are already set'))
    await userEvent.click(screen.getByLabelText('Clear an attribute when its claim is missing'))
    saveUserDetails()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    const sent = lastSavedMapping() as {
      attributes?: { overrideExisting?: boolean; syncOnSignIn?: boolean }
    }
    expect(sent.attributes?.overrideExisting).toBe(true)
    expect(sent.attributes?.syncOnSignIn).toBe(true)
  })

  it('points at People settings when there are no definitions left to map', () => {
    state.userAttributes = []
    renderPage(
      makeProvider({
        claimMapping: {
          role: { claimPath: 'groups', rules: [{ whenContains: 'eng', role: 'member' }] },
        },
      })
    )
    customize()
    fireEvent.click(screen.getByRole('button', { name: 'Add mapping' }))
    expect(screen.getByRole('link', { name: 'Open People settings' })).toHaveAttribute(
      'href',
      '/admin/settings/people'
    )
  })

  it('keeps an orphan row visible and removable when its definition is gone', async () => {
    state.userAttributes = []
    renderPage(
      makeProvider({
        claimMapping: {
          attributes: { map: [{ claimPath: 'cc', attributeKey: 'cost_center' }] },
        },
      })
    )
    expect(screen.getByText('Attribute no longer exists')).toBeInTheDocument()
    customize()
    fireEvent.click(screen.getByRole('button', { name: 'Remove cost_center mapping' }))
    saveUserDetails()
    await waitFor(() => expect(mappingSpy).toHaveBeenCalled())
    expect(lastSavedMapping()).toBeNull()
  })

  it('previews a written value and a missing-claim skip from a matching capture', () => {
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
    customize()
    expect(screen.getByText(/“Engineering”/)).toBeInTheDocument()
    expect(screen.getByText(/skipped: missing claim/)).toBeInTheDocument()
  })

  it('prefers an in-session test over a persisted capture for the same provider', () => {
    state.userAttributes = PEOPLE_ATTRS
    ssoTestRef.current = {
      ...matchingCapture,
      capturedAt: '2026-09-02T00:00:00.000Z',
      claims: { sub: 's', email: 'alice@example.com', department: 'From session' },
      replay: {
        sources: [
          {
            source: 'idToken',
            claims: { sub: 's', email: 'alice@example.com', department: 'From session' },
          },
          { source: 'userinfo', claims: { sub: 's' } },
        ],
      },
    } as SsoTestCapture
    renderPage(
      makeProvider({
        lastTestCapture: matchingCapture,
        claimMapping: {
          attributes: { map: [{ claimPath: 'department', attributeKey: 'department' }] },
        },
      })
    )
    customize()
    expect(screen.getByText(/“From session”/)).toBeInTheDocument()
    expect(screen.queryByText(/“Engineering”/)).not.toBeInTheDocument()
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
    customize()
    expect(screen.getByText(/Run a test sign-in to inspect this IdP's claims/)).toBeInTheDocument()
  })
})

/**
 * Removal lives in the header menu. Both refusals mirror server-side
 * invariants rather than being UI politeness.
 */
describe('<ProviderDetailPage> remove', () => {
  const openMenu = async () => {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Provider actions' }))
    return user
  }

  it('deletes and returns to the provider list once confirmed', async () => {
    state.accountCount = 0
    renderPage(makeProvider({}))
    const user = await openMenu()
    await user.click(await screen.findByRole('menuitem', { name: 'Remove provider' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith({ data: { id: 'idp_x' } }))
    await waitFor(() => expect(state.navigate).toHaveBeenCalled())
  })

  it('refuses while identities are linked and says how many', async () => {
    state.accountCount = 4
    renderPage(makeProvider({}))
    const user = await openMenu()
    await user.click(await screen.findByRole('menuitem', { name: 'Remove provider' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(toastSpy.error).toHaveBeenCalledWith(expect.stringMatching(/4 people sign in/))
    expect(deleteSpy).not.toHaveBeenCalled()
  })

  it('refuses to remove the only working sign-in method', async () => {
    state.authConfig = { oauth: { password: false } }
    renderPage(makeProvider({ enabled: true, configured: true }))
    const user = await openMenu()
    await user.click(await screen.findByRole('menuitem', { name: 'Remove provider' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(toastSpy.error).toHaveBeenCalledWith(expect.stringMatching(/only enabled sign-in/i))
  })
})
