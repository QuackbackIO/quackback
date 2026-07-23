// @vitest-environment happy-dom
/**
 * <IdentityProvidersSection> + <ProviderEditor> — visibility and routing
 * made visible.
 *
 * Core assertions:
 *  - The "show a sign-in button" visibility toggle always renders so the admin
 *    can hide the button on any provider, with or without a verified domain.
 *  - Per-domain enforcement is domain-scoped: its control shows only for a
 *    provider WITH a verified domain.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { IdentityProviderId } from '@quackback/ids'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import type { VerifiedDomain } from '@/lib/server/domains/settings/settings.types'
import { IdentityProvidersSection } from '../provider-list'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouteContext: () => ({ managedFieldPaths: [] }),
}))

const { upsertSpy } = vi.hoisted(() => ({
  upsertSpy: vi.fn(async (_args: { data: { id: string; enabled: boolean } }) => undefined),
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
  setDomainEnforcedFn: vi.fn(),
  removeVerifiedDomainFn: vi.fn(),
}))

beforeEach(() => {
  upsertSpy.mockClear()
})

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
    enabled: true,
    autoCreateUsers: true,
    autoProvisionRole: 'user',
    attributeMapping: null,
    profileMapping: null,
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

  it('shows the visibility toggle but hides the enforcement control for a no-domain provider', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: /edit customer login/i }))
    expect(await screen.findByText(/edit identity provider/i)).toBeInTheDocument()
    // The visibility toggle is always available so the admin can hide the
    // button even without a verified domain.
    expect(screen.getByLabelText(/show a sign-in button/i)).toBeInTheDocument()
    // Enforcement is domain-scoped, so it stays hidden without a verified domain.
    expect(screen.queryByLabelText(/require sso/i)).toBeNull()
  })

  it('shows the visibility toggle and enforcement control for a verified-domain provider', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: /edit acme sso/i }))
    expect(await screen.findByLabelText(/show a sign-in button/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/require sso for acme\.com/i)).toBeInTheDocument()
  })
})

describe('enable toggle on the list row', () => {
  it('flips the provider enabled flag via upsert without opening the editor', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('switch', { name: /enable customer login/i }))
    await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1))
    expect(upsertSpy.mock.calls[0][0].data).toMatchObject({
      id: buttonProvider.id,
      enabled: true,
    })
    // The editor dialog must not have opened.
    expect(screen.queryByText(/edit identity provider/i)).toBeNull()
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

  it('blocks removing a provider that is the only working method', async () => {
    renderSection(1)
    fireEvent.click(screen.getByRole('button', { name: /edit acme sso/i }))
    await screen.findByText(/edit identity provider/i)
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled()
  })

  it('allows removing a provider when other methods remain', async () => {
    renderSection(3)
    fireEvent.click(screen.getByRole('button', { name: /edit acme sso/i }))
    await screen.findByText(/edit identity provider/i)
    expect(screen.getByRole('button', { name: 'Remove' })).not.toBeDisabled()
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
