/**
 * `handleSignInFailureAudit` — emits `auth.signin.failed` when a sign-in
 * path is hit but no session is created (wrong password, invalid/expired
 * magic-link token).
 *
 * Key behaviors covered:
 *  - Emits with INVALID_CREDENTIALS on a failed credential (password) path.
 *  - Emits with INVALID_MAGIC_LINK on a failed magic-link verify path.
 *  - Does NOT emit when a session WAS created (success handled elsewhere).
 *  - Does NOT log the attempted password or token — only email + reason code.
 *  - Does NOT emit for non-sign-in paths.
 *  - Survives an audit-store failure (best-effort emit).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRecordAuditEvent = vi.fn()
const mockGetRequestHeaders = vi.fn(() => new Headers())

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: (...a: unknown[]) => mockRecordAuditEvent(...a),
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => mockGetRequestHeaders(),
}))

const { handleSignInFailureAudit } = await import('../hooks')

function failedCtx(opts: {
  path: string
  email?: string
  password?: string
  token?: string
  otp?: string
  withSession?: boolean
}) {
  return {
    path: opts.path,
    params: {},
    body: {
      ...(opts.email !== undefined ? { email: opts.email } : {}),
      ...(opts.password !== undefined ? { password: opts.password } : {}),
      ...(opts.token !== undefined ? { token: opts.token } : {}),
      ...(opts.otp !== undefined ? { otp: opts.otp } : {}),
    },
    context: opts.withSession
      ? {
          newSession: {
            user: { id: 'user_1', email: opts.email },
            session: { token: 'session_tok' },
          },
        }
      : { newSession: null },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRecordAuditEvent.mockResolvedValue(undefined)
})

describe('handleSignInFailureAudit — credential path', () => {
  it('emits auth.signin.failed with INVALID_CREDENTIALS on wrong password', async () => {
    await handleSignInFailureAudit(
      failedCtx({ path: '/sign-in/email', email: 'user@example.com', password: 'hunter2' })
    )

    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1)
    const call = mockRecordAuditEvent.mock.calls[0][0]
    expect(call.event).toBe('auth.signin.failed')
    expect(call.outcome).toBe('failure')
    expect(call.metadata).toMatchObject({ reason: 'INVALID_CREDENTIALS' })
  })

  it('does NOT log the attempted password in metadata (PII guard)', async () => {
    await handleSignInFailureAudit(
      failedCtx({ path: '/sign-in/email', email: 'user@example.com', password: 'hunter2' })
    )

    const call = mockRecordAuditEvent.mock.calls[0][0]
    // The password must never appear anywhere in the audit row
    expect(JSON.stringify(call)).not.toContain('hunter2')
  })

  it('does NOT emit when sign-in succeeded (newSession present)', async () => {
    await handleSignInFailureAudit(
      failedCtx({
        path: '/sign-in/email',
        email: 'user@example.com',
        password: 'correctpass',
        withSession: true,
      })
    )

    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
  })
})

describe('handleSignInFailureAudit — magic-link verify path', () => {
  it('emits auth.signin.failed with INVALID_MAGIC_LINK on failed verify', async () => {
    await handleSignInFailureAudit(
      failedCtx({ path: '/magic-link/verify', email: 'user@example.com', token: 'stale_tok' })
    )

    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1)
    const call = mockRecordAuditEvent.mock.calls[0][0]
    expect(call.event).toBe('auth.signin.failed')
    expect(call.outcome).toBe('failure')
    expect(call.metadata).toMatchObject({ reason: 'INVALID_MAGIC_LINK' })
  })

  it('does NOT log the magic-link token (PII guard)', async () => {
    await handleSignInFailureAudit(
      failedCtx({
        path: '/magic-link/verify',
        email: 'user@example.com',
        token: 'secret_token_abc',
      })
    )

    const call = mockRecordAuditEvent.mock.calls[0][0]
    expect(JSON.stringify(call)).not.toContain('secret_token_abc')
  })

  it('emits auth.signin.failed with INVALID_MAGIC_LINK on email-OTP verify path', async () => {
    await handleSignInFailureAudit(
      failedCtx({ path: '/sign-in/email-otp', email: 'user@example.com' })
    )

    const call = mockRecordAuditEvent.mock.calls[0][0]
    expect(call.event).toBe('auth.signin.failed')
    expect(call.metadata).toMatchObject({ reason: 'INVALID_MAGIC_LINK' })
  })

  it('does NOT log the OTP value in the audit row (PII guard)', async () => {
    await handleSignInFailureAudit(
      failedCtx({ path: '/sign-in/email-otp', email: 'user@example.com', otp: '123456' })
    )

    const call = mockRecordAuditEvent.mock.calls[0][0]
    expect(JSON.stringify(call)).not.toContain('123456')
  })
})

describe('handleSignInFailureAudit — guards', () => {
  it('does NOT emit for non-sign-in paths', async () => {
    await handleSignInFailureAudit(failedCtx({ path: '/session/get', email: 'user@example.com' }))

    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
  })

  it('does NOT emit for OAuth callback paths', async () => {
    await handleSignInFailureAudit(
      failedCtx({ path: '/oauth2/callback/:providerId', email: 'user@example.com' })
    )

    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
  })

  it('survives an audit-store failure without propagating', async () => {
    mockRecordAuditEvent.mockRejectedValueOnce(new Error('audit store down'))

    await expect(
      handleSignInFailureAudit(failedCtx({ path: '/sign-in/email', email: 'u@example.com' }))
    ).resolves.toBeUndefined()
  })
})
