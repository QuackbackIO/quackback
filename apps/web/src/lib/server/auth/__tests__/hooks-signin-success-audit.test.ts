/**
 * `handleSignInSuccessAudit` — last-stop emitter that fires when a
 * session was actually created and survived all the prior cleanup
 * hooks. Records an `auth.signin.success` row with the inferred
 * provider, the user's post-provision role, and request headers.
 *
 * Key behaviors covered:
 *  - No-op when newSession is missing token / userId.
 *  - No-op when the path doesn't map to a known provider.
 *  - Emits with method=credential / magic-link / sso / google as
 *    inferred from the path.
 *  - Falls back to role=null if the principal row can't be found
 *    (some sign-up flows create user first, principal later).
 *  - Survives principal-lookup failures and still emits the audit
 *    (best-effort role attachment).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrincipalFindFirst = vi.fn()
const mockRecordAuditEvent = vi.fn()
const mockGetRequestHeaders = vi.fn(() => new Headers())

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: { findFirst: (...a: unknown[]) => mockPrincipalFindFirst(...a) },
    },
  },
  principal: { userId: 'principal_userId' },
  eq: vi.fn(),
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: (...a: unknown[]) => mockRecordAuditEvent(...a),
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => mockGetRequestHeaders(),
}))

const { handleSignInSuccessAudit } = await import('../hooks')

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
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
  mockRecordAuditEvent.mockResolvedValue(undefined)
})

describe('handleSignInSuccessAudit — guards', () => {
  it('does not emit when userId is missing', async () => {
    await handleSignInSuccessAudit(ctxFor({ path: '/sign-in/email', token: 'tok' }))
    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
  })

  it('does not emit when token is missing (session was revoked upstream)', async () => {
    await handleSignInSuccessAudit(ctxFor({ path: '/sign-in/email', userId: 'user_1' }))
    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
  })

  it('does not emit when path does not map to a provider', async () => {
    await handleSignInSuccessAudit(
      ctxFor({ path: '/unknown/path', userId: 'user_1', token: 'tok' })
    )
    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
  })
})

describe('handleSignInSuccessAudit — method inference', () => {
  it('emits with method=credential for /sign-in/email', async () => {
    await handleSignInSuccessAudit(
      ctxFor({
        path: '/sign-in/email',
        userId: 'user_1',
        email: 'a@b.com',
        token: 'tok',
      })
    )
    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1)
    const call = mockRecordAuditEvent.mock.calls[0][0]
    expect(call.event).toBe('auth.signin.success')
    expect(call.outcome).toBe('success')
    expect(call.metadata).toEqual({ method: 'credential' })
  })

  it('emits with method=magic-link for /magic-link/verify', async () => {
    await handleSignInSuccessAudit(
      ctxFor({
        path: '/magic-link/verify',
        userId: 'user_1',
        email: 'a@b.com',
        token: 'tok',
      })
    )
    const call = mockRecordAuditEvent.mock.calls[0][0]
    expect(call.metadata).toEqual({ method: 'magic-link' })
  })

  it('emits with method=sso for the SSO OAuth callback', async () => {
    await handleSignInSuccessAudit(
      ctxFor({
        path: '/oauth2/callback/:providerId',
        providerParam: 'sso',
        userId: 'user_1',
        email: 'a@b.com',
        token: 'tok',
      })
    )
    const call = mockRecordAuditEvent.mock.calls[0][0]
    expect(call.metadata).toEqual({ method: 'sso' })
  })

  it('emits with method=google for a generic OAuth callback', async () => {
    await handleSignInSuccessAudit(
      ctxFor({
        path: '/oauth2/callback/:providerId',
        providerParam: 'google',
        userId: 'user_1',
        email: 'a@b.com',
        token: 'tok',
      })
    )
    const call = mockRecordAuditEvent.mock.calls[0][0]
    expect(call.metadata).toEqual({ method: 'google' })
  })
})

describe('handleSignInSuccessAudit — actor / role', () => {
  it('attaches userId, email, and role to the actor', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ role: 'member' })
    await handleSignInSuccessAudit(
      ctxFor({
        path: '/sign-in/email',
        userId: 'user_42',
        email: 'a@b.com',
        token: 'tok',
      })
    )
    const call = mockRecordAuditEvent.mock.calls[0][0]
    expect(call.actor).toEqual({
      userId: 'user_42',
      email: 'a@b.com',
      role: 'member',
    })
  })

  it('falls back to role=null when no principal row exists', async () => {
    mockPrincipalFindFirst.mockResolvedValue(null)
    await handleSignInSuccessAudit(
      ctxFor({
        path: '/sign-in/email',
        userId: 'user_42',
        email: 'a@b.com',
        token: 'tok',
      })
    )
    expect(mockRecordAuditEvent.mock.calls[0][0].actor.role).toBeNull()
  })

  it('still emits with role=null when the principal lookup throws', async () => {
    mockPrincipalFindFirst.mockRejectedValue(new Error('db down'))
    await handleSignInSuccessAudit(
      ctxFor({
        path: '/sign-in/email',
        userId: 'user_42',
        email: 'a@b.com',
        token: 'tok',
      })
    )
    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1)
    expect(mockRecordAuditEvent.mock.calls[0][0].actor.role).toBeNull()
  })

  it('emits with email=null when newSession.user.email is missing', async () => {
    await handleSignInSuccessAudit(
      ctxFor({ path: '/sign-in/email', userId: 'user_1', token: 'tok' })
    )
    expect(mockRecordAuditEvent.mock.calls[0][0].actor.email).toBeNull()
  })
})

describe('handleSignInSuccessAudit — failure tolerance', () => {
  it('does NOT propagate when recordAuditEvent throws — session is real, audit is best-effort', async () => {
    mockRecordAuditEvent.mockRejectedValue(new Error('audit store down'))

    await expect(
      handleSignInSuccessAudit(
        ctxFor({
          path: '/sign-in/email',
          userId: 'user_1',
          email: 'a@b.com',
          token: 'tok',
        })
      )
    ).resolves.toBeUndefined()
  })
})
