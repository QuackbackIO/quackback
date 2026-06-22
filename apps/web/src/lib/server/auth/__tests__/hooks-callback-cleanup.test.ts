/**
 * Layer C post-session OAuth callback cleanup
 * (`handleCallbackPolicyCleanup`).
 *
 * Better-Auth's OAuth callback handler runs `setSessionCookie` and
 * populates `ctx.context.newSession` BEFORE the after-hook fires. By
 * the time we get here a real session row exists and the cookie is set
 * on the response. The cleanup helper's job is to inspect the resulting
 * principal+provider, and if the policy says reject, delete the session
 * row, clear the cookie, throw a redirect — and for brand-new sign-ups
 * (user.createdAt < 60s old) wipe the user / account / principal shells
 * so a blocked first attempt doesn't leave dangling rows.
 *
 * Hard-binding (`isHardBound`) fires for every provider except `sso`:
 * an email at an enforced verified-domain row is blocked here for
 * social / generic-OAuth callbacks too, not just credential /
 * magic-link. Layer B can't see those (no email pre-session on
 * callback paths), so this Layer-C branch is the gate that enforces
 * it. The `isAuthMethodAllowed` fall-through still handles the
 * separate "oauth toggle off / credentials missing" cases.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { makeAuthConfig, makeTenant, makeVerifiedDomain } from './_helpers'

const mockPrincipalFindFirst = vi.fn()
const mockUserFindFirst = vi.fn()
const mockSessionDeleteWhere = vi.fn(async () => undefined)
const mockUserDeleteWhere = vi.fn(async () => undefined)
const mockAccountDeleteWhere = vi.fn(async () => undefined)
const mockPrincipalDeleteWhere = vi.fn(async () => undefined)
const mockDeleteSessionCookie = vi.fn()
const mockGetPublicPortalConfig = vi.fn()
const mockHasPlatformCredentials = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: { findFirst: (...a: unknown[]) => mockPrincipalFindFirst(...a) },
      user: { findFirst: (...a: unknown[]) => mockUserFindFirst(...a) },
    },
    delete: (table: { __name: string }) => {
      if (table.__name === 'session') return { where: mockSessionDeleteWhere }
      if (table.__name === 'user') return { where: mockUserDeleteWhere }
      if (table.__name === 'account') return { where: mockAccountDeleteWhere }
      if (table.__name === 'principal') return { where: mockPrincipalDeleteWhere }
      throw new Error(`unexpected delete: ${String(table.__name)}`)
    },
  },
  user: { __name: 'user', id: 'user_id' },
  principal: { __name: 'principal', userId: 'principal_userId' },
  session: { __name: 'session', token: 'session_token' },
  account: { __name: 'account', userId: 'account_userId' },
  eq: vi.fn(),
}))

vi.mock('better-auth/cookies', () => ({
  deleteSessionCookie: (...a: unknown[]) => mockDeleteSessionCookie(...a),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPublicPortalConfig: (...a: unknown[]) => mockGetPublicPortalConfig(...a),
}))

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  hasPlatformCredentials: (...a: unknown[]) => mockHasPlatformCredentials(...a),
}))

const { handleCallbackPolicyCleanup } = await import('../hooks')

// Task 12: handleCallbackPolicyCleanup now receives the provider registry
// (providers + registered-OIDC set) as args instead of computing
// isSsoActuallyRegistered internally. This wrapper derives the
// single-provider regression baseline from the tenant's verified domains —
// one owning provider 'sso' — so the existing call sites only change name.
// Pass `{ ssoRegistered: false }` to exercise the owner-scoped fail-open.
const cleanup = (
  ctx: Parameters<typeof handleCallbackPolicyCleanup>[0],
  tenant: Parameters<typeof handleCallbackPolicyCleanup>[1],
  opts: { ssoRegistered?: boolean } = {}
) => {
  const domains = tenant?.verifiedDomains ?? []
  const providers = [{ id: 'idp_sso', registrationId: 'sso', domains }] as unknown as Parameters<
    typeof handleCallbackPolicyCleanup
  >[2]
  const registeredOidcIds = opts.ssoRegistered === false ? new Set<string>() : new Set(['sso'])
  return handleCallbackPolicyCleanup(ctx, tenant, providers, registeredOidcIds)
}

const tenantSettings = (
  k: {
    passwordEnabled?: boolean
    googleEnabled?: boolean
    githubEnabled?: boolean
    verifiedDomains?: ReturnType<typeof makeVerifiedDomain>[]
  } = {}
) =>
  makeTenant({
    authConfig: makeAuthConfig({
      oauth: { password: k.passwordEnabled, google: k.googleEnabled, github: k.githubEnabled },
    }),
    verifiedDomains: k.verifiedDomains ?? [],
  })

function ctxFor(opts: {
  path: string
  providerParam?: string
  bodyProvider?: string
  userId?: string
  email?: string
  token?: string
}) {
  return {
    path: opts.path,
    params: opts.providerParam ? { providerId: opts.providerParam } : {},
    body: opts.bodyProvider ? { provider: opts.bodyProvider } : {},
    context: {
      newSession: {
        user: opts.userId ? { id: opts.userId, email: opts.email } : undefined,
        session: opts.token ? { token: opts.token } : undefined,
      },
    },
    redirect: vi.fn((url: string) => new Error(`REDIRECT:${url}`)),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrincipalFindFirst.mockResolvedValue(null)
  mockUserFindFirst.mockResolvedValue(null)
  mockGetPublicPortalConfig.mockResolvedValue({
    oauth: { password: true, magicLink: false },
  })
  mockHasPlatformCredentials.mockResolvedValue(true)
})

// ============================================================
// Path / context guards
// ============================================================

describe('handleCallbackPolicyCleanup — guards', () => {
  it('skips when path is not session-creating callback', async () => {
    const ctx = ctxFor({ path: '/sign-in/email', userId: 'user_1', token: 'tok' })
    await cleanup(ctx, tenantSettings({}))
    expect(mockSessionDeleteWhere).not.toHaveBeenCalled()
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('skips when newSession.user.id is missing', async () => {
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      providerParam: 'sso',
      token: 'tok',
    })
    await cleanup(ctx, tenantSettings({}))
    expect(mockSessionDeleteWhere).not.toHaveBeenCalled()
  })

  it('skips when session token is missing', async () => {
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      providerParam: 'sso',
      userId: 'user_1',
    })
    await cleanup(ctx, tenantSettings({}))
    expect(mockSessionDeleteWhere).not.toHaveBeenCalled()
  })

  it('skips when provider cannot be inferred', async () => {
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      userId: 'user_1',
      token: 'tok',
    })
    await cleanup(ctx, tenantSettings({}))
    expect(mockSessionDeleteWhere).not.toHaveBeenCalled()
  })

  it('early-returns when no principal row exists (after hard-binding check)', async () => {
    mockPrincipalFindFirst.mockResolvedValue(null)
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      providerParam: 'google',
      userId: 'user_brandnew',
      email: 'a@external.com',
      token: 'tok',
    })
    await cleanup(ctx, tenantSettings({}))
    // 'a@external.com' is not at an enforced domain (none configured)
    // and no principal exists → return without running the
    // method-allowed gate.
    expect(mockSessionDeleteWhere).not.toHaveBeenCalled()
    expect(ctx.redirect).not.toHaveBeenCalled()
  })
})

// ============================================================
// SSO callback — allowed for every role (team + portal)
// ============================================================

describe('handleCallbackPolicyCleanup — SSO provider', () => {
  it('passes through for admin', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      providerParam: 'sso',
      userId: 'user_1',
      email: 'a@acme.com',
      token: 'tok',
    })
    await cleanup(ctx, tenantSettings({}))
    expect(mockSessionDeleteWhere).not.toHaveBeenCalled()
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('passes through for member', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ role: 'member' })
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      providerParam: 'sso',
      userId: 'user_1',
      email: 'a@acme.com',
      token: 'tok',
    })
    await cleanup(ctx, tenantSettings({}))
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('keeps the session for a portal user at a verified domain', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ role: 'user' })
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      providerParam: 'sso',
      userId: 'user_1',
      email: 'staff@acme.com',
      token: 'tok',
    })
    await cleanup(ctx, tenantSettings({ verifiedDomains: [makeVerifiedDomain('acme.com', false)] }))
    expect(mockSessionDeleteWhere).not.toHaveBeenCalled()
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('keeps the session for a portal user at an enforced (Require SSO) domain', async () => {
    // Require-SSO (enforced=true) hard-binds other methods but must still
    // admit SSO itself — the lockout this feature was added to fix.
    mockPrincipalFindFirst.mockResolvedValue({ role: 'user' })
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      providerParam: 'sso',
      userId: 'user_1',
      email: 'staff@acme.com',
      token: 'tok',
    })
    await cleanup(ctx, tenantSettings({ verifiedDomains: [makeVerifiedDomain('acme.com', true)] }))
    expect(mockSessionDeleteWhere).not.toHaveBeenCalled()
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('revokes a portal user signing in via SSO from a non-verified domain', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ role: 'user' })
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      providerParam: 'sso',
      userId: 'user_1',
      email: 'guest@external.com',
      token: 'tok',
    })
    await expect(
      cleanup(ctx, tenantSettings({ verifiedDomains: [makeVerifiedDomain('acme.com', false)] }))
    ).rejects.toThrow(/\/\?auth=signin&error=oauth_method_not_allowed/)
    expect(mockSessionDeleteWhere).toHaveBeenCalled()
  })

  it('revokes an SSO sign-in from a non-verified domain even when no principal row exists', async () => {
    // With no principal, role defaults to 'user' (most restrictive). The
    // verified-domain SSO gate must still fire, fail-closed, rather than
    // being skipped by the principal-row guard.
    mockPrincipalFindFirst.mockResolvedValue(null)
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      providerParam: 'sso',
      userId: 'user_1',
      email: 'guest@external.com',
      token: 'tok',
    })
    await expect(
      cleanup(ctx, tenantSettings({ verifiedDomains: [makeVerifiedDomain('acme.com', false)] }))
    ).rejects.toThrow(/\/\?auth=signin&error=oauth_method_not_allowed/)
    expect(mockSessionDeleteWhere).toHaveBeenCalled()
  })
})

// ============================================================
// Non-SSO OAuth callback — gated by isAuthMethodAllowed
// ============================================================

describe('handleCallbackPolicyCleanup — non-SSO OAuth', () => {
  it('passes for admin + google when oauth.google=true and credentials present', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    mockHasPlatformCredentials.mockResolvedValue(true)
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      providerParam: 'google',
      userId: 'user_1',
      email: 'a@external.com',
      token: 'tok',
    })
    await cleanup(ctx, tenantSettings({ googleEnabled: true }))
    expect(ctx.redirect).not.toHaveBeenCalled()
    expect(mockSessionDeleteWhere).not.toHaveBeenCalled()
  })

  it('revokes for admin + google when oauth.google is disabled', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    mockUserFindFirst.mockResolvedValue({
      createdAt: new Date(Date.now() - 5 * 60 * 60_000),
    })
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      providerParam: 'google',
      userId: 'user_1',
      email: 'a@external.com',
      token: 'tok',
    })

    await expect(cleanup(ctx, tenantSettings({ googleEnabled: false }))).rejects.toThrow(
      /\/\?auth=signin&callbackUrl=\/admin&error=oauth_method_not_allowed/
    )

    expect(mockSessionDeleteWhere).toHaveBeenCalled()
    expect(mockDeleteSessionCookie).toHaveBeenCalled()
  })

  it('revokes for admin + google when credentials are missing even though oauth.google=true', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    mockHasPlatformCredentials.mockResolvedValue(false)
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      providerParam: 'google',
      userId: 'user_1',
      email: 'a@external.com',
      token: 'tok',
    })

    await expect(cleanup(ctx, tenantSettings({ googleEnabled: true }))).rejects.toThrow(
      /oauth_method_not_allowed/
    )
  })

  it('passes for portal user + google when portalConfig.oauth.google=true', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ role: 'user' })
    mockGetPublicPortalConfig.mockResolvedValue({
      oauth: { password: true, magicLink: false, google: true },
    })
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      providerParam: 'google',
      userId: 'user_1',
      email: 'a@external.com',
      token: 'tok',
    })
    await cleanup(ctx, tenantSettings({}))
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('revokes for portal user + google when not enabled in portal config', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ role: 'user' })
    mockGetPublicPortalConfig.mockResolvedValue({
      oauth: { password: true, magicLink: false },
    })
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      providerParam: 'google',
      userId: 'user_1',
      email: 'a@external.com',
      token: 'tok',
    })

    await expect(cleanup(ctx, tenantSettings({}))).rejects.toThrow(
      /\/\?auth=signin&error=oauth_method_not_allowed/
    )
  })

  it('wipes brand-new shells when a method-blocked OAuth callback revokes a freshly-created user', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ role: 'user' })
    mockUserFindFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 5_000) })
    mockGetPublicPortalConfig.mockResolvedValue({
      oauth: { password: true, magicLink: false /* google not enabled */ },
    })
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      providerParam: 'google',
      userId: 'user_brandnew',
      email: 'a@external.com',
      token: 'tok',
    })

    await expect(cleanup(ctx, tenantSettings({}))).rejects.toThrow(/oauth_method_not_allowed/)

    expect(mockSessionDeleteWhere).toHaveBeenCalled()
    // Brand-new sign-up via google was blocked — its shell rows
    // (user / account / principal) should be wiped to match the
    // hard-binding branch's behavior; otherwise blocked first-time
    // OAuth sign-ups leak orphan rows.
    expect(mockUserDeleteWhere).toHaveBeenCalled()
    expect(mockAccountDeleteWhere).toHaveBeenCalled()
    expect(mockPrincipalDeleteWhere).toHaveBeenCalled()
  })

  it('does NOT wipe shells for an existing user (>60s) whose OAuth method just got disabled', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ role: 'user' })
    mockUserFindFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 60 * 60_000) })
    mockGetPublicPortalConfig.mockResolvedValue({
      oauth: { password: true, magicLink: false },
    })
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      providerParam: 'google',
      userId: 'user_existing',
      email: 'a@external.com',
      token: 'tok',
    })

    await expect(cleanup(ctx, tenantSettings({}))).rejects.toThrow(/oauth_method_not_allowed/)

    expect(mockSessionDeleteWhere).toHaveBeenCalled()
    expect(mockUserDeleteWhere).not.toHaveBeenCalled()
    expect(mockAccountDeleteWhere).not.toHaveBeenCalled()
    expect(mockPrincipalDeleteWhere).not.toHaveBeenCalled()
  })
})

// ============================================================
// Hard-binding branch — fires for every provider except `sso`
//
// An email at an enforced verified-domain row is hard-bound: the only
// allowed sign-in is the team SSO provider. Layer C is where social /
// generic-OAuth callbacks get caught (Layer B never sees their email).
// `/sign-in/social` carrying body.provider='credential' is covered too.
// ============================================================

describe('handleCallbackPolicyCleanup — hard-binding branch (enforced verified domain)', () => {
  it('revokes + redirects an existing user signing in via google at an enforced domain', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    mockUserFindFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 60 * 60_000) })
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      providerParam: 'google',
      userId: 'user_existing',
      email: 'a@acme.com',
      token: 'tok',
    })

    await expect(
      cleanup(
        ctx,
        tenantSettings({
          googleEnabled: true,
          verifiedDomains: [makeVerifiedDomain('acme.com', true)],
        })
      )
    ).rejects.toThrow(/\/\?auth=signin&callbackUrl=\/admin&error=verified_domain_requires_sso/)

    expect(mockSessionDeleteWhere).toHaveBeenCalled()
    expect(mockDeleteSessionCookie).toHaveBeenCalled()
    // Existing user — shells preserved.
    expect(mockUserDeleteWhere).not.toHaveBeenCalled()
  })

  it('revokes + wipes shells for a brand-new user signing in via google at an enforced domain', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    mockUserFindFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 5_000) })
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      providerParam: 'google',
      userId: 'user_brandnew',
      email: 'a@acme.com',
      token: 'tok',
    })

    await expect(
      cleanup(
        ctx,
        tenantSettings({
          googleEnabled: true,
          verifiedDomains: [makeVerifiedDomain('acme.com', true)],
        })
      )
    ).rejects.toThrow(/verified_domain_requires_sso/)

    expect(mockSessionDeleteWhere).toHaveBeenCalled()
    expect(mockUserDeleteWhere).toHaveBeenCalled()
    expect(mockAccountDeleteWhere).toHaveBeenCalled()
    expect(mockPrincipalDeleteWhere).toHaveBeenCalled()
  })

  it('revokes a github callback at an enforced domain too', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ role: 'member' })
    mockUserFindFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 60 * 60_000) })
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      providerParam: 'github',
      userId: 'user_existing',
      email: 'a@acme.com',
      token: 'tok',
    })

    await expect(
      cleanup(
        ctx,
        tenantSettings({
          githubEnabled: true,
          verifiedDomains: [makeVerifiedDomain('acme.com', true)],
        })
      )
    ).rejects.toThrow(/verified_domain_requires_sso/)
    expect(mockSessionDeleteWhere).toHaveBeenCalled()
  })

  it('does NOT hard-bind the team SSO provider itself at an enforced domain', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      providerParam: 'sso',
      userId: 'user_1',
      email: 'a@acme.com',
      token: 'tok',
    })
    await cleanup(ctx, tenantSettings({ verifiedDomains: [makeVerifiedDomain('acme.com', true)] }))
    expect(mockSessionDeleteWhere).not.toHaveBeenCalled()
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('fails open: google at an enforced domain passes through when SSO is not actually registered', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    const ctx = ctxFor({
      path: '/oauth2/callback/:providerId',
      providerParam: 'google',
      userId: 'user_1',
      email: 'a@acme.com',
      token: 'tok',
    })
    // googleEnabled so the method-allowed fall-through also passes —
    // the point is the hard-binding branch must NOT fire when the owning
    // provider isn't registered (self-lockout guard, scoped to the owner).
    await cleanup(
      ctx,
      tenantSettings({
        googleEnabled: true,
        verifiedDomains: [makeVerifiedDomain('acme.com', true)],
      }),
      { ssoRegistered: false }
    )
    expect(mockSessionDeleteWhere).not.toHaveBeenCalled()
    expect(ctx.redirect).not.toHaveBeenCalled()
  })

  it('revokes + wipes shells when brand-new user lands via /sign-in/social with credential at enforced domain', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    mockUserFindFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 5_000) })

    const ctx = ctxFor({
      path: '/sign-in/social',
      bodyProvider: 'credential',
      userId: 'user_brandnew',
      email: 'a@acme.com',
      token: 'tok',
    })

    await expect(
      cleanup(ctx, tenantSettings({ verifiedDomains: [makeVerifiedDomain('acme.com', true)] }))
    ).rejects.toThrow(/\/\?auth=signin&callbackUrl=\/admin&error=verified_domain_requires_sso/)

    expect(mockSessionDeleteWhere).toHaveBeenCalled()
    expect(mockUserDeleteWhere).toHaveBeenCalled()
    expect(mockAccountDeleteWhere).toHaveBeenCalled()
    expect(mockPrincipalDeleteWhere).toHaveBeenCalled()
    expect(mockDeleteSessionCookie).toHaveBeenCalled()
  })

  it('revokes WITHOUT wiping shells when the user existed before this attempt (>60s)', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    mockUserFindFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 60 * 60_000) })

    const ctx = ctxFor({
      path: '/sign-in/social',
      bodyProvider: 'credential',
      userId: 'user_existing',
      email: 'a@acme.com',
      token: 'tok',
    })

    await expect(
      cleanup(ctx, tenantSettings({ verifiedDomains: [makeVerifiedDomain('acme.com', true)] }))
    ).rejects.toThrow(/verified_domain_requires_sso/)

    expect(mockSessionDeleteWhere).toHaveBeenCalled()
    expect(mockUserDeleteWhere).not.toHaveBeenCalled()
    expect(mockAccountDeleteWhere).not.toHaveBeenCalled()
    expect(mockPrincipalDeleteWhere).not.toHaveBeenCalled()
  })
})
