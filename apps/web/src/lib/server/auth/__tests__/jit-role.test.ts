/**
 * Tests for `handleAutoProvisionAfter` role assignment.
 *
 * Phase 1, Task 1.2: the JIT auto-provision hook must read
 * `authConfig.ssoOidc.autoProvisionRole` and use it as the target role,
 * defaulting to 'member' for backwards compatibility. Setting 'user'
 * explicitly disables promotion.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFindFirst = vi.fn()
const mockAccountFindFirst = vi.fn()
const mockSet = vi.fn()
const mockWhere = vi.fn()
const mockRecordAuditEvent = vi.fn()
const mockIsEmailAtVerifiedDomain = vi.fn((_email: unknown, _domains: unknown): boolean => true)

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
      account: { findFirst: (...args: unknown[]) => mockAccountFindFirst(...args) },
    },
    update: () => ({ set: mockSet, where: mockWhere }),
  },
  principal: { userId: 'user_id', role: 'role' },
  account: { userId: 'account.userId', providerId: 'account.providerId' },
  and: vi.fn((...parts: unknown[]) => ({ op: 'and', parts })),
  eq: vi.fn(),
}))

vi.mock('../auth-restrictions', () => ({
  isEmailAtVerifiedDomain: (email: unknown, domains: unknown) =>
    mockIsEmailAtVerifiedDomain(email, domains),
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: (...args: unknown[]) => mockRecordAuditEvent(...args),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockSet.mockReturnValue({ where: mockWhere })
  mockWhere.mockResolvedValue(undefined)
  mockIsEmailAtVerifiedDomain.mockReturnValue(true)
  mockRecordAuditEvent.mockResolvedValue(undefined)
})

type SsoOidc = {
  enabled: boolean
  discoveryUrl: string
  clientId: string
  autoCreateUsers: boolean
  autoProvisionRole?: 'admin' | 'member' | 'user'
  attributeMapping?: {
    claimPath: string
    rules: { whenContains: string; role: 'admin' | 'member' | 'user' }[]
    defaultRole: 'admin' | 'member' | 'user'
    syncOnEverySignIn?: boolean
  }
}

type CallOpts = {
  path?: string
  providerId?: string
  userId?: string
  email?: string
  ssoOidc?: Partial<SsoOidc>
}

const callHandlerWith = async (opts: CallOpts = {}) => {
  const mod = (await import('../hooks')) as typeof import('../hooks') & {
    handleAutoProvisionAfter?: (
      ctx: {
        path?: string
        params?: Record<string, unknown>
        context?: { newSession?: { user?: { id?: string; email?: string } } }
      },
      tenant: Record<string, unknown>
    ) => Promise<void>
  }
  const handler = mod.handleAutoProvisionAfter
  if (!handler) throw new Error('handleAutoProvisionAfter must be exported for testing')
  await handler(
    {
      path: opts.path ?? '/oauth2/callback/:providerId',
      params: { providerId: opts.providerId ?? 'sso' },
      context: {
        newSession: {
          user: { id: opts.userId ?? 'user_abc', email: opts.email ?? 'alice@acme.com' },
        },
      },
    },
    {
      authConfig: {
        ssoOidc: {
          enabled: true,
          discoveryUrl: 'https://idp/well-known',
          clientId: 'c',
          autoCreateUsers: true,
          ...opts.ssoOidc,
        },
      },
      verifiedDomains: [
        {
          id: 'domain_1',
          name: 'acme.com',
          verificationToken: 't',
          verifiedAt: '2026-01-01',
          enforced: false,
          createdAt: '2026-01-01',
        },
      ],
    }
  )
}

const callHandler = (autoProvisionRole?: 'admin' | 'member' | 'user') =>
  callHandlerWith({ ssoOidc: { autoProvisionRole } })

describe('handleAutoProvisionAfter -- role assignment', () => {
  it('uses autoProvisionRole=admin from config', async () => {
    mockFindFirst.mockResolvedValue({ role: 'user' })
    await callHandler('admin')
    expect(mockSet).toHaveBeenCalledWith({ role: 'admin' })
  })

  it('uses autoProvisionRole=member from config', async () => {
    mockFindFirst.mockResolvedValue({ role: 'user' })
    await callHandler('member')
    expect(mockSet).toHaveBeenCalledWith({ role: 'member' })
  })

  it('defaults to member when autoProvisionRole is undefined', async () => {
    mockFindFirst.mockResolvedValue({ role: 'user' })
    await callHandler(undefined)
    expect(mockSet).toHaveBeenCalledWith({ role: 'member' })
  })

  it('does not promote when autoProvisionRole=user (portal-only)', async () => {
    mockFindFirst.mockResolvedValue({ role: 'user' })
    await callHandler('user')
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('does not downgrade existing admin/member', async () => {
    mockFindFirst.mockResolvedValue({ role: 'admin' })
    await callHandler('member')
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('no-ops when the current role already equals the target', async () => {
    mockFindFirst.mockResolvedValue({ role: 'member' })
    await callHandler('member')
    expect(mockSet).not.toHaveBeenCalled()
  })
})

describe('handleAutoProvisionAfter -- guards (no-op short-circuits)', () => {
  it('skips when path is not the OAuth callback', async () => {
    await callHandlerWith({ path: '/sign-in/email' })
    expect(mockFindFirst).not.toHaveBeenCalled()
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('skips when providerId is not "sso" (e.g. google callback)', async () => {
    await callHandlerWith({ providerId: 'google' })
    expect(mockFindFirst).not.toHaveBeenCalled()
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('skips when autoCreateUsers=false (admin opted out)', async () => {
    mockFindFirst.mockResolvedValue({ role: 'user' })
    await callHandlerWith({ ssoOidc: { autoCreateUsers: false } })
    expect(mockFindFirst).not.toHaveBeenCalled()
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('skips when the user email is not at a verified domain', async () => {
    mockIsEmailAtVerifiedDomain.mockReturnValue(false)
    await callHandlerWith({ email: 'alice@other.com' })
    expect(mockFindFirst).not.toHaveBeenCalled()
    expect(mockSet).not.toHaveBeenCalled()
  })
})

describe('handleAutoProvisionAfter -- syncOnEverySignIn', () => {
  it('does NOT re-apply on existing admin when sync is off (JIT default)', async () => {
    mockFindFirst.mockResolvedValue({ role: 'admin' })
    await callHandler('member')
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('re-applies on every sign-in when attributeMapping.syncOnEverySignIn=true (and can demote)', async () => {
    mockFindFirst.mockResolvedValue({ role: 'admin' })
    mockAccountFindFirst.mockResolvedValue({ idToken: null })
    await callHandlerWith({
      ssoOidc: {
        autoProvisionRole: 'member',
        attributeMapping: {
          claimPath: 'roles',
          rules: [],
          defaultRole: 'member',
          syncOnEverySignIn: true,
        },
      },
    })
    expect(mockSet).toHaveBeenCalledWith({ role: 'member' })
  })

  it('honours a resolved role="user" under sync mode (demotes existing admin)', async () => {
    mockFindFirst.mockResolvedValue({ role: 'admin' })
    mockAccountFindFirst.mockResolvedValue({ idToken: null })
    // With sync on, the resolved-from-claims role is authoritative on
    // every sign-in. attributeMapping has no rules and defaultRole='user',
    // so the IdP is effectively saying "this user has no team role". An
    // existing admin gets demoted to portal-user.
    await callHandlerWith({
      ssoOidc: {
        autoProvisionRole: 'user',
        attributeMapping: {
          claimPath: 'roles',
          rules: [],
          defaultRole: 'user',
          syncOnEverySignIn: true,
        },
      },
    })
    expect(mockSet).toHaveBeenCalledWith({ role: 'user' })
  })
})

describe('handleAutoProvisionAfter -- audit on role change', () => {
  it('emits user.role.changed when promoting an existing portal user', async () => {
    mockFindFirst.mockResolvedValue({ role: 'user' })
    await callHandler('member')

    // First-time promotion (p.role='user' is the bootstrap-only case)
    // doesn't emit because the audit branch only fires when p.role is
    // truthy AND different from targetRole. role='user' qualifies as
    // truthy, so the row IS emitted.
    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1)
    const call = mockRecordAuditEvent.mock.calls[0][0] as {
      event: string
      before: { role: string }
      after: { role: string }
      metadata: Record<string, unknown>
    }
    expect(call.event).toBe('user.role.changed')
    expect(call.before.role).toBe('user')
    expect(call.after.role).toBe('member')
    expect(call.metadata.source).toBe('auto_provision')
  })

  it('marks audit source=attribute_mapping when role came from claim resolution', async () => {
    mockFindFirst.mockResolvedValue({ role: 'user' })
    mockAccountFindFirst.mockResolvedValue({ idToken: null })
    await callHandlerWith({
      ssoOidc: {
        autoProvisionRole: 'member',
        attributeMapping: {
          claimPath: 'roles',
          rules: [],
          defaultRole: 'member',
        },
      },
    })

    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1)
    const call = mockRecordAuditEvent.mock.calls[0][0] as {
      metadata: Record<string, unknown>
    }
    expect(call.metadata.source).toBe('attribute_mapping')
  })
})
