/**
 * Layer B pre-session gate (`handleSignInPreCheck`) — comprehensive
 * scenario matrix.
 *
 * This is the request-time policy oracle for password / magic-link /
 * email-OTP sign-in attempts. It runs BEFORE Better-Auth verifies the
 * credential, so a block here means the redirect lands without any
 * password check ever happening. OAuth callback paths are gated by
 * Layer A (registration filter) and Layer C (post-session cleanup)
 * instead — those paths land in `NO_EMAIL_BEFORE_PATHS` and exit
 * early here.
 *
 * Matrix dimensions exercised:
 *   - provider: credential / magic-link / sso / non-listed
 *   - path: gated / NO_EMAIL_BEFORE_PATH / unrecognised
 *   - email: present / missing
 *   - per-domain: verified-enforced / verified-routing-only / none
 *   - principal: admin / member / user / missing (brand-new sign-up)
 *   - oauth toggles: password on/off / magic-link on/off
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { makeAuthConfig, makeTenant, makeVerifiedDomain } from './_helpers'

const mockUserFindFirst = vi.fn()
const mockPrincipalFindFirst = vi.fn()
const mockGetTenantSettings = vi.fn()
const mockGetPublicPortalConfig = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      user: { findFirst: (...a: unknown[]) => mockUserFindFirst(...a) },
      principal: { findFirst: (...a: unknown[]) => mockPrincipalFindFirst(...a) },
    },
  },
  user: { id: 'user_id', email: 'user_email' },
  principal: { userId: 'principal_userId', role: 'role' },
  eq: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getTenantSettings: (...a: unknown[]) => mockGetTenantSettings(...a),
  getPublicPortalConfig: (...a: unknown[]) => mockGetPublicPortalConfig(...a),
}))

const mockCheckSignInRateLimit = vi.fn()
const mockCheckMagicLinkRateLimit = vi.fn()
vi.mock('@/lib/server/auth/signin-rate-limit', () => ({
  checkCredentialSignInRateLimit: (ip: string, email: string) =>
    mockCheckSignInRateLimit(ip, email),
  checkMagicLinkSendRateLimit: (ip: string, email: string) =>
    mockCheckMagicLinkRateLimit(ip, email),
}))

const mockRecordAuditEvent = vi.fn(async (_spec: unknown) => undefined)
vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: (spec: unknown) => mockRecordAuditEvent(spec),
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

// Default mirrors the production conditions: registered iff the admin
// has SSO enabled (so existing enforcement tests see the same blocking
// behavior). Tests for tier-downgrade / missing-secret override this.
const mockIsSsoActuallyRegistered = vi.fn(
  async (sso: { enabled?: boolean } | undefined, _tier: unknown) => sso?.enabled === true
)
vi.mock('@/lib/server/auth/sso-secret', () => ({
  isSsoActuallyRegistered: (sso: { enabled?: boolean } | undefined, tier: unknown) =>
    mockIsSsoActuallyRegistered(sso, tier),
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: async () => ({ features: { customOidcProvider: true } }),
}))

// auth-restrictions stays unmocked — we want the real predicates to
// run so we test the integration, not just the wiring.

const { handleSignInPreCheck } = await import('../hooks')

type Ctx = Parameters<typeof handleSignInPreCheck>[0]
type Knobs = {
  ssoEnabled?: boolean
  passwordEnabled?: boolean
  magicLinkEnabled?: boolean
  verifiedDomains?: ReturnType<typeof makeVerifiedDomain>[]
}

const tenant = (k: Knobs = {}) =>
  makeTenant({
    authConfig: makeAuthConfig({
      oauth: { password: k.passwordEnabled, magicLink: k.magicLinkEnabled },
      ssoOidc: {
        // `enabled` defaults to true so existing tests exercising
        // per-domain enforcement keep their semantics.
        // Tests that need a disabled-SSO workspace pass `ssoEnabled: false`.
        enabled: k.ssoEnabled ?? true,
      },
    }),
    verifiedDomains: k.verifiedDomains ?? [],
  })

const ctxFor = (path: string, body?: Record<string, unknown>): Ctx => ({
  path,
  body,
  redirect: vi.fn((url: string) => new Error(`REDIRECT:${url}`)),
})

beforeEach(() => {
  vi.clearAllMocks()
  mockUserFindFirst.mockResolvedValue(null)
  mockPrincipalFindFirst.mockResolvedValue(null)
  mockGetTenantSettings.mockResolvedValue(tenant())
  mockGetPublicPortalConfig.mockResolvedValue({
    oauth: { password: true, magicLink: false },
  })
  // Default mock returns true when sso.enabled is true (mirrors prod).
  // Tier-downgrade / missing-secret tests override with mockResolvedValue.
  mockIsSsoActuallyRegistered.mockImplementation(async (sso) => sso?.enabled === true)
  mockCheckSignInRateLimit.mockResolvedValue({ allowed: true })
  mockCheckMagicLinkRateLimit.mockResolvedValue({ allowed: true })
})

// ============================================================
// Early-exit guards
// ============================================================

describe('handleSignInPreCheck — early exits', () => {
  it('skips when path is unrecognised (no provider inferred)', async () => {
    const ctx = ctxFor('/some/unknown/path', { email: 'a@b.com' })
    await handleSignInPreCheck(ctx)
    expect(mockGetTenantSettings).not.toHaveBeenCalled()
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('skips when path is in NO_EMAIL_BEFORE_PATHS (e.g. /sign-in/social)', async () => {
    const ctx = ctxFor('/sign-in/social', { email: 'a@b.com', provider: 'google' })
    await handleSignInPreCheck(ctx)
    expect(mockGetTenantSettings).not.toHaveBeenCalled()
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('skips when path is /oauth2/callback/:providerId (Layer C handles those)', async () => {
    const ctx = ctxFor('/oauth2/callback/:providerId', { email: 'a@b.com' })
    ctx.params = { providerId: 'sso' }
    await handleSignInPreCheck(ctx)
    expect(mockGetTenantSettings).not.toHaveBeenCalled()
  })

  it('skips when ctx.body.email is missing (magic-link verify path)', async () => {
    const ctx = ctxFor('/magic-link/verify', { token: 'xyz' })
    await handleSignInPreCheck(ctx)
    expect(mockGetTenantSettings).not.toHaveBeenCalled()
  })

  it('lower-cases and trims email before checking', async () => {
    const ctx = ctxFor('/sign-in/email', { email: '  Foo@Acme.COM  ' })
    mockGetTenantSettings.mockResolvedValue(
      tenant({ verifiedDomains: [makeVerifiedDomain('acme.com', true)] })
    )
    mockUserFindFirst.mockResolvedValue({ id: 'user_1' })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })

    await expect(handleSignInPreCheck(ctx)).rejects.toThrow(/verified_domain_requires_sso/)
  })
})

// ============================================================
// Per-domain hard-binding (enforced verified domain)
// ============================================================

describe('handleSignInPreCheck — per-domain enforced', () => {
  beforeEach(() => {
    mockGetTenantSettings.mockResolvedValue(
      tenant({
        verifiedDomains: [makeVerifiedDomain('acme.com', true)],
      })
    )
  })

  it('blocks password sign-in for admin at enforced verified domain', async () => {
    mockUserFindFirst.mockResolvedValue({ id: 'user_1' })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = ctxFor('/sign-in/email', { email: 'a@acme.com' })

    await expect(handleSignInPreCheck(ctx)).rejects.toThrow(
      'REDIRECT:/admin/login?error=verified_domain_requires_sso'
    )
  })

  it('blocks password sign-in for member at enforced verified domain', async () => {
    mockUserFindFirst.mockResolvedValue({ id: 'user_1' })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'member' })
    const ctx = ctxFor('/sign-in/email', { email: 'a@acme.com' })

    await expect(handleSignInPreCheck(ctx)).rejects.toThrow(/verified_domain_requires_sso/)
  })

  it('blocks password sign-in for portal user at enforced verified domain (domain branch is role-blind)', async () => {
    mockUserFindFirst.mockResolvedValue({ id: 'user_1' })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'user' })
    const ctx = ctxFor('/sign-in/email', { email: 'a@acme.com' })

    await expect(handleSignInPreCheck(ctx)).rejects.toThrow(/verified_domain_requires_sso/)
  })

  it('blocks brand-new sign-ups (no principal yet) at enforced verified domain', async () => {
    mockUserFindFirst.mockResolvedValue(null)
    mockPrincipalFindFirst.mockResolvedValue(null)
    const ctx = ctxFor('/sign-up/email', { email: 'newhire@acme.com' })

    await expect(handleSignInPreCheck(ctx)).rejects.toThrow(/verified_domain_requires_sso/)
  })

  it('blocks magic-link send for enforced-domain email', async () => {
    mockUserFindFirst.mockResolvedValue({ id: 'user_1' })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = ctxFor('/sign-in/magic-link', { email: 'a@acme.com' })

    await expect(handleSignInPreCheck(ctx)).rejects.toThrow(/verified_domain_requires_sso/)
  })

  it('does NOT block when the verified-domain row has enforced=false (routing-only)', async () => {
    mockGetTenantSettings.mockResolvedValue(
      tenant({
        verifiedDomains: [makeVerifiedDomain('acme.com', false)],
      })
    )
    mockUserFindFirst.mockResolvedValue({ id: 'user_1' })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = ctxFor('/sign-in/email', { email: 'a@acme.com' })

    await handleSignInPreCheck(ctx)
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('does not match a different domain (no enforce on example.com when acme.com is enforced)', async () => {
    mockUserFindFirst.mockResolvedValue({ id: 'user_1' })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = ctxFor('/sign-in/email', { email: 'a@example.com' })

    await handleSignInPreCheck(ctx)
    expect(ctx.redirect).not.toHaveBeenCalled()
  })
})

// ============================================================
// Method-allowed fall-through (toggles)
// ============================================================

describe('handleSignInPreCheck — isAuthMethodAllowed gate', () => {
  it('blocks credential when oauth.password is explicitly false for team', async () => {
    mockGetTenantSettings.mockResolvedValue(tenant({ passwordEnabled: false }))
    mockUserFindFirst.mockResolvedValue({ id: 'user_1' })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = ctxFor('/sign-in/email', { email: 'a@anywhere.com' })

    await expect(handleSignInPreCheck(ctx)).rejects.toThrow(/password_method_not_allowed/)
  })

  it('allows credential when oauth.password is undefined (defaults to true for team)', async () => {
    mockGetTenantSettings.mockResolvedValue(tenant({})) // no passwordEnabled
    mockUserFindFirst.mockResolvedValue({ id: 'user_1' })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = ctxFor('/sign-in/email', { email: 'a@anywhere.com' })

    await handleSignInPreCheck(ctx)
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('redirects team-role blocks to /admin/login', async () => {
    mockGetTenantSettings.mockResolvedValue(tenant({ passwordEnabled: false }))
    mockUserFindFirst.mockResolvedValue({ id: 'user_1' })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = ctxFor('/sign-in/email', { email: 'a@anywhere.com' })

    await expect(handleSignInPreCheck(ctx)).rejects.toThrow(
      /\/admin\/login\?error=password_method_not_allowed/
    )
  })

  it('returns silently when no principal exists (sign-up path) and provider is allowed', async () => {
    mockGetTenantSettings.mockResolvedValue(tenant({}))
    mockUserFindFirst.mockResolvedValue(null)
    mockPrincipalFindFirst.mockResolvedValue(null)
    const ctx = ctxFor('/sign-up/email', { email: 'brand@new.com' })

    await handleSignInPreCheck(ctx)
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('magic-link is allowed for team when oauth.magicLink toggle is true (verified-domain check separately gates)', async () => {
    // Per the `isAuthMethodAllowed` code: magic-link for team is now
    // gated by `authConfig.oauth.magicLink`. When the toggle is on,
    // only hard-binding can block magic-link.
    mockGetTenantSettings.mockResolvedValue(tenant({ magicLinkEnabled: true }))
    mockUserFindFirst.mockResolvedValue({ id: 'user_1' })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = ctxFor('/sign-in/magic-link', { email: 'a@anywhere.com' })

    await handleSignInPreCheck(ctx)
    expect(ctx.redirect).not.toHaveBeenCalled()
  })
})

// ============================================================
// Master switch: ssoOidc.enabled=false makes all enforcement dormant
// ============================================================

describe('handleSignInPreCheck — ssoOidc.enabled=false (workspace SSO disabled)', () => {
  it('does NOT block admin password sign-in even with stale enforced verified-domain row', async () => {
    mockGetTenantSettings.mockResolvedValue(
      tenant({
        ssoEnabled: false,
        verifiedDomains: [makeVerifiedDomain('acme.com', true)],
      })
    )
    mockUserFindFirst.mockResolvedValue({ id: 'user_1' })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = ctxFor('/sign-in/email', { email: 'a@acme.com' })

    await handleSignInPreCheck(ctx)
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('does NOT block admin magic-link with stale enforced verified-domain row', async () => {
    mockGetTenantSettings.mockResolvedValue(
      tenant({
        ssoEnabled: false,
        verifiedDomains: [makeVerifiedDomain('acme.com', true)],
      })
    )
    mockUserFindFirst.mockResolvedValue({ id: 'user_1' })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = ctxFor('/sign-in/magic-link', { email: 'a@acme.com' })

    await handleSignInPreCheck(ctx)
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('does NOT block admin password sign-in even with stale enforced verified-domain + disabled SSO', async () => {
    mockGetTenantSettings.mockResolvedValue(
      tenant({ ssoEnabled: false, verifiedDomains: [makeVerifiedDomain('acme.com', true)] })
    )
    mockUserFindFirst.mockResolvedValue({ id: 'user_1' })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = ctxFor('/sign-in/email', { email: 'a@acme.com' })

    await handleSignInPreCheck(ctx)
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('still gates by method-allowed (password disabled → still blocks)', async () => {
    // The master SSO switch only affects SSO enforcement. Other policy
    // (oauth.password=false) keeps working independently.
    mockGetTenantSettings.mockResolvedValue(tenant({ ssoEnabled: false, passwordEnabled: false }))
    mockUserFindFirst.mockResolvedValue({ id: 'user_1' })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = ctxFor('/sign-in/email', { email: 'a@anywhere.com' })

    await expect(handleSignInPreCheck(ctx)).rejects.toThrow(/password_method_not_allowed/)
  })
})

// ============================================================
// Runtime fail-open — SSO is admin-configured but not viable
// ============================================================

describe('handleSignInPreCheck — tier-downgrade / missing-secret fail-open', () => {
  // Admin has SSO enabled and an enforced verified-domain row, but the
  // runtime can't actually use it: tier was downgraded or the secret got
  // rotated and cleared. Layer A has already unregistered the SSO provider,
  // so there's no SSO button. Without fail-open, password sign-in would
  // also be blocked → total lockout. The runtime check undoes the
  // enforcement until the operator fixes things.
  it('allows admin password sign-in at enforced verified domain when SSO not registered (tier downgrade)', async () => {
    mockGetTenantSettings.mockResolvedValue(
      tenant({ ssoEnabled: true, verifiedDomains: [makeVerifiedDomain('acme.com', true)] })
    )
    mockIsSsoActuallyRegistered.mockResolvedValue(false)
    mockUserFindFirst.mockResolvedValue({ id: 'user_1' })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = ctxFor('/sign-in/email', { email: 'a@acme.com' })

    await handleSignInPreCheck(ctx)
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('allows admin magic-link too when SSO not registered', async () => {
    mockGetTenantSettings.mockResolvedValue(
      tenant({
        ssoEnabled: true,
        verifiedDomains: [makeVerifiedDomain('acme.com', true)],
      })
    )
    mockIsSsoActuallyRegistered.mockResolvedValue(false)
    mockUserFindFirst.mockResolvedValue({ id: 'user_1' })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = ctxFor('/sign-in/magic-link', { email: 'a@acme.com' })

    await handleSignInPreCheck(ctx)
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('still blocks when ssoRegistered=true and enforcement says so (regression)', async () => {
    // Sanity: the fail-open must not invert. Same input as the
    // "blocks password sign-in for admin at enforced verified domain"
    // test in the per-domain suite — should still block.
    mockGetTenantSettings.mockResolvedValue(
      tenant({
        ssoEnabled: true,
        verifiedDomains: [makeVerifiedDomain('acme.com', true)],
      })
    )
    mockIsSsoActuallyRegistered.mockResolvedValue(true)
    mockUserFindFirst.mockResolvedValue({ id: 'user_1' })
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = ctxFor('/sign-in/email', { email: 'a@acme.com' })

    await expect(handleSignInPreCheck(ctx)).rejects.toThrow(/verified_domain_requires_sso/)
  })
})

describe('handleSignInPreCheck — sign-in rate-limit', () => {
  it('throws a 429 APIError with code=rate_limited when the limiter blocks', async () => {
    mockCheckSignInRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 120 })
    const ctx = ctxFor('/sign-in/email', { email: 'a@b.com' })
    // The pre-check must NOT 302-redirect — sign-in submits are XHR, and
    // redirect-then-detect is more fragile than a direct JSON error. The
    // auth client surfaces `body.message` as `result.error.message`.
    const err = await handleSignInPreCheck(ctx).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as { name?: string }).name).toBe('APIError')
    expect((err as { status?: string }).status).toBe('TOO_MANY_REQUESTS')
    expect((err as { statusCode?: number }).statusCode).toBe(429)
    expect((err as { body?: { code?: string; message?: string } }).body?.code).toBe('rate_limited')
    expect((err as { body?: { message?: string } }).body?.message).toMatch(
      /too many sign-in attempts/i
    )
    // Retry-After must be propagated so future clients can show a countdown.
    expect((err as { headers?: Record<string, string> }).headers?.['Retry-After']).toBe('120')
    // Must not have called the redirect helper.
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('emits auth.signin.rate_limited audit row on block', async () => {
    mockCheckSignInRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 120 })
    const ctx = ctxFor('/sign-in/email', { email: 'a@b.com' })
    await expect(handleSignInPreCheck(ctx)).rejects.toBeDefined()

    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth.signin.rate_limited' })
    )
  })

  it('short-circuits all downstream work when rate-limited (cheapest reject)', async () => {
    // Rate-limit fires BEFORE the tenant fetch so a DB hiccup can't
    // mask a 429 with a 500. No tenant settings, user, or principal
    // lookups should fire when the limiter blocks.
    mockCheckSignInRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 60 })
    const ctx = ctxFor('/sign-in/email', { email: 'a@b.com' })
    await expect(handleSignInPreCheck(ctx)).rejects.toBeDefined()

    expect(mockGetTenantSettings).not.toHaveBeenCalled()
    expect(mockUserFindFirst).not.toHaveBeenCalled()
    expect(mockPrincipalFindFirst).not.toHaveBeenCalled()
  })

  it('omits Retry-After header when the limiter did not provide one', async () => {
    // Defensive: bucketRetryAfter can return undefined in some Redis edge
    // cases. The header should be omitted entirely (not set to "undefined").
    mockCheckSignInRateLimit.mockResolvedValueOnce({ allowed: false })
    const ctx = ctxFor('/sign-in/email', { email: 'a@b.com' })
    const err = await handleSignInPreCheck(ctx).catch((e) => e)
    expect((err as { headers?: Record<string, string> }).headers?.['Retry-After']).toBeUndefined()
  })

  it('passes when the limiter allows (allowed=true → no redirect)', async () => {
    mockCheckSignInRateLimit.mockResolvedValueOnce({ allowed: true })
    const ctx = ctxFor('/sign-in/email', { email: 'a@b.com' })
    await handleSignInPreCheck(ctx)
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('does NOT rate-limit OAuth callback paths (no credential flow there)', async () => {
    const ctx = ctxFor('/sign-in/social', { email: 'a@b.com', provider: 'google' })
    await handleSignInPreCheck(ctx)
    expect(mockCheckSignInRateLimit).not.toHaveBeenCalled()
    expect(mockCheckMagicLinkRateLimit).not.toHaveBeenCalled()
  })

  it('does not invert when limiter call throws (fail-open)', async () => {
    mockCheckSignInRateLimit.mockRejectedValueOnce(new Error('boom'))
    const ctx = ctxFor('/sign-in/email', { email: 'a@b.com' })
    // The helper itself fails open via try/catch, but this test
    // asserts the hook's resilience even if the helper promise rejects.
    await handleSignInPreCheck(ctx)
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('dispatches the magic-link limiter on /sign-in/magic-link (not the credential limiter)', async () => {
    const ctx = ctxFor('/sign-in/magic-link', { email: 'a@b.com' })
    await handleSignInPreCheck(ctx)
    expect(mockCheckMagicLinkRateLimit).toHaveBeenCalledWith(expect.any(String), 'a@b.com')
    expect(mockCheckSignInRateLimit).not.toHaveBeenCalled()
  })

  it('blocks magic-link send when the magic-link limiter caps', async () => {
    mockCheckMagicLinkRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 600 })
    const ctx = ctxFor('/sign-in/magic-link', { email: 'a@b.com' })
    const err = await handleSignInPreCheck(ctx).catch((e) => e)
    expect((err as { body?: { code?: string } }).body?.code).toBe('rate_limited')
    expect((err as { statusCode?: number }).statusCode).toBe(429)
  })

  it('dispatches the credential limiter on /sign-in/email (not the magic-link limiter)', async () => {
    const ctx = ctxFor('/sign-in/email', { email: 'a@b.com' })
    await handleSignInPreCheck(ctx)
    expect(mockCheckSignInRateLimit).toHaveBeenCalledWith(expect.any(String), 'a@b.com')
    expect(mockCheckMagicLinkRateLimit).not.toHaveBeenCalled()
  })
})
