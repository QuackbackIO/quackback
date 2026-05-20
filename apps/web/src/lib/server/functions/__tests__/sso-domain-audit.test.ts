/**
 * Audit-log wiring for setVerifiedDomainEnforcedFn.
 *
 * Confirms an audit row is written on every flip — success or failure
 * — and that the row carries the before/after state, the actor, and
 * the right event-type for the new value.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlersByModule = new Map<string, AnyHandler[]>()
let currentModule = ''

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      handler(fn: AnyHandler) {
        const arr = handlersByModule.get(currentModule) ?? []
        arr.push(fn)
        handlersByModule.set(currentModule, arr)
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockRecordAuditEvent: vi.fn(),
  mockSetVerifiedDomainEnforced: vi.fn(),
  mockHasSsoClientSecret: vi.fn(),
  mockGetTierLimits: vi.fn(),
  mockIsEmailConfigured: vi.fn().mockReturnValue(true),
  // One cached read backs both the audit `before` snapshot (verifiedDomains)
  // and the enforce gate (authConfig.ssoOidc).
  mockGetTenantSettings: vi.fn(),
  // Resolves to the `[maxRow]` array from the max-team-SSO-sign-in query.
  mockMaxSignInRow: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: hoisted.mockRecordAuditEvent,
  actorFromAuth: (auth: { user: { id: string; email: string }; principal: { role: string } }) => ({
    userId: auth.user.id,
    email: auth.user.email,
    role: auth.principal.role,
  }),
  withAuditEvent: async (
    spec: { event: string; metadata?: Record<string, unknown>; [k: string]: unknown },
    fn: () => Promise<unknown>
  ) => {
    try {
      const result = await fn()
      await hoisted.mockRecordAuditEvent({ ...spec, outcome: 'success' })
      return result
    } catch (error) {
      const reason =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : error instanceof Error
            ? error.message
            : 'UNEXPECTED'
      await hoisted.mockRecordAuditEvent({
        ...spec,
        outcome: 'failure',
        metadata: { ...(spec.metadata ?? {}), reason },
      })
      throw error
    }
  },
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  setVerifiedDomainEnforced: hoisted.mockSetVerifiedDomainEnforced,
  getTenantSettings: hoisted.mockGetTenantSettings,
  updateAuthConfig: vi.fn(),
  setSsoDomainSubtree: vi.fn(),
}))

vi.mock('@/lib/server/auth/sso-secret', () => ({
  hasSsoClientSecret: hoisted.mockHasSsoClientSecret,
  SSO_CREDENTIAL_TYPE: 'auth_sso',
  isSsoActuallyRegistered: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: hoisted.mockGetTierLimits,
}))

vi.mock('@quackback/email', () => ({
  isEmailConfigured: hoisted.mockIsEmailConfigured,
}))

vi.mock('@/lib/server/content/ssrf-guard', () => ({
  checkUrlSafety: vi.fn().mockResolvedValue({ safe: true }),
}))

// setVerifiedDomainEnforcedFn's enforce gate runs a max-team-SSO-sign-in
// query: db.select(...).from(...).where(inArray(...)).orderBy(sql`...`).limit(1)
vi.mock('@/lib/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => hoisted.mockMaxSignInRow(),
          }),
        }),
      }),
    }),
  },
  principal: { lastSsoSignInAt: 'last_sso_col', role: 'role_col' },
  sql: (strings: TemplateStringsArray) => strings,
  inArray: vi.fn(),
  eq: vi.fn(),
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequireAuth.mockResolvedValue({
    user: { id: 'user_admin1', email: 'admin@example.com' },
    principal: { id: 'principal_admin1', role: 'admin' },
  })
  // Default: the enforce gate passes via a fresh test sign-in — a
  // lastSuccessfulTestAt that postdates the last detailsChangedAt. The
  // verifiedDomains list backs the audit `before` snapshot.
  hoisted.mockGetTenantSettings.mockResolvedValue({
    authConfig: {
      ssoOidc: {
        detailsChangedAt: '2026-05-10T00:00:00.000Z',
        lastSuccessfulTestAt: '2026-05-12T00:00:00.000Z',
      },
    },
    verifiedDomains: [{ id: 'domain_acme', name: 'acme.com', enforced: false }],
  })
  // No real team SSO sign-in by default — the test sign-in carries it.
  hoisted.mockMaxSignInRow.mockResolvedValue([{ ts: null }])
  hoisted.mockSetVerifiedDomainEnforced.mockResolvedValue({
    id: 'domain_acme',
    name: 'acme.com',
    enforced: true,
  })
  hoisted.mockHasSsoClientSecret.mockResolvedValue(true)
  hoisted.mockGetTierLimits.mockResolvedValue({ features: { customOidcProvider: true } })
  hoisted.mockRecordAuditEvent.mockResolvedValue(undefined)
})

currentModule = 'sso'
await import('../sso')
const ssoHandlers = handlersByModule.get('sso')!
// Order matches sso.ts exports — same as sso-domain-guards.test.ts.
const setVerifiedDomainEnforced = ssoHandlers[1]

describe('setVerifiedDomainEnforcedFn audit-log wiring', () => {
  it('records sso.enforcement.domain.enabled on enable', async () => {
    await setVerifiedDomainEnforced({ data: { id: 'domain_acme', enforced: true } })

    expect(hoisted.mockRecordAuditEvent).toHaveBeenCalledTimes(1)
    const call = hoisted.mockRecordAuditEvent.mock.calls[0][0]
    expect(call.event).toBe('sso.enforcement.domain.enabled')
    expect(call.outcome).toBe('success')
    expect(call.actor).toMatchObject({
      userId: 'user_admin1',
      email: 'admin@example.com',
      role: 'admin',
    })
    expect(call.target).toEqual({ type: 'sso_verified_domain', id: 'domain_acme' })
    expect(call.after).toMatchObject({ enforced: true })
    expect(call.before).toMatchObject({ enforced: false })
  })

  it('records sso.enforcement.domain.disabled on disable', async () => {
    hoisted.mockGetTenantSettings.mockResolvedValue({
      authConfig: { ssoOidc: {} },
      verifiedDomains: [{ id: 'domain_acme', name: 'acme.com', enforced: true }],
    })
    hoisted.mockSetVerifiedDomainEnforced.mockResolvedValue({
      id: 'domain_acme',
      name: 'acme.com',
      enforced: false,
    })

    await setVerifiedDomainEnforced({ data: { id: 'domain_acme', enforced: false } })

    expect(hoisted.mockRecordAuditEvent).toHaveBeenCalledTimes(1)
    const call = hoisted.mockRecordAuditEvent.mock.calls[0][0]
    expect(call.event).toBe('sso.enforcement.domain.disabled')
    expect(call.outcome).toBe('success')
  })

  it('records a failure event when the test-sign-in gate rejects the enable', async () => {
    // No valid test sign-in (test predates the last details change) and
    // no real team SSO sign-in — the enforce gate is locked.
    hoisted.mockGetTenantSettings.mockResolvedValue({
      authConfig: {
        ssoOidc: {
          detailsChangedAt: '2026-05-12T00:00:00.000Z',
          lastSuccessfulTestAt: '2026-05-10T00:00:00.000Z',
        },
      },
      verifiedDomains: [{ id: 'domain_acme', name: 'acme.com', enforced: false }],
    })
    hoisted.mockMaxSignInRow.mockResolvedValue([{ ts: null }])

    await expect(
      setVerifiedDomainEnforced({ data: { id: 'domain_acme', enforced: true } })
    ).rejects.toThrow()

    expect(hoisted.mockRecordAuditEvent).toHaveBeenCalledTimes(1)
    const call = hoisted.mockRecordAuditEvent.mock.calls[0][0]
    expect(call.event).toBe('sso.enforcement.domain.enabled')
    expect(call.outcome).toBe('failure')
    expect(call.metadata).toMatchObject({ reason: 'SSO_TEST_REQUIRED' })
  })
})
