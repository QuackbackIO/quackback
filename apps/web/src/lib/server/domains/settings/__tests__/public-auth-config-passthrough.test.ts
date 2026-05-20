/**
 * Regression test for the team `oauth.magicLink` passthrough bug.
 *
 * `getPublicAuthConfig()` builds the `publicAuthConfig.oauth` blob
 * that the team login form reads to decide which sign-in buttons to
 * render. It uses `filterOAuthByCredentials` to drop OAuth providers
 * that don't have a platform credential stored — e.g. don't show the
 * Google button if the workspace has Google enabled but no API key.
 *
 * Bug: the team-side filter passes ONLY `['password']` through
 * unconditionally. `magicLink: true` was being treated as a regular
 * OAuth provider and dropped because there's no `auth_magicLink`
 * platform credential row (there never will be — magic-link uses the
 * SMTP/Resend transport, not an OAuth secret).
 *
 * Fix: include `magicLink` in the passthrough list when email is
 * configured, mirroring how `getPublicPortalConfig` already handles
 * it via `getPortalPassthroughKeys()`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFindFirst = vi.fn()
const mockIsEmailConfigured = vi.fn()
const mockGetConfiguredIntegrationTypes = vi.fn()

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

const { getPublicAuthConfig } = await import('../settings.service')

const baseSettingsRow = {
  id: 's1',
  name: 'Acme',
  slug: 'acme',
  authConfig: JSON.stringify({
    oauth: { password: true, magicLink: true, google: true, github: true },
    openSignup: false,
  }),
  portalConfig: '{}',
  brandingConfig: '{}',
  developerConfig: '{}',
  customCss: '',
  managedFieldPaths: [],
  state: 'active',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFindFirst.mockResolvedValue(baseSettingsRow)
  mockIsEmailConfigured.mockReturnValue(true)
  // No platform credentials configured — google/github should be
  // filtered out by the regular OAuth-credentials gate.
  mockGetConfiguredIntegrationTypes.mockResolvedValue(new Set<string>())
})

describe('getPublicAuthConfig — magicLink passthrough', () => {
  it('passes magicLink=true through when email is configured (regression: was being dropped)', async () => {
    const result = await getPublicAuthConfig()
    expect(result?.oauth.magicLink).toBe(true)
  })

  it('passes magicLink=false through (admin disabled it deliberately)', async () => {
    mockFindFirst.mockResolvedValueOnce({
      ...baseSettingsRow,
      authConfig: JSON.stringify({
        oauth: { password: true, magicLink: false },
        openSignup: false,
      }),
    })
    const result = await getPublicAuthConfig()
    expect(result?.oauth.magicLink).toBe(false)
  })

  it('drops magicLink when email is NOT configured (no point surfacing a button that would silently fail)', async () => {
    mockIsEmailConfigured.mockReturnValueOnce(false)
    const result = await getPublicAuthConfig()
    // Without email transport, magicLink should not be in the
    // passthrough list and thus gets the credential-gate treatment,
    // which drops it because there's no `auth_magicLink` credential.
    expect(result?.oauth.magicLink).toBeFalsy()
  })

  it('still passes password through (existing behaviour preserved)', async () => {
    const result = await getPublicAuthConfig()
    expect(result?.oauth.password).toBe(true)
  })

  it('still drops OAuth providers without configured credentials (existing behaviour preserved)', async () => {
    const result = await getPublicAuthConfig()
    expect(result?.oauth.google).toBeFalsy()
    expect(result?.oauth.github).toBeFalsy()
  })

  it('keeps OAuth providers when their credential IS configured', async () => {
    mockGetConfiguredIntegrationTypes.mockResolvedValueOnce(new Set(['auth_google']))
    const result = await getPublicAuthConfig()
    expect(result?.oauth.google).toBe(true)
    expect(result?.oauth.github).toBeFalsy() // no auth_github credential
  })
})
