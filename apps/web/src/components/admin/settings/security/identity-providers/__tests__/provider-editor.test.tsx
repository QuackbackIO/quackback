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
  upsertSpy: vi.fn(async (_args: { data: { kind: string | null } }) => undefined),
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
