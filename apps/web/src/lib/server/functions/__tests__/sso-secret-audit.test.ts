/**
 * Audit-log wiring for clearSsoClientSecretFn.
 *
 * Records sso.config.changed for every clear (success or failure), with
 * the field name + action in metadata. The secret VALUE never touches
 * the audit row — we only log presence transitions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>
const handlersByModule = new Map<string, AnyHandler[]>()
let currentModule = ''

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
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
  mockSavePlatformCredentials: vi.fn(),
  mockDeletePlatformCredentials: vi.fn(),
  mockGetTenantSettings: vi.fn(),
  mockHasSsoClientSecret: vi.fn(),
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

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  savePlatformCredentials: hoisted.mockSavePlatformCredentials,
  deletePlatformCredentials: hoisted.mockDeletePlatformCredentials,
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getTenantSettings: hoisted.mockGetTenantSettings,
  setVerifiedDomainEnforced: vi.fn(),
  listVerifiedDomains: vi.fn(),
  updateAuthConfig: vi.fn(),
  setSsoDomainSubtree: vi.fn(),
}))

vi.mock('@/lib/server/auth/sso-secret', () => ({
  hasSsoClientSecret: hoisted.mockHasSsoClientSecret,
  SSO_CREDENTIAL_TYPE: 'auth_sso',
  isSsoActuallyRegistered: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn().mockResolvedValue({ features: { customOidcProvider: true } }),
}))

vi.mock('@quackback/email', () => ({
  isEmailConfigured: vi.fn().mockReturnValue(true),
}))

vi.mock('@/lib/server/content/ssrf-guard', () => ({
  checkUrlSafety: vi.fn().mockResolvedValue({ safe: true }),
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

// clearSsoClientSecretFn's last-method guard lists identity providers; with no
// 'sso' provider row the guard is a no-op, keeping these audit tests unit-level.
vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: vi.fn(async () => []),
}))

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequireAuth.mockResolvedValue({
    user: { id: 'user_admin1', email: 'admin@example.com' },
    principal: { id: 'principal_admin1', role: 'admin' },
  })
  hoisted.mockHasSsoClientSecret.mockResolvedValue(false)
  hoisted.mockSavePlatformCredentials.mockResolvedValue(undefined)
  hoisted.mockDeletePlatformCredentials.mockResolvedValue(undefined)
  hoisted.mockGetTenantSettings.mockResolvedValue({
    authConfig: { ssoOidc: { enabled: true } },
    verifiedDomains: [],
  })
  hoisted.mockRecordAuditEvent.mockResolvedValue(undefined)
})

currentModule = 'sso'
await import('../sso')
const ssoHandlers = handlersByModule.get('sso')!
// Index order: 0=clearSsoClientSecret, 1=removeVerifiedDomain, 2=getVerifiedDomains, ...
const clearSsoClientSecret = ssoHandlers[0]

describe('clearSsoClientSecretFn audit-log wiring', () => {
  it('records sso.config.changed (cleared) on success', async () => {
    await clearSsoClientSecret({ data: {} })

    expect(hoisted.mockRecordAuditEvent).toHaveBeenCalledTimes(1)
    const call = hoisted.mockRecordAuditEvent.mock.calls[0][0]
    expect(call.event).toBe('sso.config.changed')
    expect(call.outcome).toBe('success')
    expect(call.metadata).toMatchObject({ field: 'clientSecret', action: 'cleared' })
  })

  it('records a failure event when a verified domain blocks the clear', async () => {
    hoisted.mockGetTenantSettings.mockResolvedValue({
      authConfig: { ssoOidc: { enabled: true } },
      verifiedDomains: [
        {
          id: 'domain_acme',
          name: 'acme.com',
          verifiedAt: '2026-05-10T00:00:00Z',
          enforced: false,
        },
      ],
    })

    await expect(clearSsoClientSecret({ data: {} })).rejects.toThrow()

    expect(hoisted.mockRecordAuditEvent).toHaveBeenCalledTimes(1)
    const call = hoisted.mockRecordAuditEvent.mock.calls[0][0]
    expect(call.event).toBe('sso.config.changed')
    expect(call.outcome).toBe('failure')
    expect(call.metadata).toMatchObject({ reason: 'SSO_DOMAIN_VERIFIED' })
  })
})
