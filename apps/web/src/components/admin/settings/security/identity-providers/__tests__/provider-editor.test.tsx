// @vitest-environment happy-dom
/**
 * <ProviderEditor> — the IdP "shortcut" (kind) round-trips through the
 * persisted `kind` column, not URL inference.
 *
 * The load-bearing case: a provider on a *vanity* discovery domain (Okta at
 * `login.acme.com`) matches none of the `inferIdpKind` patterns, so before we
 * stored the choice the editor reopened on "Custom OIDC". With `kind`
 * persisted, the editor must always reopen on the tile the admin selected, and
 * a save must carry that `kind` to the server.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { IdentityProviderId } from '@quackback/ids'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { ProviderEditor } from '../provider-editor'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

const { upsertSpy } = vi.hoisted(() => ({
  upsertSpy: vi.fn(
    async (_args: {
      data: {
        kind: string | null
        claimMapping: unknown
        scopes: string | null
        prompt: string | null
        tokenEndpointAuthMethod: string | null
      }
    }) => undefined
  ),
}))

const { discoveryScopesSpy } = vi.hoisted(() => ({
  discoveryScopesSpy: vi.fn(async () => ({ scopesSupported: null as string[] | null })),
}))

const { ssoTestRef } = vi.hoisted(() => ({
  ssoTestRef: {
    current: null as null | { registrationId: string; allClaims: Record<string, unknown> },
  },
}))
vi.mock('../../sso/use-sso-test-sign-in', () => ({
  useSsoTestSignIn: () => ({ open: vi.fn(), lastSuccess: ssoTestRef.current }),
}))

// useServerFn just unwraps the server fn in the browser — return it as-is so
// the editor calls our spies directly.
vi.mock('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }))

vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({ baseUrl: 'https://app.example.com' }),
}))

vi.mock('@/lib/server/functions/sso', () => ({
  upsertIdentityProviderFn: upsertSpy,
  setProviderCredentialsFn: vi.fn(async () => ({ success: true })),
  deleteIdentityProviderFn: vi.fn(),
  addProviderDomainFn: vi.fn(),
  verifyProviderDomainFn: vi.fn(),
  fetchDiscoveryScopesFn: discoveryScopesSpy,
  setDomainEnforcedFn: vi.fn(),
  removeVerifiedDomainFn: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// Stub the Test sign-in button so the editor doesn't pull in the test-flow
// server fns / context.
vi.mock('../../sso/test-sign-in-button', () => ({
  TestSignInButton: ({ disabled }: { disabled?: boolean }) => (
    <button type="button" disabled={disabled}>
      Test sign-in
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
  }
}

function renderEditor(provider: IdentityProvider) {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <ProviderEditor provider={provider} open onOpenChange={vi.fn()} />
    </QueryClientProvider>
  )
}

/**
 * The editor is tabbed and inactive panels are unmounted, so anything outside
 * Connection has to be navigated to exactly as an admin would.
 */
async function openTab(name: 'Connection' | 'Sign-in' | 'Accounts') {
  await userEvent.click(screen.getByRole('tab', { name }))
}

beforeEach(() => {
  upsertSpy.mockClear()
  discoveryScopesSpy.mockClear()
  discoveryScopesSpy.mockResolvedValue({ scopesSupported: null })
  ssoTestRef.current = null
})

describe('<ProviderEditor> provisioning consolidation', () => {
  it('shows a single Default role and a collapsed group-mapping disclosure when no rules', async () => {
    renderEditor(
      makeProvider({ autoCreateUsers: true, autoProvisionRole: 'user', claimMapping: null })
    )
    await openTab('Accounts')
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

  it('keeps claim mapping reachable when auto-create is off', async () => {
    // Only the default role is creation-only. Identity resolution runs on every
    // sign-in, including for people who already have accounts, so hiding its
    // configuration behind "create accounts for new people" would hide a live
    // control from exactly the workspaces most likely to need it.
    renderEditor(makeProvider({ autoCreateUsers: false }))
    await openTab('Accounts')
    expect(screen.queryByLabelText('Default role')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Map roles from claims/ })).toBeInTheDocument()
  })

  it('persists claimMapping=null when saved with no rules and sync off', async () => {
    renderEditor(makeProvider({ autoCreateUsers: true, claimMapping: null }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(upsertSpy.mock.calls.at(-1)![0].data.claimMapping).toBeNull()
  })
})

describe('<ProviderEditor> IdP shortcut persistence', () => {
  it('selects the persisted family on open, even when the discovery URL infers a different one', () => {
    renderEditor(makeProvider({ kind: 'okta' }))
    expect(screen.getByRole('radio', { name: 'Okta' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Custom OIDC' })).not.toBeChecked()
  })

  it('falls back to URL inference when kind is null (legacy row on a known domain)', () => {
    renderEditor(
      makeProvider({
        kind: null,
        discoveryUrl: 'https://acme.okta.com/.well-known/openid-configuration',
      })
    )
    expect(screen.getByRole('radio', { name: 'Okta' })).toBeChecked()
  })

  it('carries the persisted kind to the server on save', async () => {
    renderEditor(makeProvider({ kind: 'okta' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1))
    expect(upsertSpy.mock.calls[0][0].data.kind).toBe('okta')
  })

  it('persists a newly selected tile', async () => {
    renderEditor(makeProvider({ kind: 'okta' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Auth0' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(upsertSpy.mock.calls.at(-1)![0].data.kind).toBe('auth0')
  })
})

describe('<ProviderEditor> connection-test status', () => {
  it('shows "Not tested yet" when the provider has no successful test', () => {
    renderEditor(makeProvider({ lastSuccessfulTestAt: null }))
    expect(screen.getByText(/Not tested yet/)).toBeInTheDocument()
  })

  it('shows the verified status (ready to enforce) for a fresh successful test', () => {
    renderEditor(
      makeProvider({ lastSuccessfulTestAt: '2026-05-02T00:00:00.000Z', detailsChangedAt: null })
    )
    expect(screen.getByText(/ready to enforce SSO/)).toBeInTheDocument()
  })

  it('shows the stale status when the connection changed since the last test', () => {
    renderEditor(
      makeProvider({
        lastSuccessfulTestAt: '2026-05-01T00:00:00.000Z',
        detailsChangedAt: '2026-05-02T00:00:00.000Z',
      })
    )
    expect(screen.getByText(/changed since the last test/)).toBeInTheDocument()
  })
})

describe('<ProviderEditor> claim-mapping autocomplete', () => {
  it('names the observed claims inline and drops the old assist block', async () => {
    ssoTestRef.current = {
      registrationId: 'oidc_x', // matches makeProvider().registrationId
      allClaims: { groups: ['11111111-2222'], roles: ['admin'] },
    }
    renderEditor(makeProvider({ autoCreateUsers: true, claimMapping: null }))
    await openTab('Accounts')
    // Inline hint names the observed claims (disclosure auto-opens on suggestions).
    expect(screen.getByText('From your test sign-in: groups, roles')).toBeInTheDocument()
    // The old batch-add block's caption is gone.
    expect(screen.queryByText(/Run a test as another user/)).not.toBeInTheDocument()
    // Claim path is now an autocomplete (combobox), not a plain textbox.
    expect(screen.getByRole('combobox', { name: 'Claim path' })).toBeInTheDocument()
  })

  it('auto-fills the claim path when the test returned exactly one array claim', async () => {
    ssoTestRef.current = { registrationId: 'oidc_x', allClaims: { roles: ['admin'] } }
    renderEditor(makeProvider({ autoCreateUsers: true, claimMapping: null }))
    await openTab('Accounts')
    expect(screen.getByRole('combobox', { name: 'Claim path' })).toHaveTextContent('roles')
  })

  it('shows no inline suggestions for a test of a different provider', () => {
    ssoTestRef.current = { registrationId: 'oidc_other', allClaims: { roles: ['admin'] } }
    renderEditor(
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
describe('<ProviderEditor> scopes', () => {
  const openAdvanced = () => {
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))
  }

  it('collapses Advanced by default for a provider on the default scopes', () => {
    renderEditor(makeProvider({ scopes: null }))
    expect(screen.getByRole('button', { name: /Advanced/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('auto-expands Advanced when the provider has a custom scope set', () => {
    // Otherwise a non-default configuration is invisible behind a closed panel.
    renderEditor(makeProvider({ scopes: 'openid public' }))
    expect(screen.getByRole('button', { name: /Advanced/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('prefills the effective scopes rather than an empty field', () => {
    renderEditor(makeProvider({ scopes: null }))
    openAdvanced()
    for (const scope of ['openid', 'email', 'profile']) {
      expect(screen.getByTestId(`scope-token-${scope}`)).toBeInTheDocument()
    }
  })

  it('does not offer to remove openid', () => {
    renderEditor(makeProvider({ scopes: null }))
    openAdvanced()
    expect(screen.queryByRole('button', { name: 'Remove scope openid' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove scope email' })).toBeInTheDocument()
  })

  it('saves null when the admin leaves the defaults untouched', async () => {
    renderEditor(makeProvider({ scopes: null }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(upsertSpy.mock.calls[0][0].data.scopes).toBeNull()
  })

  it('saves the reduced set after removing a scope the IdP does not support', async () => {
    // An IdP that advertises only `public` and `openid`, so the default set
    // is rejected outright.
    renderEditor(makeProvider({ scopes: null }))
    openAdvanced()
    fireEvent.click(screen.getByRole('button', { name: 'Remove scope email' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove scope profile' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(upsertSpy.mock.calls[0][0].data.scopes).toBe('openid')
  })

  it('adds a scope typed by the admin', async () => {
    renderEditor(makeProvider({ scopes: null }))
    openAdvanced()
    fireEvent.change(screen.getByLabelText('Add a scope'), { target: { value: 'public' } })
    fireEvent.submit(screen.getByTestId('scope-add-form'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(upsertSpy.mock.calls[0][0].data.scopes).toBe('openid email profile public')
  })

  it('round-trips a custom set without rewriting it', async () => {
    renderEditor(makeProvider({ scopes: 'openid public' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(upsertSpy.mock.calls[0][0].data.scopes).toBe('openid public')
  })
})

/**
 * Inline scope validation against the discovery document.
 *
 * This is the check that would have caught the reported failure at
 * configuration time rather than as an opaque `invalid_scope` after a round
 * trip through the IdP.
 */
describe('<ProviderEditor> scope validation', () => {
  const openAdvanced = () => fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))

  it('warns about scopes the IdP does not advertise', async () => {
    discoveryScopesSpy.mockResolvedValueOnce({ scopesSupported: ['public', 'openid'] })
    renderEditor(makeProvider({ scopes: null }))
    openAdvanced()
    await waitFor(() => {
      expect(screen.getByTestId('scope-mismatch-warning')).toHaveTextContent('email')
    })
    expect(screen.getByTestId('scope-mismatch-warning')).toHaveTextContent('profile')
  })

  it('reduces the set to what the IdP advertises on one click', async () => {
    discoveryScopesSpy.mockResolvedValueOnce({ scopesSupported: ['public', 'openid'] })
    renderEditor(makeProvider({ scopes: null }))
    openAdvanced()
    await waitFor(() => expect(screen.getByTestId('scope-mismatch-warning')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Use supported scopes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(upsertSpy.mock.calls[0][0].data.scopes).toBe('openid')
  })

  it('says nothing when the IdP advertises no scope list', async () => {
    // Absent means unknown, not unsupported — the field is only RECOMMENDED.
    discoveryScopesSpy.mockResolvedValueOnce({ scopesSupported: null })
    renderEditor(makeProvider({ scopes: null }))
    openAdvanced()
    await waitFor(() => expect(discoveryScopesSpy).toHaveBeenCalled())
    expect(screen.queryByTestId('scope-mismatch-warning')).not.toBeInTheDocument()
  })

  it('says nothing when every scope is advertised', async () => {
    discoveryScopesSpy.mockResolvedValueOnce({
      scopesSupported: ['openid', 'email', 'profile'],
    })
    renderEditor(makeProvider({ scopes: null }))
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
describe('<ProviderEditor> request options', () => {
  const openAdvanced = () => fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))

  it('saves null for an untouched provider on the defaults', async () => {
    renderEditor(makeProvider({ prompt: null, tokenEndpointAuthMethod: null }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(upsertSpy.mock.calls[0][0].data.prompt).toBeNull()
    expect(upsertSpy.mock.calls[0][0].data.tokenEndpointAuthMethod).toBeNull()
  })

  it('round-trips a configured prompt without rewriting it', async () => {
    renderEditor(makeProvider({ prompt: 'omit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(upsertSpy.mock.calls[0][0].data.prompt).toBe('omit')
  })

  it('auto-expands Advanced when a non-default prompt is set', () => {
    // A non-default configuration must never sit hidden behind a closed panel.
    renderEditor(makeProvider({ prompt: 'login' }))
    expect(screen.getByRole('button', { name: /Advanced/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('offers omit and none as separate choices', async () => {
    // Collapsing them would read as a tidy-up and would break sign-in for
    // anyone who picked the wrong one.
    renderEditor(makeProvider({}))
    openAdvanced()
    fireEvent.click(screen.getByLabelText('Sign-in prompt'))
    await waitFor(() => expect(screen.getByTestId('prompt-choice-omit')).toBeInTheDocument())
    expect(screen.getByTestId('prompt-choice-none')).toBeInTheDocument()
  })

  it('exposes the client authentication method', () => {
    renderEditor(makeProvider({}))
    openAdvanced()
    expect(screen.getByLabelText('Client authentication')).toBeInTheDocument()
  })
})
