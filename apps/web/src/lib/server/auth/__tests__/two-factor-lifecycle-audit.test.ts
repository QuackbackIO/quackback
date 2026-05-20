/**
 * `handleTwoFactorLifecycleAudit` — emits `two_factor.enabled` and
 * `two_factor.disabled` rows on Better-Auth's `/two-factor/verify-totp`
 * (enrollment) and `/two-factor/disable` paths.
 *
 * These audit event types have been declared in `AuditEventType` since
 * Phase A but were unemitted prior to this gate — admin-reset of 2FA
 * was the only audited lifecycle event. SOC2 / compliance contexts
 * need a row whenever a user toggles their own second factor, hence
 * this gate.
 *
 * Signal model (no response-body parsing):
 *  - Enrollment: BA's `/two-factor/verify-totp` "first verify" branch
 *    issues a fresh session via `setSessionCookie` → ctx has a
 *    populated `newSession`.
 *  - Sign-in challenge: the user already had a session before
 *    verifying; BA doesn't touch the cookie → `newSession` absent.
 *  - Disable: BA + our UI both require a fresh password confirm
 *    upstream, so reaching the after-hook implies success.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRecordAuditEvent = vi.fn(async (_spec: unknown) => undefined)

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: (spec: unknown) => mockRecordAuditEvent(spec),
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

const { handleTwoFactorLifecycleAudit } = await import('../hooks')

type Ctx = Parameters<typeof handleTwoFactorLifecycleAudit>[0]

const buildCtx = (overrides: Partial<Ctx> = {}): Ctx => ({
  path: '/two-factor/verify-totp',
  context: {
    newSession: { user: { id: 'user_abc', email: 'a@b.com' }, session: { token: 'tok' } },
  },
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('handleTwoFactorLifecycleAudit — enrollment (verify-totp first time)', () => {
  it('emits two_factor.enabled when verify-totp creates a fresh session', async () => {
    await handleTwoFactorLifecycleAudit(buildCtx())

    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1)
    const call = mockRecordAuditEvent.mock.calls[0][0] as {
      event: string
      outcome: string
      actor: { userId: string; email: string }
    }
    expect(call.event).toBe('two_factor.enabled')
    expect(call.outcome).toBe('success')
    expect(call.actor).toMatchObject({ userId: 'user_abc', email: 'a@b.com' })
  })

  it('does NOT emit when verify-totp is a sign-in challenge (no newSession)', async () => {
    // Already-enrolled user verifying during sign-in: BA doesn't issue
    // a new session, so newSession.session.token is absent.
    await handleTwoFactorLifecycleAudit(
      buildCtx({
        context: {
          newSession: null,
          session: { user: { id: 'user_abc', email: 'a@b.com' } },
        },
      })
    )

    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
  })

  it('uses newSession.user (post-enrollment) as the actor, not the prior session', async () => {
    await handleTwoFactorLifecycleAudit(
      buildCtx({
        context: {
          newSession: { user: { id: 'user_new', email: 'new@b.com' }, session: { token: 'tok' } },
          session: { user: { id: 'user_old', email: 'old@b.com' } },
        },
      })
    )

    expect(mockRecordAuditEvent.mock.calls[0][0]).toMatchObject({
      actor: { userId: 'user_new', email: 'new@b.com' },
    })
  })

  it('falls through silently when newSession.user.id is missing', async () => {
    await handleTwoFactorLifecycleAudit(
      buildCtx({
        context: {
          newSession: { user: undefined, session: { token: 'tok' } },
        },
      })
    )

    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
  })
})

describe('handleTwoFactorLifecycleAudit — disable', () => {
  it('emits two_factor.disabled on /two-factor/disable with the calling session as actor', async () => {
    await handleTwoFactorLifecycleAudit({
      path: '/two-factor/disable',
      context: {
        session: { user: { id: 'user_xyz', email: 'x@y.com' } },
      },
    })

    expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1)
    const call = mockRecordAuditEvent.mock.calls[0][0] as {
      event: string
      actor: { userId: string }
    }
    expect(call.event).toBe('two_factor.disabled')
    expect(call.actor.userId).toBe('user_xyz')
  })

  it('falls through silently when session.user.id is missing (defensive)', async () => {
    await handleTwoFactorLifecycleAudit({
      path: '/two-factor/disable',
      context: { session: { user: undefined } },
    })

    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
  })
})

describe('handleTwoFactorLifecycleAudit — path guards', () => {
  it('skips on unrelated paths', async () => {
    await handleTwoFactorLifecycleAudit({
      path: '/sign-in/email',
      context: { newSession: { user: { id: 'user_a' }, session: { token: 'tok' } } },
    })
    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
  })

  it('skips on /two-factor/enable (enrollment is only audited on verify-totp completion)', async () => {
    // BA's /two-factor/enable creates an UNVERIFIED row and returns a
    // QR-code URI. Auditing here would log every aborted enrollment
    // attempt; verify-totp completion is the right hook.
    await handleTwoFactorLifecycleAudit({
      path: '/two-factor/enable',
      context: { session: { user: { id: 'user_a' } } },
    })
    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
  })

  it('skips on /two-factor/verify-backup-code (sign-in via recovery, separate event)', async () => {
    // The sso.recovery_codes.used event covers this path via the
    // consume-recovery-code flow; this gate only handles lifecycle
    // (enrollment / removal), not sign-in challenges.
    await handleTwoFactorLifecycleAudit({
      path: '/two-factor/verify-backup-code',
      context: { newSession: { user: { id: 'user_a' }, session: { token: 'tok' } } },
    })
    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
  })
})

describe('handleTwoFactorLifecycleAudit — failure tolerance', () => {
  it('does NOT propagate when recordAuditEvent throws', async () => {
    mockRecordAuditEvent.mockRejectedValueOnce(new Error('audit store down'))

    await expect(handleTwoFactorLifecycleAudit(buildCtx())).resolves.toBeUndefined()
  })
})
