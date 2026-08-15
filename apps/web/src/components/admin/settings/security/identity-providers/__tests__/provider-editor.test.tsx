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
import type { ReactNode } from 'react'
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
        prompt?: string | null
        scopes?: string | null
      }
    }) => undefined
  ),
}))

const { ssoTestRef } = vi.hoisted(() => ({
  ssoTestRef: {
    current: null as null | {
      registrationId: string
      capturedAt: string
      identity: {
        id: string
        email?: string
        name?: string
        sources: Partial<Record<'id' | 'email' | 'name', string>>
      }
      claims: Record<string, unknown>
    },
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
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}))

vi.mock('@/lib/server/functions/sso', () => ({
  upsertIdentityProviderFn: upsertSpy,
  setProviderCredentialsFn: vi.fn(async () => ({ success: true })),
  deleteIdentityProviderFn: vi.fn(),
  addProviderDomainFn: vi.fn(),
  verifyProviderDomainFn: vi.fn(),
  setDomainEnforcedFn: vi.fn(),
  removeVerifiedDomainFn: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// Stub the Test sign-in button so the editor doesn't pull in the test-flow
// server fns / context.
vi.mock('../../sso/test-sign-in-button', () => ({
  TestSignInButton: ({ disabled, children }: { disabled?: boolean; children?: ReactNode }) => (
    <button type="button" disabled={disabled}>
      {children ?? 'Test sign-in'}
    </button>
  ),
}))

vi.mock('@/lib/client/hooks/use-user-attributes-queries', () => ({
  useUserAttributes: () => ({
    data: [
      { key: 'department', label: 'Department', type: 'string' },
      { key: 'mrr', label: 'MRR', type: 'number' },
    ],
  }),
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

function makeCapture(
  over: Partial<NonNullable<(typeof ssoTestRef)['current']>> & {
    claims: Record<string, unknown>
  }
): NonNullable<(typeof ssoTestRef)['current']> {
  return {
    registrationId: 'oidc_x',
    capturedAt: '2026-08-15T12:00:00.000Z',
    identity: {
      id: '00u1',
      email: 'jane@acme.com',
      name: 'Jane Diaz',
      sources: { id: 'idToken', email: 'idToken', name: 'userinfo' },
    },
    ...over,
  }
}

function typeClaimPath(ariaLabel: string, value: string) {
  fireEvent.click(screen.getByRole('combobox', { name: ariaLabel }))
  fireEvent.change(screen.getByPlaceholderText('Search or type…'), { target: { value } })
  fireEvent.click(screen.getByText(new RegExp(`Use ["“]${value}["”]`)))
}

function renderEditor(
  provider: IdentityProvider,
  opts: { onOpenChange?: (open: boolean) => void } = {}
) {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <ProviderEditor provider={provider} open onOpenChange={opts.onOpenChange ?? vi.fn()} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  upsertSpy.mockClear()
  ssoTestRef.current = null
})

describe('<ProviderEditor> provisioning consolidation', () => {
  it('shows a single Default role and a collapsed group-mapping disclosure when no rules', () => {
    renderEditor(
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

  it('hides default role when auto-create is off but keeps claim-to-role mapping', () => {
    renderEditor(makeProvider({ autoCreateUsers: false }))
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
    expect(screen.getByText(/months ago|hours ago|days ago|just now/i)).toBeInTheDocument()
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
  it('names the observed claims inline and drops the old assist block', () => {
    ssoTestRef.current = makeCapture({
      claims: { groups: ['11111111-2222'], roles: ['admin'] },
    })
    renderEditor(makeProvider({ autoCreateUsers: true, claimMapping: null }))
    expect(screen.getByText('From your test sign-in: groups, roles')).toBeInTheDocument()
    expect(screen.queryByText(/Run a test as another user/)).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Claim path' })).toBeInTheDocument()
  })

  it('auto-fills the claim path when the test returned exactly one array claim', () => {
    ssoTestRef.current = makeCapture({ claims: { roles: ['admin'] } })
    renderEditor(makeProvider({ autoCreateUsers: true, claimMapping: null }))
    expect(screen.getByRole('combobox', { name: 'Claim path' })).toHaveTextContent('roles')
  })

  it('offers the same suggestions on identity and attribute claim paths', () => {
    ssoTestRef.current = makeCapture({
      claims: { groups: ['eng'], email: 'jane@acme.com', department: 'Eng' },
    })
    renderEditor(makeProvider({ autoCreateUsers: true, claimMapping: null }))
    fireEvent.click(screen.getByRole('button', { name: 'Add mapping' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Email claim' }))
    expect(screen.getAllByText('email').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('combobox', { name: 'Claim path (attribute 1)' }))
    expect(screen.getAllByText('groups').length).toBeGreaterThan(0)
  })

  it('persists allowMissingEmail, access-token source, and attribute map', async () => {
    renderEditor(makeProvider({ autoCreateUsers: true, claimMapping: null }))
    fireEvent.click(screen.getByLabelText('Allow accounts without an email address'))
    fireEvent.click(screen.getByLabelText('Access token JWT'))
    fireEvent.click(screen.getByRole('button', { name: 'Add mapping' }))
    typeClaimPath('Claim path (attribute 1)', 'department')
    fireEvent.click(screen.getByLabelText('Mirror the IdP for attributes'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    const saved = upsertSpy.mock.calls.at(-1)![0].data.claimMapping as {
      profile?: { allowMissingEmail?: boolean; sources?: string[] }
      attributes?: {
        map?: Array<{ claimPath: string; attributeKey: string }>
        overrideExisting?: boolean
        syncOnSignIn?: boolean
      }
    }
    expect(saved.profile?.allowMissingEmail).toBe(true)
    expect(saved.profile?.sources).toEqual(['idToken', 'userinfo', 'accessTokenJwt'])
    expect(saved.attributes?.map).toEqual([{ claimPath: 'department', attributeKey: 'department' }])
    expect(saved.attributes?.overrideExisting).toBe(true)
    expect(saved.attributes?.syncOnSignIn).toBe(true)
  })

  it('persists a non-default prompt from Advanced', async () => {
    renderEditor(makeProvider({ prompt: null }))
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    fireEvent.click(screen.getByLabelText('Sign-in prompt'))
    fireEvent.click(screen.getByTestId('prompt-choice-omit'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(upsertSpy.mock.calls.at(-1)![0].data.prompt).toBe('omit')
  })
})

describe('<ProviderEditor> claim-mapping autocomplete leftovers', () => {
  it('shows no inline suggestions for a test of a different provider', () => {
    ssoTestRef.current = makeCapture({
      registrationId: 'oidc_other',
      claims: { roles: ['admin'] },
    })
    renderEditor(
      makeProvider({
        autoCreateUsers: true,
        claimMapping: { role: { claimPath: 'groups', rules: [] } },
      })
    )
    expect(screen.queryByText(/From your test sign-in:/)).not.toBeInTheDocument()
  })
})

describe('<ProviderEditor> save stays open', () => {
  it('keeps the editor open after save and labels the dismiss action Close', async () => {
    const onOpenChange = vi.fn()
    renderEditor(makeProvider({}), { onOpenChange })
    expect(screen.getByText('Saving keeps this editor open.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Edit identity provider' })).toBeInTheDocument()
  })
})

describe('<ProviderEditor> task groups', () => {
  it('orders Connect, Verify, Identity, Access, Rollout', () => {
    renderEditor(makeProvider({}))
    const groups = ['Connect', 'Verify', 'Identity', 'Access', 'Rollout']
    const positions = groups.map((g) => screen.getByText(g).compareDocumentPosition)
    const texts = groups.map((g) => screen.getByText(g))
    for (let i = 1; i < texts.length; i++) {
      expect(
        texts[i - 1]!.compareDocumentPosition(texts[i]!) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    }
    expect(positions.length).toBe(5)
  })
})

describe('<ProviderEditor> outcome preview', () => {
  it('hides the rail when there is no capture', () => {
    renderEditor(makeProvider({}))
    expect(screen.queryByText('Outcome preview')).not.toBeInTheDocument()
  })

  it('evaluates a typed claim path against the capture with no fetch', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    ssoTestRef.current = makeCapture({
      claims: { email: 'jane@acme.com', upn: 'jane.diaz@acme.com', name: 'Jane Diaz' },
    })
    renderEditor(makeProvider({}))
    expect(screen.getByText('Outcome preview')).toBeInTheDocument()
    expect(screen.getByText('jane@acme.com')).toBeInTheDocument()
    typeClaimPath('Email claim', 'upn')
    expect(screen.getByText('upn', { selector: 'span' })).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

describe('<ProviderEditor> scopes', () => {
  it('stores null for the default set and the string when groups is added', async () => {
    renderEditor(makeProvider({ scopes: null }))
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(upsertSpy.mock.calls.at(-1)![0].data.scopes).toBeNull()

    upsertSpy.mockClear()
    fireEvent.change(screen.getByLabelText('Scopes'), {
      target: { value: 'openid email profile groups' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(upsertSpy.mock.calls.at(-1)![0].data.scopes).toBe('openid email profile groups')
  })
})
