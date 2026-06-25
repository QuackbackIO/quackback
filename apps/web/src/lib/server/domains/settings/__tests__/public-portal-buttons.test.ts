/**
 * Public-portal OIDC button list.
 *
 * `getPublicPortalConfig()` builds the `publicPortalConfig.oidcProviders`
 * list the portal login forms render as "Continue with <provider>"
 * buttons. The list is derived from the `identity_provider` table (not
 * the static AUTH_PROVIDERS map), so a workspace can surface any number
 * of registered OIDC providers.
 *
 * A provider gets a button only when it is BOTH:
 *   - button-eligible: `shouldRenderPublicButton(p)` — no verified domain
 *     OR the admin opted it back in via `showButton`.
 *   - registered: the same gate the auth runtime applies (enabled + creds
 *     + tier), so a button never 404s on click.
 *
 * Routed-only providers (verified domain + showButton:false) are reached
 * via the email-first SSO routing, not a public button, so they must NOT
 * appear here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFindFirst = vi.fn()
const mockIsEmailConfigured = vi.fn()
const mockGetConfiguredIntegrationTypes = vi.fn()
const mockListIdentityProviders = vi.fn()
const mockGetRegisteredOidcProviderIds = vi.fn()

vi.mock('@/lib/server/redis', () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn(),
  cacheDel: vi.fn(),
  CACHE_KEYS: { TENANT_SETTINGS: 'settings:tenant' },
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      settings: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
    },
    select: () => ({
      from: () => ({
        limit: () => Promise.resolve([]),
        orderBy: () => Promise.resolve([]),
      }),
    }),
  },
  eq: vi.fn(),
  settings: { id: 'id' },
  ssoVerifiedDomain: { createdAt: 'created_at' },
}))

vi.mock('@quackback/email', () => ({
  isEmailConfigured: () => mockIsEmailConfigured(),
}))

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getConfiguredIntegrationTypes: () => mockGetConfiguredIntegrationTypes(),
}))

// Keep the real visibility predicates; only the DB-backed list is faked.
vi.mock('../identity-providers.service', async (importActual) => {
  const actual = await importActual<typeof import('../identity-providers.service')>()
  return { ...actual, listIdentityProviders: () => mockListIdentityProviders() }
})

vi.mock('@/lib/server/auth/registered-providers', () => ({
  getRegisteredOidcProviderIds: (...args: unknown[]) => mockGetRegisteredOidcProviderIds(...args),
}))

const { getPublicPortalConfig } = await import('../settings.service')

const baseSettingsRow = {
  id: 's1',
  name: 'Acme',
  slug: 'acme',
  authConfig: '{}',
  portalConfig: JSON.stringify({
    oauth: { password: true, magicLink: false, google: true },
    features: {},
  }),
  brandingConfig: '{}',
  developerConfig: '{}',
  customCss: '',
  managedFieldPaths: [],
  state: 'active',
}

/** Minimal IdentityProvider shape the public-button path reads. */
function provider(overrides: {
  registrationId: string
  label: string
  showButton?: boolean
  verified?: boolean
}) {
  return {
    registrationId: overrides.registrationId,
    label: overrides.label,
    showButton: overrides.showButton ?? false,
    enabled: true,
    domains: overrides.verified
      ? [{ verifiedAt: '2026-01-01T00:00:00.000Z' }]
      : [{ verifiedAt: null }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFindFirst.mockResolvedValue(baseSettingsRow)
  mockIsEmailConfigured.mockReturnValue(true)
  mockGetConfiguredIntegrationTypes.mockResolvedValue(new Set<string>())
})

describe('getPublicPortalConfig — oidcProviders buttons', () => {
  it('emits a button {id: registrationId, name: label} for a button-eligible provider (no verified domain)', async () => {
    mockListIdentityProviders.mockResolvedValue([
      provider({ registrationId: 'custom-oidc', label: 'Okta' }),
    ])
    mockGetRegisteredOidcProviderIds.mockResolvedValue(new Set(['custom-oidc']))

    const result = await getPublicPortalConfig()
    expect(result?.oidcProviders).toContainEqual({ id: 'custom-oidc', name: 'Okta' })
  })

  it('emits a button for a routed provider the admin opted back in via showButton', async () => {
    mockListIdentityProviders.mockResolvedValue([
      provider({ registrationId: 'auth0', label: 'Auth0', showButton: true, verified: true }),
    ])
    mockGetRegisteredOidcProviderIds.mockResolvedValue(new Set(['auth0']))

    const result = await getPublicPortalConfig()
    expect(result?.oidcProviders).toContainEqual({ id: 'auth0', name: 'Auth0' })
  })

  it('does NOT emit a button for a routed-only provider (verified domain + showButton:false)', async () => {
    mockListIdentityProviders.mockResolvedValue([
      provider({ registrationId: 'workos', label: 'WorkOS', showButton: false, verified: true }),
    ])
    mockGetRegisteredOidcProviderIds.mockResolvedValue(new Set(['workos']))

    const result = await getPublicPortalConfig()
    expect(result?.oidcProviders ?? []).not.toContainEqual({ id: 'workos', name: 'WorkOS' })
  })

  it('does NOT emit a button for a button-eligible provider that is not registered (would 404)', async () => {
    mockListIdentityProviders.mockResolvedValue([
      provider({ registrationId: 'unwired', label: 'Unwired' }),
    ])
    mockGetRegisteredOidcProviderIds.mockResolvedValue(new Set<string>())

    const result = await getPublicPortalConfig()
    expect(result?.oidcProviders ?? []).not.toContainEqual({ id: 'unwired', name: 'Unwired' })
  })
})
