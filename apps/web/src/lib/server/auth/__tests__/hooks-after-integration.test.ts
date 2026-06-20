/**
 * Integration test for the `hooksAfter` middleware composition.
 *
 * Each individual hook helper has its own unit test in this directory.
 * What can ONLY be verified at composition level is the ordering — the
 * doc-comment on `hooksAfter` calls out two load-bearing invariants:
 *
 *  1. `handleSsoCallbackAfter` runs BEFORE `handleAutoProvisionAfter`.
 *     If auto-provision ran first on a fresh workspace, a brand-new
 *     SSO sign-in with `autoProvisionRole='member'` would land on
 *     `role='member'`, then bootstrap would (correctly) see no admin
 *     and promote to admin — final state happens to be the same. The
 *     ordering is semantically still right (bootstrap is the
 *     workspace-recovery primitive, provision is the role-policy
 *     primitive), and reversing it would surprise readers.
 *
 *  2. For a successful SSO sign-in, `handleAutoProvisionAfter` sets the
 *     verified-domain user's role from config and `handleCallbackPolicyCleanup`
 *     leaves the session intact — the composition must not revoke a
 *     legitimate sign-in. (SSO is allowed for every role, so verified-domain
 *     users pass the policy cleanup.)
 *
 * We assert these by exercising `hooksAfter` end-to-end against a fully
 * mocked dependency graph and checking the side-effect tape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAuthConfig, makeTenant, makeVerifiedDomain } from './_helpers'

// Better-Auth's middleware factory is identity for the test — `hooksAfter`
// becomes the inner async function directly callable.
vi.mock('better-auth/api', () => ({
  createAuthMiddleware: (fn: (ctx: unknown) => Promise<void>) => fn,
}))

// Shared mutable principal role so that auto-provision's update is
// observed by the subsequent cleanup re-read. This is what a real DB
// would do — two consecutive findFirst calls bracketing an update see
// the new value.
const state = { role: 'user' as 'admin' | 'member' | 'user' | null }

const mockPrincipalFindFirst = vi.fn(async () =>
  state.role === null ? null : { role: state.role }
)
const mockUserFindFirst = vi.fn()
const mockAccountFindFirst = vi.fn()
const mockTxPrincipalFindFirst = vi.fn()
const mockTxExecute = vi.fn(async () => undefined)
const mockTxUpdateSet = vi.fn((patch: { role?: 'admin' | 'member' | 'user' }) => {
  if (patch.role) state.role = patch.role
})
const mockUpdateSet = vi.fn((patch: { role?: 'admin' | 'member' | 'user' }) => {
  if (patch.role) state.role = patch.role
})
const mockSessionDelete = vi.fn(async () => undefined)
const mockDelete = vi.fn()
const mockGetTenantSettings = vi.fn()
const mockGetPublicPortalConfig = vi.fn()
const mockRecordAuditEvent = vi.fn(async (_spec: unknown) => undefined)
const mockDeleteSessionCookie = vi.fn((_ctx: unknown) => undefined)
const mockHasPlatformCredentials = vi.fn(async (_type: string) => true)

vi.mock('@/lib/server/db', () => {
  const tx = {
    execute: mockTxExecute,
    query: { principal: { findFirst: mockTxPrincipalFindFirst } },
    update: () => ({
      set: (patch: { role?: 'admin' | 'member' | 'user' }) => {
        mockTxUpdateSet(patch)
        return { where: async () => undefined }
      },
    }),
  }
  return {
    db: {
      transaction: async (fn: (tx: unknown) => Promise<void>) => fn(tx),
      query: {
        principal: { findFirst: mockPrincipalFindFirst },
        user: { findFirst: mockUserFindFirst },
        account: { findFirst: mockAccountFindFirst },
      },
      update: () => ({
        set: (patch: { role?: 'admin' | 'member' | 'user' }) => {
          mockUpdateSet(patch)
          return { where: async () => undefined }
        },
      }),
      delete: (table: { __name: string }) => {
        mockDelete(table)
        if (table.__name === 'session') return { where: mockSessionDelete }
        return { where: async () => undefined }
      },
    },
    user: { __name: 'user', id: 'user.id', email: 'user.email' },
    principal: {
      __name: 'principal',
      id: 'principal.id',
      userId: 'principal.userId',
      role: 'principal.role',
      type: 'principal.type',
    },
    session: { __name: 'session', token: 'session.token', userId: 'session.userId' },
    account: { __name: 'account', userId: 'account.userId', providerId: 'account.providerId' },
    and: vi.fn((...parts: unknown[]) => ({ op: 'and', parts })),
    eq: vi.fn((col: unknown, val: unknown) => ({ op: 'eq', col, val })),
    sql: (strings: TemplateStringsArray) => ({ strings }),
  }
})

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getTenantSettings: (...a: unknown[]) => mockGetTenantSettings(...a),
  getPublicPortalConfig: (...a: unknown[]) => mockGetPublicPortalConfig(...a),
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: (spec: unknown) => mockRecordAuditEvent(spec),
}))

vi.mock('better-auth/cookies', () => ({
  deleteSessionCookie: (ctx: unknown) => mockDeleteSessionCookie(ctx),
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  hasPlatformCredentials: (type: string) => mockHasPlatformCredentials(type),
}))

vi.mock('@/lib/server/auth/sso-secret', () => ({
  // The integration test runs full hooksAfter end-to-end; default to
  // "SSO viable" so the enforcement branches behave as in production.
  isSsoActuallyRegistered: async () => true,
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: async () => ({ features: { customOidcProvider: true } }),
}))

// Task 12: hooksAfter loads the provider registry on callback paths and
// threads it to the after-hooks. Mock both; derive the single owning
// provider 'sso' from the tenant's verified domains so the enforced /
// not-enforced scenarios carry through to handleCallbackPolicyCleanup.
const mockListIdentityProviders = vi.fn(async () => {
  const tenant = (await mockGetTenantSettings()) as { verifiedDomains?: unknown[] } | undefined
  return [{ id: 'idp_sso', registrationId: 'sso', domains: tenant?.verifiedDomains ?? [] }]
})
vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: () => mockListIdentityProviders(),
}))
const mockGetRegisteredOidcProviderIds = vi.fn(async () => new Set(['sso']))
vi.mock('@/lib/server/auth/registered-providers', () => ({
  getRegisteredOidcProviderIds: () => mockGetRegisteredOidcProviderIds(),
}))

const { hooksAfter } = (await import('../hooks')) as unknown as {
  hooksAfter: (ctx: unknown) => Promise<void>
}

function ssoCallbackCtx(opts: { userId: string; email: string; token: string }) {
  return {
    path: '/oauth2/callback/:providerId',
    params: { providerId: 'sso' },
    body: {},
    context: {
      newSession: {
        user: { id: opts.userId, email: opts.email },
        session: { token: opts.token },
      },
    },
    setCookie: vi.fn(),
    redirect: vi.fn((url: string) => new Error(`REDIRECT:${url}`)),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.role = 'user'
  mockTxPrincipalFindFirst.mockResolvedValue({ id: 'principal_existing_admin' })
  mockUserFindFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 60 * 60_000) })
  mockGetPublicPortalConfig.mockResolvedValue({
    oauth: { password: true, magicLink: false },
  })
})

describe('hooksAfter — successful SSO sign-in by brand-new verified-domain user', () => {
  beforeEach(() => {
    mockGetTenantSettings.mockResolvedValue(
      makeTenant({
        authConfig: makeAuthConfig({
          ssoOidc: { autoCreateUsers: true, autoProvisionRole: 'member' },
        }),
        verifiedDomains: [makeVerifiedDomain('acme.com', false)],
      })
    )
    // Brand-new user: principal row starts as role='user'. The state
    // object drives the stateful mocks above.
    state.role = 'user'
  })

  it('does NOT revoke the session on a successful SSO sign-in', async () => {
    await hooksAfter(ssoCallbackCtx({ userId: 'user_new', email: 'alice@acme.com', token: 'tok' }))

    expect(mockDelete).not.toHaveBeenCalledWith(expect.objectContaining({ __name: 'session' }))
    expect(mockSessionDelete).not.toHaveBeenCalled()
    expect(mockDeleteSessionCookie).not.toHaveBeenCalled()
  })

  it('updates the principal role to "member" (auto-provision wrote)', async () => {
    await hooksAfter(ssoCallbackCtx({ userId: 'user_new', email: 'alice@acme.com', token: 'tok' }))

    expect(mockUpdateSet).toHaveBeenCalledWith({ role: 'member' })
  })

  it('emits an auth.signin.success audit (proves audit ran last and saw a surviving session)', async () => {
    await hooksAfter(ssoCallbackCtx({ userId: 'user_new', email: 'alice@acme.com', token: 'tok' }))

    type AuditSpec = { event: string; metadata?: { method?: string } }
    const signinAudit = mockRecordAuditEvent.mock.calls
      .map(([spec]) => spec as AuditSpec)
      .find((spec) => spec.event === 'auth.signin.success')
    expect(signinAudit).toBeDefined()
    expect(signinAudit?.metadata?.method).toBe('sso')
  })
})

describe('hooksAfter — bootstrap precedes auto-provision', () => {
  it('promotes the first SSO user to admin even when autoProvisionRole="member"', async () => {
    mockGetTenantSettings.mockResolvedValue(
      makeTenant({
        authConfig: makeAuthConfig({
          ssoOidc: { autoCreateUsers: true, autoProvisionRole: 'member' },
        }),
        verifiedDomains: [makeVerifiedDomain('acme.com', false)],
      })
    )
    // No existing human admin in the workspace → bootstrap promotes.
    // The stateful mock starts at role='user'; bootstrap's tx update
    // writes role='admin'; subsequent principal reads return 'admin'.
    state.role = 'user'
    mockTxPrincipalFindFirst.mockResolvedValue(null)

    await hooksAfter(
      ssoCallbackCtx({ userId: 'user_first', email: 'alice@acme.com', token: 'tok' })
    )

    // Bootstrap promoted to admin (in the tx).
    expect(mockTxUpdateSet).toHaveBeenCalledWith({ role: 'admin' })
    // Auto-provision did NOT touch the role (admin is not 'user').
    expect(mockUpdateSet).not.toHaveBeenCalledWith({ role: 'member' })
    // Session survived → cleanup passed.
    expect(mockSessionDelete).not.toHaveBeenCalled()
  })
})

describe('hooksAfter — short-circuit on blocked sign-in', () => {
  it('skips the success audit when cleanup throws (admin tries credential at enforced verified domain)', async () => {
    // Per-domain enforcement. Admin tried password at a verified-domain
    // email (post-session compensating cleanup path via /sign-in/social).
    mockGetTenantSettings.mockResolvedValue(
      makeTenant({
        authConfig: makeAuthConfig({ ssoOidc: { enabled: true } }),
        verifiedDomains: [makeVerifiedDomain('acme.com', true)],
      })
    )
    state.role = 'admin'

    const ctx = {
      path: '/sign-in/social',
      params: {},
      body: { provider: 'credential' },
      context: {
        newSession: {
          user: { id: 'user_admin', email: 'admin@acme.com' },
          session: { token: 'tok' },
        },
      },
      setCookie: vi.fn(),
      redirect: vi.fn((url: string) => new Error(`REDIRECT:${url}`)),
    }

    await expect(hooksAfter(ctx)).rejects.toThrow(/verified_domain_requires_sso/)

    // Cleanup revoked the session.
    expect(mockSessionDelete).toHaveBeenCalled()
    // Audit MUST NOT fire — the cleanup threw before it could run.
    const successAudit = mockRecordAuditEvent.mock.calls
      .map(([spec]) => spec as { event: string })
      .find((spec) => spec.event === 'auth.signin.success')
    expect(successAudit).toBeUndefined()
  })
})
