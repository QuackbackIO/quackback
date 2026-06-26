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
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { IdentityProviderId } from '@quackback/ids'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { ProviderEditor } from '../provider-editor'

const { upsertSpy } = vi.hoisted(() => ({
  upsertSpy: vi.fn(
    async (_args: { data: { kind: string | null; attributeMapping: unknown } }) => undefined
  ),
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

function renderEditor(provider: IdentityProvider) {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <ProviderEditor provider={provider} open onOpenChange={vi.fn()} />
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
      makeProvider({ autoCreateUsers: true, autoProvisionRole: 'user', attributeMapping: null })
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

  it('hides the role controls entirely when auto-create is off', () => {
    renderEditor(makeProvider({ autoCreateUsers: false }))
    expect(screen.queryByLabelText('Default role')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Map roles from claims/ })).not.toBeInTheDocument()
  })

  it('persists attributeMapping=null when saved with no rules and sync off', async () => {
    renderEditor(makeProvider({ autoCreateUsers: true, attributeMapping: null }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    expect(upsertSpy.mock.calls.at(-1)![0].data.attributeMapping).toBeNull()
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

describe('<ProviderEditor> claim-mapping assist', () => {
  it('shows suggestions from a matching test sign-in and adds a rule on click', async () => {
    ssoTestRef.current = {
      registrationId: 'oidc_x', // matches makeProvider().registrationId
      allClaims: { groups: ['11111111-2222', 'feedback-admins'] },
    }
    renderEditor(makeProvider({ autoCreateUsers: true, attributeMapping: null }))

    // The block is visible with the observed values (disclosure auto-opens).
    expect(screen.getByText('From your test sign-in')).toBeInTheDocument()
    expect(screen.getByText('11111111-2222')).toBeInTheDocument()

    // Add the first value as a rule, then save and assert it was persisted.
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalled())
    const mapping = upsertSpy.mock.calls.at(-1)![0].data.attributeMapping as {
      claimPath: string
      rules: { whenContains: string; role: string }[]
    }
    expect(mapping.claimPath).toBe('groups')
    expect(mapping.rules).toContainEqual({ whenContains: '11111111-2222', role: 'member' })
  })

  it('does not show the block for a test of a different provider', () => {
    ssoTestRef.current = { registrationId: 'oidc_other', allClaims: { groups: ['x'] } }
    renderEditor(makeProvider({ autoCreateUsers: true, attributeMapping: null }))
    expect(screen.queryByText('From your test sign-in')).not.toBeInTheDocument()
  })

  it('shows the run-a-test hint when there is no test result', () => {
    ssoTestRef.current = null
    renderEditor(
      makeProvider({ autoCreateUsers: true, attributeMapping: { claimPath: 'groups', rules: [] } })
    )
    // Disclosure auto-opens because a mapping object exists; hint is shown.
    expect(screen.getByText(/Run a test sign-in to map roles/)).toBeInTheDocument()
  })

  it('locks the claim-path selector once a rule is added', async () => {
    ssoTestRef.current = {
      registrationId: 'oidc_x',
      allClaims: { groups: ['G1'], roles: ['R1'] },
    }
    renderEditor(makeProvider({ autoCreateUsers: true, attributeMapping: null }))

    // Selector is enabled initially (no rules yet).
    const selector = screen.getByRole('combobox', { name: 'Claim to map' })
    expect(selector).not.toBeDisabled()

    // Click the first Add button — this pins the claim path.
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0])

    // Selector is now locked.
    expect(screen.getByRole('combobox', { name: 'Claim to map' })).toBeDisabled()
  })
})
