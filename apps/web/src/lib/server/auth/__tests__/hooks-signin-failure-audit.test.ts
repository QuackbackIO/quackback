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

  it('DOES emit for the OIDC callback, and never from the request body', async () => {
    // This used to assert the opposite. The callback was in neither failure
    // set, so an OIDC sign-in failure produced no audit row at all — the
    // reason a self-hosted regression arrived as "SSO broke" with nothing
    // attached. It emits now, with no email taken from the body.
    await handleSignInFailureAudit(
      failedCtx({ path: '/oauth2/callback/:providerId', email: 'user@example.com' })
    )

    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1)
    const call = mockRecordAuditEvent.mock.calls[0][0]
    expect(call.metadata.reason).toBe('OIDC_SIGNIN_FAILED')
    expect(call.actor.email).toBeNull()
  })

  it('survives an audit-store failure without propagating', async () => {
    mockRecordAuditEvent.mockRejectedValueOnce(new Error('audit store down'))

    await expect(
      handleSignInFailureAudit(failedCtx({ path: '/sign-in/email', email: 'u@example.com' }))
    ).resolves.toBeUndefined()
  })
})

/**
 * OIDC callback failures. Previously invisible: the callback path was in
 * neither failure set, so every OIDC sign-in failure produced no
 * `auth.signin.failed` row at all. On a self-hosted instance that made a
 * post-upgrade regression arrive as "SSO broke" with nothing attached.
 */
function oidcCtx(opts: { error?: string; withSession?: boolean; providerId?: string }) {
  const providerId = opts.providerId ?? 'oidc_abc'
  const location = opts.error
    ? `https://acme.test/api/auth/error?error=${opts.error}`
    : 'https://acme.test/api/auth/error'
  return {
    path: '/oauth2/callback/:providerId',
    params: { providerId },
    body: {},
    context: {
      newSession: opts.withSession
        ? { user: { id: 'user_1' }, session: { token: 'session_tok' } }
        : null,
      returned: new Response(null, { status: 302, headers: { location } }),
    },
  }
}

describe('handleSignInFailureAudit — OIDC callback', () => {
  it('emits with the IdP-reported reason code', async () => {
    await handleSignInFailureAudit(oidcCtx({ error: 'email_is_missing' }) as never)
    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1)
    const call = mockRecordAuditEvent.mock.calls[0][0]
    expect(call.event).toBe('auth.signin.failed')
    expect(call.outcome).toBe('failure')
    expect(call.metadata.reason).toBe('EMAIL_IS_MISSING')
    expect(call.metadata.providerId).toBe('oidc_abc')
    expect(call.actor.authMethod).toBe('sso')
  })

  it('maps the other resolution failures to stable codes', async () => {
    for (const [raw, code] of [
      ['name_is_missing', 'NAME_IS_MISSING'],
      ['id_is_missing', 'ID_IS_MISSING'],
      ['user_info_is_missing', 'USER_INFO_IS_MISSING'],
    ] as const) {
      mockRecordAuditEvent.mockClear()
      await handleSignInFailureAudit(oidcCtx({ error: raw }) as never)
      expect(mockRecordAuditEvent.mock.calls[0][0].metadata.reason).toBe(code)
    }
  })

  it('falls back to a generic code when the redirect carries no error', async () => {
    await handleSignInFailureAudit(oidcCtx({}) as never)
    expect(mockRecordAuditEvent.mock.calls[0][0].metadata.reason).toBe('OIDC_SIGNIN_FAILED')
  })

  it('does not emit when the callback created a session', async () => {
    await handleSignInFailureAudit(oidcCtx({ withSession: true }) as never)
    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
  })

  it('never records an email for the OIDC path', async () => {
    // The callback body carries no credential material, and the address (when
    // there is one) belongs to the IdP response rather than a typed attempt.
    await handleSignInFailureAudit(oidcCtx({ error: 'email_is_missing' }) as never)
    expect(mockRecordAuditEvent.mock.calls[0][0].actor.email).toBeNull()
  })
})
